"use client";

import { useEffect, useRef, useState } from "react";
import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, ArrowUp, Check, FilePen, FilePlus2, Hammer, Loader2, MessageSquare, Square, Trash2, Undo2 } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { LogoMark } from "@/components/Logo";
import { cn } from "@/lib/utils";

type Part = { type: string; text?: string; state?: string; input?: Record<string, unknown>; output?: { ok?: boolean; message?: string } };

export type Mode = "build" | "chat";

type Props = {
  messages: UIMessage[];
  status: "submitted" | "streaming" | "ready" | "error";
  error?: Error | undefined;
  mode: Mode;
  onModeChange: (mode: Mode) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onRevert: (messageId: string) => void;
};

const STEP_META: Record<string, { icon: typeof FilePen; active: string; done: string }> = {
  writeFile: { icon: FilePlus2, active: "Skriver", done: "Skrev" },
  editFile: { icon: FilePen, active: "Endrer", done: "Endret" },
  deleteFile: { icon: Trash2, active: "Sletter", done: "Slettet" },
};

function ToolStep({ part }: { part: Part }) {
  const name = part.type.slice(5);
  const meta = STEP_META[name];
  if (!meta) return null;
  const path = String(part.input?.path ?? "");
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
      {failed && part.output?.message && <span className="ml-auto truncate text-[11.5px]">{part.output.message}</span>}
    </motion.div>
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

  function submit() {
    const text = input.trim();
    if (!text || busy) return;
    onSend(text);
    setInput("");
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
                <div className="max-w-[88%] whitespace-pre-wrap rounded-2xl rounded-tr-md border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] leading-relaxed">
                  {(message.parts as Part[]).map((p) => (p.type === "text" ? p.text : "")).join("")}
                </div>
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
        <div className="glass rounded-2xl p-2 shadow-[var(--shadow)] transition focus-within:border-line-strong">
          <textarea
            ref={textarea}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
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
            {busy ? (
              <button type="button" onClick={onStop} className="grid size-8 place-items-center rounded-lg bg-fg text-bg transition hover:opacity-85" aria-label="Stopp">
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!input.trim()}
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
