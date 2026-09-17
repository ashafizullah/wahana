import type { WAMessage } from "@/api/types";
import { WaMarkdown, type MentionResolver } from "@/lib/waMarkdown";
import { cn } from "@/lib/utils";

/** Shape of `message.replyTo` from WAHA (quoted message summary). */
export interface ReplyTo {
  id: string;
  participant?: string | null;
  body?: string | null;
  hasMedia?: boolean;
  media?: { mimetype?: string | null } | null;
  _data?: Record<string, RawQuoted> | null;
}

interface RawQuoted {
  JPEGThumbnail?: string;
  caption?: string;
  fileName?: string;
  text?: string;
  name?: string;
  title?: string;
  seconds?: number;
}

/** Summarise a quoted message: kind label + text + thumbnail (from the embedded JPEG). */
export function describeQuoted(q: ReplyTo | WAMessage) {
  const raw =
    ("_data" in q && q._data && !("Message" in (q._data as object))
      ? (q._data as Record<string, RawQuoted>)
      : ((q as WAMessage)._data as { Message?: Record<string, RawQuoted> } | undefined)?.Message) ?? {};
  const key = Object.keys(raw).find((k) => k !== "messageContextInfo");
  const inner = key ? raw[key] : undefined;
  const thumb = inner?.JPEGThumbnail ? `data:image/jpeg;base64,${inner.JPEGThumbnail}` : null;
  const text = q.body || inner?.caption || inner?.text || "";
  let kind = "";
  switch (key) {
    case "imageMessage":
      kind = "📷 Photo";
      break;
    case "videoMessage":
      kind = "🎬 Video";
      break;
    case "stickerMessage":
      kind = "🎟️ Sticker";
      break;
    case "audioMessage":
      kind = "🎤 Voice message";
      break;
    case "documentMessage":
      kind = `📄 ${inner?.fileName ?? "Document"}`;
      break;
    case "locationMessage":
      kind = "📍 Location";
      break;
    case "contactMessage":
      kind = "👤 Contact";
      break;
    case "pollCreationMessage":
    case "pollCreationMessageV2":
    case "pollCreationMessageV3":
      kind = `📊 ${inner?.name ?? "Poll"}`;
      break;
  }
  return { thumb, text, kind };
}

export function QuoteView({
  quote,
  resolveName,
  myIds,
  onClick,
  className,
}: {
  quote: ReplyTo | WAMessage;
  resolveName: MentionResolver;
  myIds: string[];
  onClick?: () => void;
  className?: string;
}) {
  const participant = (("participant" in quote ? quote.participant : null) || ("from" in quote ? quote.from : null) || "") as string;
  const mine = ("fromMe" in quote && quote.fromMe) || myIds.some((id) => id && participant.split("@")[0] === id.split("@")[0]);
  const who = mine ? "You" : (resolveName(participant) ?? participant.split("@")[0]);
  const { thumb, text, kind } = describeQuoted(quote);
  return (
    <div
      onClick={onClick}
      className={cn(
        "flex items-stretch gap-2 rounded-md border-l-[3px] border-wa-dark bg-black/5 dark:bg-white/10 pl-2 pr-1 py-1 text-xs overflow-hidden",
        onClick && "cursor-pointer hover:bg-black/10 dark:hover:bg-white/15",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-wa-dark dark:text-wa truncate">{who}</div>
        {kind && !text && <div className="opacity-70">{kind}</div>}
        {text && (
          <div className="opacity-80 line-clamp-3 break-words">
            {kind && <span className="mr-1">{kind.split(" ")[0]}</span>}
            <WaMarkdown text={text} mentions={resolveName} />
          </div>
        )}
      </div>
      {thumb && <img src={thumb} alt="" className="w-12 h-12 rounded object-cover shrink-0 self-center" />}
    </div>
  );
}
