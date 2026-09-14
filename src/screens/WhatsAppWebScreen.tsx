import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Loader2 } from "lucide-react";

/**
 * Placeholder that reserves space for the native WhatsApp Web child webview.
 * The Rust side positions the (remote, IPC-less) webview over this element and
 * hides it again when the tab is left.
 */
export function WhatsAppWebScreen() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const sync = () => {
      const r = el.getBoundingClientRect();
      invoke("wa_web_set_bounds", {
        x: r.left,
        y: r.top,
        width: r.width,
        height: r.height,
        viewportHeight: window.innerHeight,
      }).catch(console.error);
    };
    sync();
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("resize", sync);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", sync);
      invoke("wa_web_hide").catch(console.error);
    };
  }, []);

  return (
    <div ref={ref} className="flex-1 min-w-0 grid place-items-center text-neutral-500">
      <Loader2 className="animate-spin" />
    </div>
  );
}
