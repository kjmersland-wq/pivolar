"use client";

import { useEffect, useRef, useState } from "react";
import type { FileUIPart, UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { money } from "@/lib/usage/client";
import { ScanSearch, Sparkles, AlertTriangle, ArrowUp, Check, FilePen, FilePlus2, Hammer, ImageIcon, Loader2, MessageSquare, MousePointerClick, Paperclip, Square, Trash2, Undo2, X } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { LogoMark } from "@/components/Logo";
import { cn } from "@/lib/utils";

type Part = { type: string; text?: string; url?: string; mediaType?: string; filename?: string; state?: string; input?: Record<string, unknown>; output?: { ok?: boolean; message?: string } };

export type Mode = "build" | "chat";

type Props = {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error?: Error | undefined;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onSend: (text: string, files: FileUIPart[]) => void;
  onStop: () => void;
  onRevert: (messageId: string) => void;
};

const MAX_IMAGES = 4;

/** Shrinks a picture before sending: smaller requests, and it fits in browser storage. */
async function toDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

const PICKED = /<valgt-element>([\s\S]*?)<\/valgt-element>/;

function UserMessage({ message }: { message: UIMessage }) {
  const parts = message.parts as Part[];
  const raw = parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  const picked = PICKED.exec(raw)?.[1];
  const text = raw.replace(PICKED, "").trim();
  const tag = picked ? /Element: (<[^>\s]+>)/.exec(picked)?.[1] : undefined;
  const images = parts.filter((p) => p.type === "file" && p.mediaType?.startsWith("image/"));
  return (
    <div className="flex max-w-[88%] flex-col items-end gap-2">
      {images.length > 0 && (
        <div className="flex flex-wrap justify-end gap-2">
          {images.map((image, index) =>
            image.url ? (
              // eslint-disable-next-line @next/next/no-img-element -- user pictures are data URLs
              <img key={index} src={image.url} alt={image.filename ?? "Bilde"} className="max-h-40 max-w-[220px] rounded-xl border border-line object-cover" />
            ) : (
              <div key={index} className="flex items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-2 text-[12px] text-faint">
                <ImageIcon className="size-3.5" />
                Bilde (ikke lagret)
              </div>
            ),
          )}
        </div>
      )}
      {(text || picked) && (
        <div className="whitespace-pre-wrap rounded-2xl rounded-tr-md border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] leading-relaxed">
          {picked && (
            <span className="mb-1.5 flex w-fit items-center gap-1.5 rounded-md bg-accent/10 px-2 py-0.5 text-[11.5px] text-accent">
              <MousePointerClick className="size-3" />
              Valgt element {tag}
            </span>
          )}
          {text}
        </div>
      )}
    </div>
  );
}

const STEP_META: Record<string, { icon: typeof FilePen; active: string; done: string }> = {
  writeFile: { icon: FilePlus2, active: "Skriver", done: "Skrev" },
  editFile: { icon: FilePen, active: "Endrer", done: "Endret" },
  deleteFile: { icon: Trash2, active: "Sletter", done: "Slettet" },
  searchImages: { icon: ImageIcon, active: "Søker etter bilder", done: "Fant bilder" },
  generateImage: { icon: Sparkles, active: "Lager bilde", done: "Lagde bilde" },
  analyzeSite: { icon: ScanSearch, active: "Måler referansesiden", done: "Målte referansesiden" },
};

function ToolStep({ part }: { part: Part }) {
  const name = part.type.slice(5);
  const meta = STEP_META[name];
  if (!meta) return null;
  const path = String(part.input?.path ?? part.input?.query ?? part.input?.url ?? String(part.input?.prompt ?? "").slice(0, 60));
  const failed = part.state === "output-error" || part.output?.ok === false;
  const done = part.state === "output-available" && !failed;
  const Icon = meta.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[12.5px]",
        failed ? "border-red-500/30 bg-red-500/5 text-red-400" : "border-line bg-surface/60 text-muted",
      )}
    >
      <span className="grid size-5 place-items-center">
        {failed ? <AlertTriangle className="size-3.5" /> : done ? <Check className="size-3.5 text-emerald-400" /> : <Loader2 className="size-3.5 animate-spin text-accent" />}
      </span>
      <Icon className="size-3.5 shrink-0 opacity-70" />
      <span className="truncate">
        <span className={cn(!done && !failed && "text-fg")}>{done || failed ? meta.done : meta.active}</span>{" "}
        <span className="font-mono text-[12px] text-fg/90">{path || "…"}</span>
      </span>
      {done && name === "generateImage" && (part.output as { url?: string } | undefined)?.url && (
        // eslint-disable-next-line @next/next/no-img-element -- a small preview of a picture stored elsewhere
        <img src={(part.output as { url: string }).url} alt="" className="ml-auto size-9 shrink-0 rounded-md border border-line object-cover" />
      )}
      {failed && part.output?.message && <span className="ml-auto truncate text-[11.5px]">{part.output.message}</span>}
    </motion.div>
  );
}

