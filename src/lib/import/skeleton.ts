import type { Block } from "./model.ts";

/**
 * The page as the AI will see it: the structure of the blocks, and only a few words of each text
 * as a hint. The texts themselves stay in `slots`, and the components are given them as data. That
 * way the AI never has to read or write the body text of the old site, which is what keeps the
 * cost of an import almost the same for 8 pages and for 80.
 */

export type Skeleton = {
  /** One line per block, indented for blocks inside blocks. */
  text: string;
  /** Slot name to the real content: t = text (inline HTML), m = picture address, l = link address. */
  slots: Record<string, string>;
};

const HINT = 48;

const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&(amp|lt|gt|quot);/g, (_, e: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"' })[e]!).replace(/\s+/g, " ").trim();
const hint = (text: string) => {
  const plain = strip(text);
  return plain.length > HINT ? `${plain.slice(0, HINT).trimEnd()}…` : plain;
};

export function toSkeleton(blocks: Block[]): Skeleton {
  const slots: Record<string, string> = {};
  const counter = { t: 0, m: 0, l: 0 };
  const slot = (kind: "t" | "m" | "l", value: string) => {
    const name = `${kind}${++counter[kind]}`;
    slots[name] = value;
    return name;
  };
  const lines: string[] = [];

  const emit = (list: Block[], depth: number) => {
    const pad = "  ".repeat(depth);
    for (const b of list) {
      switch (b.type) {
        case "heading":
          lines.push(`${pad}heading[${b.level}] {${slot("t", b.text)}: "${hint(b.text)}"}`);
          break;
        case "paragraph":
          lines.push(`${pad}paragraph {${slot("t", b.html)}: "${hint(b.html)}"}`);
          break;
        case "image":
          lines.push(`${pad}image {${slot("m", b.src)}} alt="${hint(b.alt)}"${b.href ? ` link {${slot("l", b.href)}}` : ""}${b.caption ? ` caption {${slot("t", b.caption)}}` : ""}${b.width && b.height ? ` ${b.width}x${b.height}` : ""}`);
          break;
        case "gallery":
          lines.push(`${pad}gallery ${b.images.map((i) => `{${slot("m", i.src)}}`).join(" ")}`);
          break;
        case "list":
          lines.push(`${pad}list(${b.ordered ? "ordered" : "unordered"}) ${b.items.map((i) => `{${slot("t", i)}: "${hint(i)}"}`).join(" ")}`);
          break;
        case "quote":
          lines.push(`${pad}quote {${slot("t", b.html)}: "${hint(b.html)}"}${b.cite ? ` cite {${slot("t", b.cite)}}` : ""}`);
          break;
        case "button":
          lines.push(`${pad}button {${slot("t", b.label)}: "${hint(b.label)}"} link {${slot("l", b.href)}}`);
          break;
        case "table":
          lines.push(`${pad}table ${b.rows.length}x${Math.max(...b.rows.map((r) => r.length))}${b.header ? " with-header" : ""} {${slot("t", JSON.stringify(b.rows))}}`);
          break;
        case "embed":
          lines.push(`${pad}embed(${b.provider}) {${slot("l", b.src)}}`);
          break;
        case "video":
          lines.push(`${pad}video {${slot("l", b.src)}}`);
          break;
        case "audio":
          lines.push(`${pad}audio {${slot("l", b.src)}}`);
          break;
        case "code":
          lines.push(`${pad}code {${slot("t", b.text)}}`);
          break;
        case "divider":
          lines.push(`${pad}divider`);
          break;
        case "unknown":
          lines.push(`${pad}unknown(${b.reason})${b.text ? ` {${slot("t", b.text)}: "${hint(b.text)}"}` : ""}`);
          break;
        case "columns":
          lines.push(`${pad}columns(${b.columns.length})`);
          b.columns.forEach((column, i) => {
            lines.push(`${pad}  column ${i + 1}`);
            emit(column, depth + 2);
          });
          break;
      }
    }
  };
  emit(blocks, 0);
  return { text: lines.join("\n"), slots };
}

/** A rough count of how many tokens a text is. Four characters to a token is close enough for a budget. */
export const roughTokens = (text: string) => Math.ceil(text.length / 4);
