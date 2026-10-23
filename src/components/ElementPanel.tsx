"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUp, Minus, MousePointerClick, Plus, Sparkles, X } from "lucide-react";
import { applyClasses, applyText, locate, readStyle, setUtility, stepSize, WEIGHTS, type FileMap, type Group } from "@/lib/direct-edit";
import { cn } from "@/lib/utils";

export type Picked = { tag: string; text: string; className: string; html: string; components: string[] };

const SWATCHES: { value: string; hex: string }[] = [
  { value: "white", hex: "#ffffff" },
  { value: "slate-900", hex: "#0f172a" },
  { value: "slate-500", hex: "#64748b" },
  { value: "rose-500", hex: "#f43f5e" },
  { value: "orange-500", hex: "#f97316" },
  { value: "amber-400", hex: "#fbbf24" },
  { value: "emerald-500", hex: "#10b981" },
  { value: "sky-500", hex: "#0ea5e9" },
  { value: "indigo-500", hex: "#6366f1" },
  { value: "violet-500", hex: "#8b5cf6" },
];

const WEIGHT_LABELS: Record<(typeof WEIGHTS)[number], string> = {
  light: "Lett",
  normal: "Normal",
  medium: "Medium",
  semibold: "Halvfet",
  bold: "Fet",
  extrabold: "Ekstra fet",
};

function Swatches({ prefix, group, current, onPick }: { prefix: "text" | "bg"; group: Group; current: string | undefined; onPick: (group: Group, utility: string | null) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SWATCHES.map((swatch) => {
        const utility = `${prefix}-${swatch.value}`;
        return (
          <button
            key={swatch.value}
            type="button"
            title={swatch.value}
            aria-label={`${prefix === "text" ? "Tekstfarge" : "Bakgrunn"} ${swatch.value}`}
            onClick={() => onPick(group, utility)}
            style={{ background: swatch.hex }}
            className={cn("size-5 rounded-full border border-line-strong transition hover:scale-110", current === utility && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]")}
          />
        );
      })}
      <label className="relative grid size-5 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-line-strong text-[10px] text-muted transition hover:scale-110" title="Egen farge">
        +
        <input
          type="color"
          aria-label="Egen farge"
          onChange={(e) => onPick(group, `${prefix}-[${e.target.value.toLowerCase()}]`)}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <button type="button" onClick={() => onPick(group, null)} className="ml-1 text-[11.5px] text-faint transition hover:text-fg">
        ingen
      </button>
    </div>
  );
}

/**
 * Edits the picked element directly in the code (text, colors, size, weight) and offers the AI
 * prompt only for what the algorithms cannot do.
 */
export function ElementPanel({
  picked,
  files,
  onFile,
  onPicked,
  onSend,
  onClose,
}: {
  picked: Picked;
  files: FileMap;
  onFile: (path: string, content: string) => void;
  onPicked: (next: Picked) => void;
  onSend: (text: string) => void;
  onClose: () => void;
}) {
  const located = useMemo(() => locate(files, picked), [files, picked]);
  const [ask, setAsk] = useState("");
  const [text, setText] = useState(located.ok ? (located.target.text ?? "") : "");

  const style = readStyle(picked.className);
  const label = picked.text ? `«${picked.text.length > 40 ? `${picked.text.slice(0, 40)}…` : picked.text}»` : "";

  function changeClass(className: string) {
    if (!located.ok) return;
    const next = applyClasses(files, located.target, className);
    onFile(located.target.path, next[located.target.path]!);
    onPicked({ ...picked, className });
  }
  const setGroup = (group: Group, utility: string | null) => changeClass(setUtility(picked.className, group, utility));
  function commitText() {
    if (!located.ok || located.target.text === null) return;
    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean || clean === located.target.text) return;
    const next = applyText(files, located.target, clean);
    onFile(located.target.path, next[located.target.path]!);
    onPicked({ ...picked, text: clean });
  }

  return (
    <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="glass absolute inset-x-4 bottom-4 z-20 max-h-[75%] space-y-3 overflow-y-auto rounded-2xl p-3 shadow-[var(--shadow)]">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <MousePointerClick className="size-3.5 text-accent" />
        <span className="font-mono text-fg">&lt;{picked.tag}&gt;</span>
        {label && <span className="truncate">{label}</span>}
        {picked.components[0] && <span className="ml-auto shrink-0 text-faint">i {picked.components[0]}</span>}
        <button type="button" onClick={onClose} className={cn("grid size-6 shrink-0 place-items-center rounded-md text-faint transition hover:bg-surface-2 hover:text-fg", !picked.components[0] && "ml-auto")} aria-label="Lukk">
          <X className="size-3.5" />
        </button>
      </div>

      {located.ok ? (
        <div className="space-y-2.5 text-[12.5px]">
          {located.target.text !== null && (
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), commitText())}
              aria-label="Tekst"
              className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[13.5px] outline-none focus:border-line-strong"
            />
          )}
          <div className="grid grid-cols-[64px_1fr] items-center gap-x-3 gap-y-2.5">
            <span className="text-muted">Tekst</span>
            <Swatches prefix="text" group="color" current={style.color} onPick={setGroup} />
            <span className="text-muted">Bakgrunn</span>
            <Swatches prefix="bg" group="background" current={style.background} onPick={setGroup} />
            <span className="text-muted">Størrelse</span>
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => changeClass(stepSize(picked.className, -1))} className="grid size-7 place-items-center rounded-lg border border-line bg-surface-2 transition hover:text-fg" aria-label="Mindre">
                <Minus className="size-3.5" />
              </button>
              <span className="w-12 text-center font-mono text-[12px]">{(style.size ?? "text-base").slice(5)}</span>
              <button type="button" onClick={() => changeClass(stepSize(picked.className, 1))} className="grid size-7 place-items-center rounded-lg border border-line bg-surface-2 transition hover:text-fg" aria-label="Større">
                <Plus className="size-3.5" />
              </button>
              <select
                value={style.weight?.slice(5) ?? ""}
                onChange={(e) => setGroup("weight", e.target.value ? `font-${e.target.value}` : null)}
                aria-label="Skriftvekt"
                className="ml-2 rounded-lg border border-line bg-surface-2 px-2 py-1 text-[12px] outline-none"
              >
                <option value="">Vekt</option>
                {WEIGHTS.map((w) => (
                  <option key={w} value={w}>
                    {WEIGHT_LABELS[w]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-[12.5px] text-faint">{located.reason}</p>
      )}

      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (ask.trim()) onSend(ask.trim());
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Sparkles className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <input
            value={ask}
            onChange={(e) => setAsk(e.target.value)}
            placeholder={located.ok ? "Noe annet? Be AI om det" : "Be AI om endringen"}
            className="w-full rounded-xl border border-line bg-surface-2 py-2 pl-8 pr-3 text-[13.5px] outline-none placeholder:text-faint focus:border-line-strong"
          />
        </div>
        <button type="submit" disabled={!ask.trim()} className="bg-brand grid size-9 shrink-0 place-items-center rounded-xl text-white transition enabled:hover:brightness-110 disabled:opacity-40" aria-label="Send endring">
          <ArrowUp className="size-4" />
        </button>
      </form>
    </motion.div>
  );
}
