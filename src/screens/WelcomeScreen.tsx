import { ArrowRight, Smartphone } from "lucide-react";
import { useWhatsApp } from "@/store/whatsapp";
import { cn } from "@/lib/utils";

/** Ask App to show the welcome screen again (Settings → About). */
export const openWelcome = () => window.dispatchEvent(new CustomEvent("wahana:open-welcome"));

/**
 * First-run screen: shown while the app has no WhatsApp account linked. Link a device by
 * scanning the QR code, or skip to Settings.
 */
export function WelcomeScreen({ onDone }: { onDone: (tab: "chats" | "settings") => void }) {
  const addWa = useWhatsApp((s) => s.add);
  return (
    <div className="flex-1 overflow-auto grid place-items-center p-6">
      <div className="w-full max-w-2xl space-y-6">
        <div className="text-center space-y-2">
          <img src="/logo.png" alt="" className="w-16 h-16 mx-auto rounded-2xl shadow" />
          <h1 className="text-2xl font-semibold">Welcome to Wahana</h1>
          <p className="text-sm text-neutral-500">A desktop client for your WhatsApp account. Link your phone to get started.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Card
            icon={Smartphone}
            title="Link WhatsApp"
            body="No server needed. Scan the QR code with your phone to link this app as a device. Add more accounts later."
            action="Link an account"
            onClick={() => {
              void addWa("WhatsApp").catch(console.error);
              onDone("chats");
            }}
          />
        </div>

        <p className="text-center text-xs text-neutral-500">
          Know your way around?{" "}
          <button className="underline hover:text-wa-dark" onClick={() => onDone("settings")}>
            Skip to Settings
          </button>
          . You can bring this screen back from Settings → About.
        </p>
      </div>
    </div>
  );
}

function Card({
  icon: Icon,
  title,
  body,
  action,
  onClick,
}: {
  icon: typeof Smartphone;
  title: string;
  body: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group text-left rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3",
        "hover:border-wa-dark hover:shadow-md transition",
      )}
    >
      <Icon size={24} className="text-wa-dark" />
      <h2 className="font-semibold">{title}</h2>
      <p className="text-sm text-neutral-500 min-h-[3.5rem]">{body}</p>
      <span className="inline-flex items-center gap-1 text-sm font-medium text-wa-dark">
        {action} <ArrowRight size={14} className="transition group-hover:translate-x-0.5" />
      </span>
    </button>
  );
}