type Metadata = { costUsd?: number; inputTokens?: number; outputTokens?: number; cachedTokens?: number; stopped?: string };

/** What one answer cost. An estimate from tokens, like the usage page; the provider's own figure counts. */
function Cost({ metadata }: { metadata: unknown }) {
  const m = metadata as Metadata | undefined;
  if (!m || typeof m.costUsd !== "number") return null;
  const tokens = (m.inputTokens ?? 0) + (m.outputTokens ?? 0);
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[11.5px] tabular-nums text-faint" title="Anslått kostnad for dette svaret, fra antall tokens">
      <span>≈ {money(m.costUsd)}</span>
      <span>· {tokens.toLocaleString("nb-NO")} tokens</span>
      {m.cachedTokens ? <span>· {Math.round((m.cachedTokens / Math.max(m.inputTokens ?? 1, 1)) * 100)} % fra mellomlager</span> : null}
      {m.stopped ? <span className="text-amber-400">· stoppet av løkkevakten</span> : null}
    </p>
  );
}

function AssistantMessage({ message, last, busy, onRevert }: { message: UIMessage; last: boolean; busy: boolean; onRevert: () => void }) {
  const parts = message.parts as Part[];
  const hasContent = parts.some((p) => (p.type === "text" && p.text?.trim()) || p.type.startsWith("tool-"));
  return (
    <div className="group flex gap-3">
      <LogoMark className="mt-0.5 size-7 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1 space-y-2">
        {parts.map((part, index) => {
          if (part.type === "text" && part.text?.trim()) return <Markdown key={index} text={part.text} />;
          if (part.type.startsWith("tool-")) return <ToolStep key={index} part={part} />;
          return null;
        })}
        {!hasContent && busy && last && <div className="shimmer h-4 w-40 rounded-md" />}
        {!busy && hasContent && <Cost metadata={message.metadata} />}
        {!busy && !last && hasContent && (
          <button
            type="button"
            onClick={onRevert}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] text-faint opacity-0 transition hover:bg-surface-2 hover:text-fg group-hover:opacity-100"
          >
            <Undo2 className="size-3.5" />
            Gå tilbake hit
          </button>
        )}
      </div>
    </div>
  );
}

