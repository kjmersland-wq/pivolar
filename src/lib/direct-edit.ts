// Edits an element picked in the preview straight in the source, without AI. The element is found by
// its tag, class list and text; text and Tailwind utilities are then rewritten in place. Anything
// that cannot be matched exactly is reported, so the caller can hand the request to the model.

export type FileMap = Record<string, string>;

export type Picked = { tag: string; text: string; className: string };

type Range = { start: number; end: number };

export type Target = {
  path: string;
  /** Position right after `<tag`, where a missing className attribute is inserted. */
  afterName: number;
  className: string;
  /** The characters inside the quotes of a static className, if the element has one. */
  classRange: Range | null;
  /** Plain text between the opening and closing tag, if the element only holds text. */
  textRange: Range | null;
  text: string | null;
};

export type Located = { ok: true; target: Target } | { ok: false; reason: string };

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();

const decode = (value: string) =>
  value.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");

/** Reads a static className value starting at `index` (just after `className=`). */
function readClassValue(code: string, index: number): { range: Range; value: string } | null {
  let i = index;
  const open = code[i];
  let braces = false;
  if (open === "{") {
    braces = true;
    i++;
    while (/\s/.test(code[i] ?? "")) i++;
  }
  const quote = code[i];
  if (quote !== '"' && quote !== "'" && quote !== "`") return null;
  const end = code.indexOf(quote, i + 1);
  if (end < 0) return null;
  const value = code.slice(i + 1, end);
  if (quote === "`" && value.includes("${")) return null;
  if (braces) {
    let j = end + 1;
    while (/\s/.test(code[j] ?? "")) j++;
    if (code[j] !== "}") return null;
  }
  return { range: { start: i + 1, end }, value };
}

type Tag = { name: string; afterName: number; end: number; selfClosing: boolean };

/** Finds every JSX opening tag. Generics such as `useState<Foo>` are skipped. */
function scanTags(code: string): Tag[] {
  const tags: Tag[] = [];
  const re = /<([A-Za-z][\w.]*)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const prev = code[m.index - 1];
    if (prev && /[\w$)\]]/.test(prev)) continue;
    const afterName = m.index + m[0].length;
    let depth = 0;
    let quote: string | null = null;
    for (let i = afterName; i < code.length; i++) {
      const c = code[i];
      if (quote) {
        if (c === "\\" && depth > 0) i++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        tags.push({ name: m[1]!, afterName, end: i + 1, selfClosing: code[i - 1] === "/" });
        break;
      }
    }
  }
  return tags;
}

function inspectTag(path: string, code: string, tag: Tag): Target {
  const attrs = code.slice(tag.afterName, tag.end);
  let className = "";
  let classRange: Range | null = null;
  const attr = /(?:^|\s)className=/.exec(attrs);
  if (attr) {
    const read = readClassValue(code, tag.afterName + attr.index + attr[0].length);
    if (read) {
      className = read.value;
      classRange = read.range;
    } else {
      className = "\u0000dynamic";
    }
  }
  let textRange: Range | null = null;
  let text: string | null = null;
  if (!tag.selfClosing) {
    const next = code.indexOf("<", tag.end);
    if (next > tag.end && code.startsWith(`</${tag.name}>`, next)) {
      const raw = code.slice(tag.end, next);
      if (raw.trim() && !/[{}]/.test(raw)) {
        textRange = { start: tag.end, end: next };
        text = normalize(decode(raw));
      }
    }
  }
  return { path, afterName: tag.afterName, className, classRange, textRange, text };
}

const sameTag = (source: string, dom: string) => {
  const last = source.split(".").pop()!.toLowerCase();
  return last === dom && (source === last || source.startsWith("motion."));
};

