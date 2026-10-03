import { NotConnected } from "@/components/NotConnected";
import { NativeStatusScreen } from "@/screens/whatsapp/NativeStatusScreen";
import { useWhatsApp } from "@/store/whatsapp";

export function StatusScreen() {
  const active = useWhatsApp((s) => s.active);
  const accounts = useWhatsApp((s) => s.accounts);
  const account = accounts.find((a) => a.id === active) ?? accounts[0];
  if (!account) return <NotConnected />;
  return <NativeStatusScreen account={account} />;
}
