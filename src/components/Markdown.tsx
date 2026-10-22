import { Fragment, type ReactNode } from "react";

/** A deliberately small renderer: paragraphs, lists, code blocks, inline code and bold. */
function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = pattern.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("`")) {
      parts.push(
        <code key={key++} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[0.85em] text-fg">
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      parts.push(<strong key={key++} className="font-semibold text-fg">{token.slice(2, -2)}</strong>);
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith("```")) code.push(lines[i++]!);
      i++;
      blocks.push(
        <pre key={key++} className="my-2 overflow-x-auto rounded-xl border border-line bg-bg-soft p-3 font-mono text-[12.5px] leading-relaxed">
          {code.join("\n")}
        </pre>,
      );
    } else if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*]\s+/, ""));
      blocks.push(
        <ul key={key++} className="my-1.5 list-disc space-y-1 pl-5">
          {items.map((item, n) => (
            <li key={n}>{inline(item)}</li>
          ))}
        </ul>,
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      const paragraph: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== "" && !lines[i]!.startsWith("```") && !/^\s*[-*]\s+/.test(lines[i]!)) {
        paragraph.push(lines[i++]!);
      }
      blocks.push(
        <p key={key++} className="my-1.5">
          {paragraph.map((l, n) => (
            <Fragment key={n}>
              {n > 0 && <br />}
              {inline(l)}
            </Fragment>
          ))}
        </p>,
      );
    }
  }
  return <div className="text-[14px] leading-relaxed text-muted [&>*:first-child]:mt-0">{blocks}</div>;
}