/** Finds the one place in the code that renders the picked element. */
export function locate(files: FileMap, picked: Picked): Located {
  const wantClass = normalize(picked.className);
  const truncated = picked.className.length >= 240;
  const wantText = normalize(picked.text).toLowerCase();
  let matches: Target[] = [];
  for (const [path, code] of Object.entries(files)) {
    if (!/\.(tsx|jsx)$/.test(path)) continue;
    for (const tag of scanTags(code)) {
      if (!sameTag(tag.name, picked.tag)) continue;
      const target = inspectTag(path, code, tag);
      const have = normalize(target.className);
      if (have.startsWith("\u0000")) continue;
      if (truncated ? !have.startsWith(wantClass) : have !== wantClass) continue;
      matches.push(target);
    }
  }
  if (matches.length === 0) return { ok: false, reason: "Fant ikke elementet i koden. Klassene er kanskje bygget dynamisk." };
  if (matches.length > 1) {
    const byText = matches.filter((t) => t.text !== null && t.text.toLowerCase() === wantText);
    if (byText.length > 0) matches = byText;
  }
  if (matches.length > 1) return { ok: false, reason: "Flere like elementer i koden. Be AI om å gjøre endringen." };
  return { ok: true, target: matches[0]! };
}

/** Replaces the text of a text-only element, keeping the indentation around it. */
export function applyText(files: FileMap, target: Target, text: string): FileMap {
  if (!target.textRange) return files;
  const code = files[target.path]!;
  const raw = code.slice(target.textRange.start, target.textRange.end);
  const lead = /^\s*/.exec(raw)![0];
  const trail = /\s*$/.exec(raw)![0];
  const clean = text.replace(/\s+/g, " ").trim();
  const body = /[{}<>]/.test(clean) ? `{${JSON.stringify(clean)}}` : clean;
  return { ...files, [target.path]: code.slice(0, target.textRange.start) + lead + body + trail + code.slice(target.textRange.end) };
}

/** Writes a new class list, adding the className attribute when the element has none. */
export function applyClasses(files: FileMap, target: Target, className: string): FileMap {
  const code = files[target.path]!;
  const value = className.trim();
  if (target.classRange) {
    return { ...files, [target.path]: code.slice(0, target.classRange.start) + value + code.slice(target.classRange.end) };
  }
  return { ...files, [target.path]: `${code.slice(0, target.afterName)} className="${value}"${code.slice(target.afterName)}` };
}

// ---------------------------------------------------------------------------------------------
// Tailwind utilities

const COLORS = "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const COLOR_VALUE = `(?:white|black|transparent|current|(?:${COLORS})-\\d{2,3}|\\[#[0-9a-fA-F]{3,8}\\])(?:/\\d{1,3})?`;

export type Group = "color" | "background" | "size" | "weight";

const GROUPS: Record<Group, RegExp> = {
  color: new RegExp(`^text-${COLOR_VALUE}$`),
  background: new RegExp(`^bg-${COLOR_VALUE}$`),
  size: /^text-(xs|sm|base|lg|xl|[2-9]xl)$/,
  weight: /^font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)$/,
};

export const SIZES = ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl"] as const;
export const WEIGHTS = ["light", "normal", "medium", "semibold", "bold", "extrabold"] as const;

const tokens = (className: string) => className.split(/\s+/).filter(Boolean);

/** The current utility of each group. Variant utilities (`md:text-lg`) are left alone. */
export function readStyle(className: string): Partial<Record<Group, string>> {
  const out: Partial<Record<Group, string>> = {};
  for (const token of tokens(className)) {
    if (token.includes(":")) continue;
    for (const group of Object.keys(GROUPS) as Group[]) if (GROUPS[group].test(token)) out[group] = token;
  }
  return out;
}

/** Replaces the utility of one group, in the place of the old one. `null` removes it. */
export function setUtility(className: string, group: Group, utility: string | null): string {
  const out: string[] = [];
  let placed = false;
  for (const token of tokens(className)) {
    if (!token.includes(":") && GROUPS[group].test(token)) {
      if (utility && !placed) out.push(utility);
      placed = true;
    } else {
      out.push(token);
    }
  }
  if (utility && !placed) out.push(utility);
  return out.join(" ");
}

/** One step up or down the Tailwind text-size ladder, from `text-base` when none is set. */
export function stepSize(className: string, direction: 1 | -1): string {
  const current = readStyle(className).size?.slice("text-".length) ?? "base";
  const index = SIZES.indexOf(current as (typeof SIZES)[number]);
  const next = SIZES[Math.min(SIZES.length - 1, Math.max(0, index + direction))]!;
  return setUtility(className, "size", `text-${next}`);
}
