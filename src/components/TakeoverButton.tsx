import { useQuery } from "@tanstack/react-query";
import { Bot, Hand } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { activeRules } from "@/store/autoReply";
import { takeoverKey, useChatPrefs } from "@/store/chatPrefs";

/**
 * Take a chat over from auto-reply (it stays silent there) or release it back. Shown only when
 * the account has auto-reply rules, or the chat is already taken over.
 */
export function TakeoverButton({ account, chatId, name }: { account: string; chatId: string; name: string }) {
  const taken = useChatPrefs((s) => !!s.takeover[takeoverKey(account, chatId)]);
  const setTakeover = useChatPrefs((s) => s.setTakeover);
  const rules = useQuery({ queryKey: ["auto-reply", "active", account], queryFn: () => activeRules(account), staleTime: 30_000 });
  if (!taken && !rules.data?.length) return null;
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTakeover(account, chatId, taken ? null : name)}
      title={
        taken
          ? "You handle this chat — auto-reply is off here. Click to hand it back to auto-reply."
          : "Take over: stop auto-reply in this chat until you release it"
      }
      className={cn("gap-1 text-xs", taken && "text-amber-600 dark:text-amber-400")}
    >
      {taken ? (
        <>
          <Hand size={16} /> Taken over
        </>
      ) : (
        <Bot size={16} />
      )}
    </Button>
  );
}
