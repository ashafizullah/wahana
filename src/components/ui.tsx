import { useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { cn, initials } from "@/lib/utils";
import { useDismiss } from "@/lib/hooks";

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed",
        size === "md" ? "px-3.5 py-2 text-sm" : "px-2.5 py-1 text-xs",
        variant === "primary" && "bg-wa-dark text-white hover:bg-wa-teal",
        variant === "secondary" &&
          "bg-neutral-200 text-neutral-900 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "hover:bg-neutral-200 dark:hover:bg-neutral-800",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-wa-dark focus:ring-2 focus:ring-wa-dark/20 dark:border-neutral-700 dark:bg-neutral-900",
        className,
      )}
      {...props}
    />
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1">{children}</label>;
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "green" | "amber" | "red" | "neutral" | "blue";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        tone === "green" && "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
        tone === "amber" && "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
        tone === "red" && "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
        tone === "blue" && "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300",
        tone === "neutral" && "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300",
      )}
    >
      {children}
    </span>
  );
}

export function Avatar({ src, name, size = 40 }: { src?: string | null; name: string; size?: number }) {
  const letters = initials(name);
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="shrink-0 rounded-full bg-neutral-300 dark:bg-neutral-700 grid place-items-center font-semibold text-neutral-700 dark:text-neutral-200 overflow-hidden"
    >
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : letters || "?"}
    </div>
  );
}

/**
 * Anchored dropdown: `trigger` stays in flow, `children` render in an absolutely positioned panel
 * that closes on outside click or Escape. The panel is only mounted while `open`.
 */
export function Popover({
  open,
  onClose,
  trigger,
  side = "bottom",
  align = "left",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  side?: "top" | "bottom";
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, onClose);
  return (
    <div ref={ref} className="relative">
      {trigger}
      {open && (
        <div
          className={cn(
            "absolute z-30 rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl text-sm",
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
            align === "left" ? "left-0" : "right-0",
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Row inside a `Popover` menu. */
export function MenuItem({ className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
