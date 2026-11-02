import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// Claude's replies are Markdown. This renders the little of it a chat reply uses
// (paragraphs, lists, headings, code, bold, italics, links) as React elements: nothing it says
// ever becomes HTML, so a reply can't inject anything into the console.

const INLINE = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\s][^*\n]*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\))/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={i} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    if (link) {
      return (
        <a
          key={i}
          href={link[2]}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-primary"
        >
          {link[1]}
        </a>
      );
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

type Block =
  | { type: "code"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "paragraph"; text: string };

function blocks(source: string): Block[] {
  const out: Block[] = [];
  const lines = source.replace(/\r/g, "").split("\n");
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) out.push({ type: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith("```")) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trimStart().startsWith("```"); i++)
        code.push(lines[i]);
      out.push({ type: "code", text: code.join("\n") });
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const item = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      out.push({ type: "heading", text: heading[1] });
    } else if (item) {
      flush();
      const ordered = Boolean(item[2]);
      const last = out[out.length - 1];
      if (last?.type === "list" && last.ordered === ordered) last.items.push(item[3]);
      else out.push({ type: "list", ordered, items: [item[3]] });
    } else if (!line.trim()) {
      flush();
    } else {
      const last = out[out.length - 1];
      // A wrapped line of a list item belongs to it.
      if (!paragraph.length && last?.type === "list" && /^\s{2,}/.test(line)) {
        last.items[last.items.length - 1] += ` ${line.trim()}`;
      } else paragraph.push(line);
    }
  }
  flush();
  return out;
}

export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("space-y-2 text-sm leading-relaxed break-words", className)}>
      {blocks(text).map((block, i) => {
        switch (block.type) {
          case "code":
            return (
              <pre
                key={i}
                className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-snug"
              >
                {block.text}
              </pre>
            );
          case "heading":
            return (
              <p key={i} className="font-semibold">
                {inline(block.text)}
              </p>
            );
          case "list": {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={i}
                className={cn("space-y-1 pl-5", block.ordered ? "list-decimal" : "list-disc")}
              >
                {block.items.map((item, j) => (
                  <li key={j}>{inline(item)}</li>
                ))}
              </List>
            );
          }
          default:
            return (
              <p key={i} className="whitespace-pre-wrap">
                {inline(block.text)}
              </p>
            );
        }
      })}
    </div>
  );
}
