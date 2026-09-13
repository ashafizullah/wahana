import { Phone, PhoneOff, Video, X } from "lucide-react";
import { useCalls } from "@/store/calls";
import { requireClient } from "@/store/settings";
import { Button } from "@/components/ui";
import { displayId } from "@/lib/utils";

/** Top banner while a WhatsApp call is ringing. Calls can only be rejected via the API; answer on the phone. */
export function CallBanner() {
  const ringing = useCalls((s) => s.ringing);
  const dismiss = useCalls((s) => s.dismiss);
  if (!ringing) return null;
  return (
    <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-emerald-600 text-white text-sm">
      {ringing.isVideo ? <Video size={16} className="animate-pulse" /> : <Phone size={16} className="animate-pulse" />}
      <span className="flex-1">
        Incoming {ringing.isVideo ? "video " : ""}call from <b>{displayId(ringing.from)}</b> — answer on your phone.
      </span>
      <Button
        size="sm"
        variant="danger"
        onClick={async () => {
          try {
            await requireClient().rejectCall(ringing.session, ringing.id, ringing.from);
          } finally {
            dismiss();
          }
        }}
      >
        <PhoneOff size={12} /> Reject
      </Button>
      <button onClick={dismiss} title="Dismiss"><X size={16} /></button>
    </div>
  );
}
