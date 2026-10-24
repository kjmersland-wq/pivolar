"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, Loader2, Sparkles, Wand2, X } from "lucide-react";
import { buildPrompt, defaultsFor, FEATURES, knowledgeFromSpec, GOALS, KINDS, LIMITS, MOODS, promptCheck, SECTIONS, type FeatureKey, type GoalId, type ImagesId, type KindId, type MoodId, type PromptSpec, type SectionKey } from "@/lib/prompt/builder";
import { cn } from "@/lib/utils";

const SWATCHES = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#a855f7", "#14b8a6", "#b45309"];
const IMAGES: Record<ImagesId, string> = { stock: "Gratis bilder", generate: "Lag egne bilder", none: "Ingen bilder" };

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on} className={cn("rounded-full border px-3 py-1.5 text-[12.5px] transition", on ? "border-line-strong bg-bg-soft font-medium text-fg" : "border-line text-muted hover:text-fg")}>
      {children}
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="text-[12.5px] font-medium">{label}</p>
      {children}
      {hint && <p className="text-[12px] text-faint">{hint}</p>}
    </div>
  );
}

const input = "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[14px] text-fg outline-none transition focus:border-line-strong";

/**
 * The prompt helper: a few choices become a complete, well-ordered request for the builder. The text
 * on the right is plain code's work and can be edited freely. The AI step is optional and only
 * sharpens the wording; the owner always sees the result before anything is sent.
 */
