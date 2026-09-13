import type { ButtonHTMLAttributes, InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

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

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "green" | "amber" | "red" | "neutral" | "blue" }) {
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
  const letters = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      className="shrink-0 rounded-full bg-neutral-300 dark:bg-neutral-700 grid place-items-center font-semibold text-neutral-700 dark:text-neutral-200 overflow-hidden"
    >
      {src ? <img src={src} alt="" className="w-full h-full object-cover" /> : letters || "?"}
    </div>
  );
}
