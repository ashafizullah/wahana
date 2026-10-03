import { AccountPicker } from "@/components/AccountPicker";
import { NotConnected } from "@/components/NotConnected";
import { WhatsAppScreen } from "@/screens/WhatsAppScreen";
import { useWhatsApp } from "@/store/whatsapp";

export function ChatScreen() {
  const active = useWhatsApp((s) => s.active);
  const accounts = useWhatsApp((s) => s.accounts);
  const account = accounts.find((a) => a.id === active) ?? accounts[0];
  if (!account) return <NotConnected />;
  return <WhatsAppScreen account={account} header={<AccountPicker />} />;
}
