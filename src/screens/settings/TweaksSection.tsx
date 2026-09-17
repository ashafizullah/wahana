import { Toggle } from "./shared";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/store/settings";

export function TweaksSection() {
  const s = useSettings();
  const qc = useQueryClient();
  const receiptOptions: { value: typeof s.readReceipts; label: string; hint: string }[] = [
    { value: "always", label: "When I open the chat", hint: "Blue ticks as soon as the conversation is on screen (WhatsApp default)." },
    {
      value: "on-reply",
      label: "Only when I reply",
      hint: "Read the chat silently; ticks turn blue the moment you send a message, file or reaction-free reply.",
    },
    {
      value: "manual",
      label: "Manually, with a button",
      hint: "Nothing is sent when you open a chat or a status. A ✓✓ button (chat header / status viewer) sends the receipt when you decide.",
    },
    { value: "never", label: "Never", hint: "Senders keep grey ticks. Status views are not reported either." },
  ];
  return (
    <>
      <Toggle
        label="Show typing indicator"
        hint='Sends "typing…" while you write. Off = they only see the message when it arrives.'
        checked={s.sendTyping}
        onChange={(v) => s.save({ sendTyping: v })}
      />
      <div>
        <div className="text-sm mb-1">Read receipts (blue ticks)</div>
        <div className="space-y-1.5">
          {receiptOptions.map((o) => (
            <label key={o.value} className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="readReceipts"
                className="mt-1"
                checked={s.readReceipts === o.value}
                onChange={() => s.save({ readReceipts: o.value })}
              />
              <span>
                <span className="block text-sm">{o.label}</span>
                <span className="block text-xs text-neutral-500">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </div>
      <Toggle
        label="Fetch link previews"
        hint="When a link has no preview from the sender, fetch the page's title/description/image yourself (a request to that site). Off = only sender-provided previews."
        checked={s.linkPreviews}
        onChange={async (v) => {
          await s.save({ linkPreviews: v });
          qc.invalidateQueries({ queryKey: ["messages"] });
        }}
      />
    </>
  );
}
