import { useContext } from "react";
import { Toggle } from "./shared";
import { ScopeCtx } from "./shared";
import { useQueryClient } from "@tanstack/react-query";
import { useSettings, type ReadReceipts } from "@/store/settings";
import { Button } from "@/components/ui";

export function TweaksSection() {
  const s = useSettings();
  const { scope } = useContext(ScopeCtx);
  const qc = useQueryClient();

  // With an account selected these show its override, or the global default it inherits.
  const sendTyping = scope ? (s.sendTypingByAccount[scope] ?? s.sendTyping) : s.sendTyping;
  const readReceipts = scope ? (s.readReceiptsByAccount[scope] ?? s.readReceipts) : s.readReceipts;
  const overridden = !!scope && (scope in s.sendTypingByAccount || scope in s.readReceiptsByAccount);

  const setSendTyping = (v: boolean) =>
    scope ? s.save({ sendTypingByAccount: { ...s.sendTypingByAccount, [scope]: v } }) : s.save({ sendTyping: v });
  const setReadReceipts = (v: ReadReceipts) =>
    scope ? s.save({ readReceiptsByAccount: { ...s.readReceiptsByAccount, [scope]: v } }) : s.save({ readReceipts: v });
  const reset = () => {
    if (!scope) return;
    const sendTypingByAccount = { ...s.sendTypingByAccount };
    const readReceiptsByAccount = { ...s.readReceiptsByAccount };
    delete sendTypingByAccount[scope];
    delete readReceiptsByAccount[scope];
    void s.save({ sendTypingByAccount, readReceiptsByAccount });
  };

  const receiptOptions: { value: ReadReceipts; label: string; hint: string }[] = [
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
      {scope && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span className="flex-1">{overridden ? "This account has its own values." : "This account uses the defaults."}</span>
          {overridden && (
            <Button size="sm" variant="ghost" onClick={reset}>
              Reset to default
            </Button>
          )}
        </div>
      )}
      <Toggle
        label="Show typing indicator"
        hint='Sends "typing…" while you write. Off = they only see the message when it arrives.'
        checked={sendTyping}
        onChange={setSendTyping}
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
                checked={readReceipts === o.value}
                onChange={() => setReadReceipts(o.value)}
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
