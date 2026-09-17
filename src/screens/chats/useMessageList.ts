import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { mediaOpts, qk, useMediaPrefixes } from "@/api/queries";
import type { ViewMessage, WAMessage } from "@/api/types";
import { useEvent, useLatest } from "@/lib/hooks";
import { usePushNames } from "@/store/pushNames";
import { requireClient } from "@/store/settings";

const PAGE = 60;

/** Merge a page into the cached list, dropping ids already present (concurrent pages, live echoes). */
export function appendUnique(old: WAMessage[], fresh: WAMessage[], where: "start" | "end"): WAMessage[] {
  const have = new Set(old.map((m) => m.id));
  const add = fresh.filter((m) => !have.has(m.id));
  if (!add.length) return old;
  return where === "end" ? [...old, ...add] : [...add, ...old];
}

/**
 * Scrolling, virtualisation and history paging for one conversation.
 *
 * Attach `listRef` to the scroll container, `topRef` to the sentinel above the list and
 * `contentRef` to the virtualised container; render `virtualizer.getVirtualItems()`.
 */
export function useMessageList(session: string, chatId: string, ordered: ViewMessage[]) {
  const qc = useQueryClient();
  const prefixes = useMediaPrefixes();
  const listRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  /** After a jump-to-date the newest messages are not loaded; page forward until caught up. */
  const [hasNewer, setHasNewer] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const pendingPrepend = useRef<number | null>(null);
  // Synchronous in-flight guards: the scroll handler and the IntersectionObserver can both
  // fire before React commits `loadingOlder`, which would page the same range twice.
  const olderInFlight = useRef(false);
  const newerInFlight = useRef(false);

  // Scroll management:
  // - first batch for a chat → jump to the newest message (bottom)
  // - new messages while the user is at the bottom (or sent by me) → stay at bottom
  // - prepending older messages → keep the viewport where it was
  // - content growing (media loading) while at the bottom → stay at bottom
  const atBottomRef = useRef(true);
  const skipAutoScroll = useRef(false);
  const initialScrolled = useRef(false);
  const prevLen = useRef(0);

  useEffect(() => {
    initialScrolled.current = false;
    atBottomRef.current = true;
    prevLen.current = 0;
    setHasMore(true);
  }, [chatId]);

  // Only the visible bubbles (plus a buffer) are in the DOM; a long scroll-back no longer
  // keeps thousands of bubbles, images and blob URLs alive. Heights are measured per item
  // (media loading later re-measures via the virtualizer's ResizeObserver), and the
  // virtualizer compensates scrollTop when an item above the viewport changes size.
  const virtualizer = useVirtualizer({
    count: ordered.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 72,
    overscan: 12,
    getItemKey: (i) => ordered[i]!.id,
    // The list container sits below the loader / top sentinel inside the scroll element.
    scrollMargin: contentRef.current?.offsetTop ?? 0,
  });

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pendingPrepend.current !== null) {
      el.scrollTop += el.scrollHeight - pendingPrepend.current;
      pendingPrepend.current = null;
      prevLen.current = ordered.length;
      return;
    }
    if (skipAutoScroll.current) {
      // Newer page appended below: keep the viewport where it is.
      skipAutoScroll.current = false;
      prevLen.current = ordered.length;
      return;
    }
    if (!initialScrolled.current && ordered.length > 0) {
      el.scrollTop = el.scrollHeight;
      initialScrolled.current = true;
      prevLen.current = ordered.length;
      return;
    }
    const grew = ordered.length > prevLen.current;
    prevLen.current = ordered.length;
    const last = ordered[ordered.length - 1];
    if (grew && (atBottomRef.current || last?.fromMe)) el.scrollTop = el.scrollHeight;
  }, [ordered]);

  const loadOlder = async () => {
    if (!ordered.length || olderInFlight.current || loadingOlder || !hasMore || !initialScrolled.current) return;
    olderInFlight.current = true;
    setLoadingOlder(true);
    try {
      const oldest = ordered[0]!.timestamp;
      const more = await requireClient().messages(session, chatId, { limit: PAGE, before: oldest - 1, ...mediaOpts(prefixes) });
      usePushNames.getState().learn(more);
      const fresh = more.filter((m) => !ordered.some((o) => o.id === m.id));
      // WAHA applies `limit` before filtering out hidden message types, so a page can be
      // shorter than `limit` while older messages still exist — only an empty page means the end.
      if (fresh.length === 0) {
        setHasMore(false);
        return;
      }
      pendingPrepend.current = listRef.current?.scrollHeight ?? null;
      qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => appendUnique(old ?? [], fresh, "end"));
    } finally {
      olderInFlight.current = false;
      setLoadingOlder(false);
    }
  };
  const loadOlderRef = useLatest(loadOlder);

  const loadNewer = async () => {
    if (!ordered.length || newerInFlight.current || loadingNewer || !hasNewer) return;
    newerInFlight.current = true;
    setLoadingNewer(true);
    try {
      const newest = ordered[ordered.length - 1]!.timestamp;
      const more = await requireClient().messages(session, chatId, {
        limit: PAGE,
        after: newest + 1,
        sortOrder: "asc",
        ...mediaOpts(prefixes),
      });
      usePushNames.getState().learn(more);
      const fresh = more.filter((m) => !ordered.some((o) => o.id === m.id));
      if (fresh.length) {
        skipAutoScroll.current = true;
        atBottomRef.current = false;
        qc.setQueryData(qk.messages(session, chatId), (old?: WAMessage[]) => appendUnique(old ?? [], fresh.reverse(), "start"));
      } else {
        setHasNewer(false);
      }
    } finally {
      newerInFlight.current = false;
      setLoadingNewer(false);
    }
  };
  const loadNewerRef = useLatest(loadNewer);

  useEffect(() => {
    const el = listRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const onScroll = () => {
      atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      if (el.scrollTop < 150) void loadOlderRef.current();
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 150) void loadNewerRef.current();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    // Media/bubbles growing after render: keep pinned to the bottom if we were there.
    const ro = new ResizeObserver(() => {
      if (atBottomRef.current && pendingPrepend.current === null) el.scrollTop = el.scrollHeight;
    });
    ro.observe(content);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  }, [chatId, loadOlderRef, loadNewerRef]);

  // Trigger loadOlder when the top sentinel scrolls into view.
  // Observe once per chat; `loadOlderRef` always points at the latest closure (with current hasMore/loading state).
  useEffect(() => {
    const el = topRef.current;
    const root = listRef.current;
    if (!el || !root) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && void loadOlderRef.current(), {
      root,
      rootMargin: "200px 0px 0px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [chatId, loadOlderRef]);

  /** Scroll to a message (full or bare WhatsApp id) and flash it. Stable identity for memoised bubbles. */
  const jumpTo = useEvent((id: string) => {
    // Quoted ids are the bare WhatsApp id; full ids look like "true_<chat>_<id>[_<participant>]".
    const idx = ordered.findIndex((m) => m.id === id || m.id.split("_")[2] === id);
    const full = idx >= 0 ? ordered[idx]!.id : id;
    setHighlight(full);
    if (idx >= 0) {
      // Positions above the viewport are estimates until measured: scroll, let the target
      // render and measure, then correct once.
      atBottomRef.current = false;
      virtualizer.scrollToIndex(idx, { align: "center" });
      setTimeout(() => virtualizer.scrollToIndex(idx, { align: "center" }), 60);
    }
    setTimeout(() => setHighlight((h) => (h === full ? null : h)), 2000);
  });

  /** Replace the view with the 60 messages up to the end of `day` (local time). */
  const jumpToDate = async (day: string) => {
    const end = Math.floor(new Date(`${day}T23:59:59`).getTime() / 1000);
    const start = Math.floor(new Date(`${day}T00:00:00`).getTime() / 1000);
    setLoadingOlder(true);
    try {
      const list = await requireClient().messages(session, chatId, { limit: PAGE, before: end, ...mediaOpts(prefixes) });
      usePushNames.getState().learn(list);
      qc.setQueryData(qk.messages(session, chatId), list);
      setHasMore(list.length > 0);
      setHasNewer(true);
      atBottomRef.current = false;
      initialScrolled.current = false; // scroll to the bottom of the jumped page (≈ the chosen day)
      const first = [...list].reverse().find((m) => m.timestamp >= start);
      if (first) setTimeout(() => jumpTo(first.id), 50);
    } finally {
      setLoadingOlder(false);
    }
  };

  const backToLatest = () => {
    setHasNewer(false);
    setHasMore(true);
    initialScrolled.current = false;
    atBottomRef.current = true;
    void qc.resetQueries({ queryKey: qk.messages(session, chatId) });
  };

  return {
    listRef,
    topRef,
    contentRef,
    virtualizer,
    hasMore,
    hasNewer,
    loadingOlder,
    loadingNewer,
    highlight,
    loadOlder,
    jumpTo,
    jumpToDate,
    backToLatest,
  };
}