export function ChatPanel({ messages, status, error, mode, onModeChange, onSend, onStop, onRevert }: Props) {
  const [input, setInput] = useState("");
  const [images, setImages] = useState<{ id: string; url: string; name: string }[]>([]);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const busy = status === "submitted" || status === "streaming";

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, status]);

  useEffect(() => {
    const el = textarea.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [input]);

  async function addFiles(list: FileList | File[]) {
    const wanted = Array.from(list).filter((file) => file.type.startsWith("image/"));
    for (const file of wanted.slice(0, Math.max(0, MAX_IMAGES - images.length))) {
      try {
        const url = await toDataUrl(file);
        setImages((prev) => (prev.length >= MAX_IMAGES ? prev : [...prev, { id: crypto.randomUUID(), url, name: file.name || "bilde.jpg" }]));
      } catch {
        /* an unreadable file is simply skipped */
      }
    }
  }

  function submit() {
    const text = input.trim();
    if ((!text && images.length === 0) || busy) return;
    const files: FileUIPart[] = images.map((image) => ({ type: "file", mediaType: "image/jpeg", filename: image.name, url: image.url }));
    onSend(text || "Bygg dette etter bildet.", files);
    setInput("");
    setImages([]);
  }

  const lastAssistantIndex = messages.reduce((acc, m, i) => (m.role === "assistant" ? i : acc), -1);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scroller} className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 py-5">
        {messages.length === 0 && (
          <div className="grid h-full place-items-center text-center">
            <div className="max-w-xs space-y-2">
              <LogoMark className="mx-auto size-10 rounded-xl" />
              <p className="text-[15px] font-medium">Hva skal vi bygge?</p>
              <p className="text-[13px] leading-relaxed text-muted">Beskriv appen eller siden du vil ha. Jeg bygger den, og du ser den med en gang.</p>
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((message, index) =>
            message.role === "user" ? (
              <motion.div key={message.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
                <UserMessage message={message} />
              </motion.div>
            ) : (
              <motion.div key={message.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <AssistantMessage
                  message={message}
                  last={index === messages.length - 1}
                  busy={busy}
                  onRevert={() => onRevert(message.id)}
                />
              </motion.div>
            ),
          )}
        </AnimatePresence>

        {busy && messages[messages.length - 1]?.role === "user" && (
          <div className="flex items-center gap-3">
            <LogoMark className="size-7 rounded-lg" />
            <div className="flex items-center gap-1.5 text-[13px] text-muted">
              <span className="pulse-dot size-1.5 rounded-full bg-accent" />
              Tenker …
            </div>
          </div>
        )}

        {error && status === "error" && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-[13px] text-red-400">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error.message || "Noe gikk galt. Prøv igjen."}</span>
          </div>
        )}
        <span className="hidden">{lastAssistantIndex}</span>
      </div>

      <div className="border-t border-line p-3">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            void addFiles(e.dataTransfer.files);
          }}
          className={cn("glass rounded-2xl p-2 shadow-[var(--shadow)] transition focus-within:border-line-strong", dragging && "border-accent")}
        >
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-1.5 pb-1.5 pt-1">
              {images.map((image) => (
                <div key={image.id} className="group/thumb relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
                  <img src={image.url} alt={image.name} className="size-14 rounded-lg border border-line object-cover" />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((p) => p.id !== image.id))}
                    className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-fg text-bg opacity-0 transition group-hover/thumb:opacity-100"
                    aria-label="Fjern bilde"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={textarea}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const pasted = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (pasted.length > 0) {
                e.preventDefault();
                void addFiles(pasted);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={mode === "build" ? "Be om en endring eller en ny funksjon …" : "Snakk om idéen, uten å endre koden …"}
            className="block max-h-[200px] w-full resize-none bg-transparent px-2.5 py-2 text-[14px] leading-relaxed outline-none placeholder:text-faint"
          />
          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-1">
            <input ref={picker} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ""; }} />
            <button
              type="button"
              onClick={() => picker.current?.click()}
              disabled={images.length >= MAX_IMAGES}
              className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg disabled:opacity-40"
              aria-label="Legg ved bilde"
              title="Legg ved bilde (eller lim inn / dra hit)"
            >
              <Paperclip className="size-4" />
            </button>
            <div className="flex rounded-lg bg-surface-2 p-0.5 text-[12px]">
              {(
                [
                  ["build", "Bygg", Hammer],
                  ["chat", "Chat", MessageSquare],
                ] as const
              ).map(([value, label, Icon]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onModeChange(value)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 transition",
                    mode === value ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg",
                  )}
                >
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
            </div>
            {busy ? (
              <button type="button" onClick={onStop} className="grid size-8 place-items-center rounded-lg bg-fg text-bg transition hover:opacity-85" aria-label="Stopp">
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim() && images.length === 0}
                className="bg-brand grid size-8 place-items-center rounded-lg text-white shadow-[0_6px_18px_-6px_var(--accent)] transition enabled:hover:brightness-110 disabled:opacity-40 disabled:shadow-none"
                aria-label="Send"
              >
                <ArrowUp className="size-4" />
              </button>
            )}
          </div>
        </div>
        <p className="px-1 pt-2 text-center text-[11px] text-faint">Enter sender · Shift+Enter gir ny linje</p>
      </div>
    </div>
  );
}
