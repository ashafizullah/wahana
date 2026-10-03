import { Smartphone } from "lucide-react";
import { Button } from "./ui";
import { useWhatsApp } from "../store/whatsapp";

/** Ask App to switch to the Accounts tab from anywhere in the tree. */
export const openAccounts = () => window.dispatchEvent(new CustomEvent("wahana:open-accounts"));

/** Placeholder for screens that need a linked WhatsApp account. */
export function NotConnected() {
  const add = useWhatsApp((s) => s.add);
  return (
    <div className="flex-1 grid place-items-center text-neutral-500 text-sm p-6">
      <div className="flex flex-col items-center gap-3 max-w-md text-center">
        <Smartphone size={28} className="text-neutral-400" />
        <p className="font-medium text-neutral-700 dark:text-neutral-300">No WhatsApp account linked yet.</p>
        <p className="text-xs">Link your phone by scanning a QR code or entering a pairing code, like WhatsApp Web.</p>
        <Button onClick={() => void add().catch(console.error)}>Link a WhatsApp account</Button>
      </div>
    </div>
  );
}
