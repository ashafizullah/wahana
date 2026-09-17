import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Ref that always holds the latest value — for reading current props/state from long-lived effects, observers and timers. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/** Stable function identity that always calls the latest `fn` (safe to pass to memoised children). */
export function useEvent<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useLatest(fn);
  return useCallback((...args: A) => ref.current(...args), [ref]);
}

/** Calls `onClose` on a mousedown outside `ref` or on Escape, while `active`. */
export function useDismiss(ref: RefObject<HTMLElement | null>, active: boolean, onClose: () => void) {
  const close = useLatest(onClose);
  useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [active, ref, close]);
}
