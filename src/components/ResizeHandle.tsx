import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Remembered pane width (per key) with a drag handle; falls back gracefully without localStorage. */
export function usePaneWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => {
    try {
      const v = Number(localStorage.getItem(`pane:${key}`));
      return v >= min && v <= max ? v : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`pane:${key}`, String(width));
    } catch {
      /* ignore */
    }
  }, [key, width]);
  const set = (w: number | ((prev: number) => number)) =>
    setWidth((prev) => Math.min(max, Math.max(min, typeof w === "function" ? w(prev) : w)));
  return [width, set] as const;
}

/** Vertical drag handle placed between two panes. */
export function ResizeHandle({ onDrag, onReset, className }: { onDrag: (dx: number) => void; onReset?: () => void; className?: string }) {
  const [active, setActive] = useState(false);
  const last = useRef(0);
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onDoubleClick={onReset}
      onMouseDown={(e) => {
        e.preventDefault();
        last.current = e.clientX;
        setActive(true);
        const move = (ev: MouseEvent) => {
          onDrag(ev.clientX - last.current);
          last.current = ev.clientX;
        };
        const up = () => {
          setActive(false);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          window.removeEventListener("mousemove", move);
          window.removeEventListener("mouseup", up);
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("mousemove", move);
        window.addEventListener("mouseup", up);
      }}
      className={cn(
        "relative w-1 shrink-0 cursor-col-resize group",
        "after:absolute after:inset-y-0 after:-left-1 after:-right-1 after:content-['']", // wider hit area
        className,
      )}
      title="Drag to resize · double-click to reset"
    >
      <div className={cn("h-full w-px mx-auto transition-colors", active ? "bg-wa-dark" : "bg-transparent group-hover:bg-wa-dark/60")} />
    </div>
  );
}
