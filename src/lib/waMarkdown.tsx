import type { ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * Renders WhatsApp text formatting to React nodes:
 * *bold* _italic_ ~strike~ `inline` ```mono block``` , "- " / "* " bullets,
 * "1. " numbered lists, "> " quotes and clickable URLs.
 */
export function WaMarkdown({ text }: { text: string }) {
  return <>{renderBlocks(text)}</>;
}

const CODE_BLOCK = /```([\s\S]*?)```/g;

function renderBlocks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let key = 0;
  for (const m of text.matchAll(CODE_BLOCK)) {
    if (m.index! > last) out.push(...renderLines(text.slice(last, m.index), key++));
    out.push(
      <pre
        key={`c${key++}`}
        className="my-1 whitespace-pre-wrap break-words rounded bg-black/10 dark:bg-white/10 px-2 py-1 font-mono text-[12px]"
      >
        {m[1]}
      </pre>,
    );
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(...renderLines(text.slice(last), key++));
  return out;
}

type Line =
  | { t: "p"; s: string }
  | { t: "ul"; s: string }
  | { t: "ol"; s: string; n: string }
  | { t: "q"; s: string };

function classify(line: string): Line {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) return { t: "ul", s: m[1]! };
  if ((m = line.match(/^\s*(\d+)[.)]\s+(.*)$/))) return { t: "ol", s: m[2]!, n: m[1]! };
  if ((m = line.match(/^>\s?(.*)$/))) return { t: "q", s: m[1]! };
  return { t: "p", s: line };
}

function renderLines(text: string, seed: number): ReactNode[] {
  const lines = text.split("\n").map(classify);
  const out: ReactNode[] = [];
  let i = 0;
  let k = 0;
  const key = () => `${seed}-${k++}`;
  while (i < lines.length) {
    const cur = lines[i]!;
    if (cur.t === "ul" || cur.t === "ol") {
      const items: Line[] = [];
      const type = cur.t;
      while (i < lines.length && lines[i]!.t === type) items.push(lines[i++]!);
      out.push(
        type === "ul" ? (
          <ul key={key()} className="my-0.5 list-disc pl-5">
            {items.map((l) => (
              <li key={key()}>{renderInline(l.s)}</li>
            ))}
          </ul>
        ) : (
          <ol key={key()} className="my-0.5 list-decimal pl-5" start={Number((items[0] as { n: string }).n) || 1}>
            {items.map((l) => (
              <li key={key()}>{renderInline(l.s)}</li>
            ))}
          </ol>
        ),
      );
      continue;
    }
    if (cur.t === "q") {
      const qs: string[] = [];
      while (i < lines.length && lines[i]!.t === "q") qs.push(lines[i++]!.s);
      out.push(
        <blockquote key={key()} className="my-0.5 border-l-2 border-neutral-400/60 pl-2 opacity-80">
          {qs.map((s, j) => (
            <span key={j}>
              {renderInline(s)}
              {j < qs.length - 1 && <br />}
            </span>
          ))}
        </blockquote>,
      );
      continue;
    }
    // Paragraph line: keep as text + <br> so whitespace-pre-wrap layout stays natural.
    out.push(<span key={key()}>{renderInline(cur.s)}</span>);
    if (i < lines.length - 1) out.push(<br key={key()} />);
    i++;
  }
  return out;
}

const INLINE = new RegExp(
  [
    "(`[^`\\n]+`)", // 1 inline code
    "(\\*(?=\\S)(?:[^*\\n]*?\\S)\\*)", // 2 bold
    "(_(?=\\S)(?:[^_\\n]*?\\S)_)", // 3 italic
    "(~(?=\\S)(?:[^~\\n]*?\\S)~)", // 4 strike
    "(https?:\\/\\/[^\\s<>]+|www\\.[^\\s<>]+)", // 5 url
  ].join("|"),
  "g",
);

export function renderInline(text: string, depth = 0): ReactNode[] {
  if (depth > 3) return [text];
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const [full, code, bold, italic, strike, url] = m;
    if (code) out.push(<code key={k++} className="rounded bg-black/10 dark:bg-white/10 px-1 font-mono text-[12px]">{code.slice(1, -1)}</code>);
    else if (bold) out.push(<strong key={k++}>{renderInline(bold.slice(1, -1), depth + 1)}</strong>);
    else if (italic) out.push(<em key={k++}>{renderInline(italic.slice(1, -1), depth + 1)}</em>);
    else if (strike) out.push(<s key={k++}>{renderInline(strike.slice(1, -1), depth + 1)}</s>);
    else if (url) {
      // Trailing punctuation is rarely part of the link.
      const trimmed = url.replace(/[.,;:!?)\]]+$/, "");
      const trail = url.slice(trimmed.length);
      const href = trimmed.startsWith("http") ? trimmed : `https://${trimmed}`;
      out.push(
        <a
          key={k++}
          href={href}
          className="text-sky-600 dark:text-sky-400 underline break-all"
          onClick={(e) => {
            e.preventDefault();
            void openUrl(href);
          }}
        >
          {trimmed}
        </a>,
      );
      if (trail) out.push(trail);
    }
    last = m.index! + full.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Plain-text version for previews: removes formatting markers. */
export function stripWaMarkdown(text: string) {
  return text
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*(?=\S)([^*\n]*?\S)\*/g, "$1")
    .replace(/_(?=\S)([^_\n]*?\S)_/g, "$1")
    .replace(/~(?=\S)([^~\n]*?\S)~/g, "$1")
    .replace(/^\s*(?:[-*•]|\d+[.)]|>)\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}
