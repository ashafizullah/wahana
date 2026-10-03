import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const MARGIN = 8;

/**
 * A menu anchored to a button but drawn on `document.body`, so a modal's scroll area or
 * rounded corners never clip it. Right-aligned under the anchor, flipped above when there
 * is no room below, and closed when anything scrolls or the window resizes.
 */
export function FloatingMenu({
  anchor,
  onClose,
  className,
  children,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const { width, height } = el.getBoundingClientRect();
    const below = a.bottom + 4;
    const top = below + height > window.innerHeight - MARGIN ? Math.max(MARGIN, a.top - 4 - height) : below;
    const left = Math.min(Math.max(MARGIN, a.right - width), window.innerWidth - width - MARGIN);
    setStyle({ top, left });
  }, [anchor]);

  useEffect(() => {
    const el = ref.current;
    // The dialogs close their menus on any outside mousedown; clicks in here are not outside.
    const stop = (e: MouseEvent) => e.stopPropagation();
    el?.addEventListener("mousedown", stop);
    const onScroll = (e: Event) => {
      if (!el?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      el?.removeEventListener("mousedown", stop);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      style={style}
      className={cn(
        "fixed z-[60] w-44 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl py-1 text-xs",
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