export function PromptWizard({ open, onClose, onUse, initialAbout = "" }: { open: boolean; onClose: () => void; onUse: (text: string, start: boolean, knowledge: string) => void; initialAbout?: string }) {
  const [spec, setSpec] = useState<PromptSpec>(() => defaultsFor("landing"));
  const built = useMemo(() => buildPrompt(spec), [spec]);
  const check = useMemo(() => promptCheck(spec), [spec]);
  // The text follows the choices until the owner edits it by hand.
  const [text, setText] = useState(built);
  const [edited, setEdited] = useState(false);
  const [improving, setImproving] = useState(false);
  const [keep, setKeep] = useState(true);
  const rules = useMemo(() => knowledgeFromSpec(spec), [spec]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      /* eslint-disable react-hooks/set-state-in-effect -- the form starts fresh each time it opens */
      const fresh = { ...defaultsFor("landing"), about: initialAbout.slice(0, LIMITS.about) };
      setSpec(fresh);
      setText(buildPrompt(fresh));
      setEdited(false);
      setError("");
      /* eslint-enable react-hooks/set-state-in-effect */
    }
  }, [open, initialAbout]);

  const set = <K extends keyof PromptSpec>(key: K, value: PromptSpec[K]) => {
    const next = { ...spec, [key]: value };
    setSpec(next);
    if (!edited) setText(buildPrompt(next));
  };
  const pickKind = (kind: KindId) => {
    const base = defaultsFor(kind);
    const next = { ...base, name: spec.name, about: spec.about, audience: spec.audience, color: spec.color, language: spec.language, images: spec.images, reference: spec.reference, extra: spec.extra };
    setSpec(next);
    if (!edited) setText(buildPrompt(next));
  };
  const toggle = <T extends SectionKey | FeatureKey>(key: "sections" | "features", item: T) => {
    const current = spec[key] as T[];
    set(key, (current.includes(item) ? current.filter((x) => x !== item) : [...current, item]) as PromptSpec[typeof key]);
  };

  async function improve() {
    setError("");
    setImproving(true);
    try {
      const response = await fetch("/api/prompt/improve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: text }) });
      const data = (await response.json().catch(() => ({}))) as { prompt?: string; error?: string };
      if (!response.ok || !data.prompt) setError(data.error ?? (response.status === 429 ? "For mange forsøk. Vent litt." : "Fikk ikke noe forslag."));
      else {
        setText(data.prompt);
        setEdited(true);
      }
    } catch {
      setError("Fikk ikke kontakt med serveren.");
    }
    setImproving(false);
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} role="dialog" aria-modal="true" aria-label="Prompt-hjelper" className="card flex h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl">
            <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
                  <Wand2 className="size-[18px] text-accent" />
                  Prompt-hjelper
                </h2>
                <p className="mt-1 text-[13px] text-muted">Velg, så setter Pivolar sammen en komplett bestilling. Du kan endre teksten før den sendes.</p>
              </div>
              <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
                <X className="size-4" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 gap-0 md:grid-cols-2">
              <div className="min-h-0 space-y-5 overflow-y-auto p-6">
                <Field label="Hva skal du lage?">
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(KINDS) as KindId[]).map((kind) => (
                      <Chip key={kind} on={spec.kind === kind} onClick={() => pickKind(kind)}>
                        {KINDS[kind].label}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field label="Navn">
                  <input value={spec.name} maxLength={LIMITS.name} onChange={(e) => set("name", e.target.value)} placeholder="For eksempel Lille Brenneri" className={input} />
                </Field>
                <Field label="Hva gjør dere, eller hva er det?" hint="Én til to setninger. Dette gir best tekst.">
                  <textarea value={spec.about} maxLength={LIMITS.about} rows={3} onChange={(e) => set("about", e.target.value)} placeholder="Vi brenner kaffe selv og har åtte bord i Grünerløkka." className={input} />
                </Field>
                <Field label="Hvem er det for?">
                  <input value={spec.audience} maxLength={LIMITS.audience} onChange={(e) => set("audience", e.target.value)} placeholder="Naboer og kaffeinteresserte i Oslo" className={input} />
                </Field>
                <Field label="Hva skal en besøkende gjøre?">
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(GOALS) as GoalId[]).map((goal) => (
                      <Chip key={goal} on={spec.goal === goal} onClick={() => set("goal", goal)}>
                        {GOALS[goal].label}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field label="Stemning">
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(MOODS) as MoodId[]).map((mood) => (
                      <Chip key={mood} on={spec.mood === mood} onClick={() => set("mood", mood)}>
                        {MOODS[mood].label}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field label="Aksentfarge (valgfritt)" hint="Velg en, skriv en hex-kode, eller la AI-en velge.">
                  <div className="flex flex-wrap items-center gap-2">
                    {SWATCHES.map((hex) => (
                      <button key={hex} type="button" aria-label={hex} onClick={() => set("color", spec.color === hex ? "" : hex)} style={{ background: hex }} className={cn("size-7 rounded-full border-2 transition", spec.color === hex ? "border-fg" : "border-transparent")} />
                    ))}
                    <input value={spec.color} maxLength={7} onChange={(e) => set("color", e.target.value)} placeholder="#b45309" aria-label="Hex-farge" className={cn(input, "w-28 py-1.5")} />
                  </div>
                </Field>
                <Field label="Seksjoner">
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(SECTIONS) as SectionKey[]).map((key) => (
                      <Chip key={key} on={spec.sections.includes(key)} onClick={() => toggle("sections", key)}>
                        {SECTIONS[key].label}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <Field label="Funksjoner">
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(FEATURES) as FeatureKey[]).map((key) => (
                      <Chip key={key} on={spec.features.includes(key)} onClick={() => toggle("features", key)}>
                        {FEATURES[key].label}
                      </Chip>
                    ))}
                  </div>
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="Språk på siden">
                    <div className="flex gap-1.5">
                      <Chip on={spec.language === "nb"} onClick={() => set("language", "nb")}>
                        Norsk
                      </Chip>
                      <Chip on={spec.language === "en"} onClick={() => set("language", "en")}>
                        Engelsk
                      </Chip>
                    </div>
                  </Field>
                  <Field label="Bilder">
                    <div className="flex flex-wrap gap-1.5">
                      {(Object.keys(IMAGES) as ImagesId[]).map((key) => (
                        <Chip key={key} on={spec.images === key} onClick={() => set("images", key)}>
                          {IMAGES[key]}
                        </Chip>
                      ))}
                    </div>
                  </Field>
                </div>
                <Field label="Referanse-side (valgfritt)" hint="En side du eier eller har rett til å bruke stilen fra. Pivolar måler den og følger stilen, ikke teksten.">
                  <input value={spec.reference} maxLength={LIMITS.reference} onChange={(e) => set("reference", e.target.value)} placeholder="https://" className={input} />
                </Field>
                <Field label="Andre ønsker (valgfritt)">
                  <textarea value={spec.extra} maxLength={LIMITS.extra} rows={3} onChange={(e) => set("extra", e.target.value)} className={input} />
                </Field>
              </div>

              <div className="flex min-h-0 flex-col gap-3 border-t border-line p-6 md:border-l md:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[13.5px] font-medium">Bestillingen</p>
                  <span className="text-[12px] text-faint">{text.length} tegn</span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value.slice(0, LIMITS.prompt));
                    setEdited(true);
                  }}
                  aria-label="Bestillingen"
                  className="min-h-40 flex-1 resize-none rounded-xl border border-line bg-surface-2 p-3.5 font-mono text-[12.5px] leading-relaxed text-fg outline-none transition focus:border-line-strong"
                />
                {check.missing.length > 0 ? (
                  <ul className="space-y-1 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-[12.5px]">
                    {check.missing.map((item) => (
                      <li key={item} className="flex gap-2">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-400" />
                        {item}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="flex items-center gap-2 text-[12.5px] text-emerald-400">
                    <Check className="size-4" />
                    Alt det viktigste er med.
                  </p>
                )}
                {error && <p className="text-[12.5px] text-red-400">{error}</p>}
                {rules && (
                  <details className="rounded-xl border border-line bg-surface-2 p-3 text-[12.5px]">
                    <summary className="flex cursor-pointer list-none items-center gap-2.5">
                      <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} onClick={(e) => e.stopPropagation()} aria-label="Lagre som faste regler" className="size-4 accent-[var(--accent)]" />
                      <span>Lagre språk, tone, fakta og farge som faste regler for prosjektet (Kunnskap)</span>
                    </summary>
                    <pre className="mt-2 whitespace-pre-wrap font-sans text-muted">{rules}</pre>
                    <p className="mt-2 text-faint">Reglene gjelder i alle meldinger i prosjektet, ikke bare den første, og kan endres senere i Mer-panelet.</p>
                  </details>
                )}
                {edited && (
                  <button
                    type="button"
                    onClick={() => {
                      setText(built);
                      setEdited(false);
                    }}
                    className="self-start text-[12.5px] text-muted underline transition hover:text-fg"
                  >
                    Bygg teksten på nytt fra valgene
                  </button>
                )}
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void improve()} disabled={improving || text.trim().length < 40} className="flex items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-[13px] transition enabled:hover:border-line-strong disabled:opacity-50">
                    {improving ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                    Skjerp med AI (valgfritt)
                  </button>
                  <button type="button" onClick={() => onUse(text, false, keep ? rules : "")} disabled={text.trim().length < 20} className="rounded-xl border border-line px-3.5 py-2.5 text-[13px] transition enabled:hover:border-line-strong disabled:opacity-50">
                    Legg i tekstfeltet
                  </button>
                  <button type="button" onClick={() => onUse(text, true, keep ? rules : "")} disabled={text.trim().length < 20} className="bg-brand ml-auto rounded-xl px-5 py-2.5 text-[13.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
                    Bygg nå
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
