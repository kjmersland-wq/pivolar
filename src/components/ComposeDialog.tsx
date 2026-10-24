"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp, LayoutTemplate, Moon, Sun, X } from "lucide-react";
import { composeSite, DEFAULT_SPEC, SECTION_INFO, type SectionId, type Spec } from "@/lib/compose";
import { BRAND_SUGGESTIONS, contrast, makePalette } from "@/lib/palette";
import { cn } from "@/lib/utils";

const ALL: SectionId[] = ["hero", "features", "about", "testimonials", "pricing", "faq", "cta", "newsletter", "contact", "share"];

const field = "w-full rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-[13.5px] outline-none transition placeholder:text-faint focus:border-line-strong";

function Toggle<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string; icon?: typeof Sun }[] }) {
  return (
    <div className="flex rounded-xl border border-line bg-surface-2 p-0.5">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={cn("flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-1.5 text-[12.5px] transition", value === v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
        >
          {Icon && <Icon className="size-3.5" />}
          {label}
        </button>
      ))}
    </div>
  );
}

/** Puts a landing page together from ready-made sections and a generated palette, without AI. */
export function ComposeDialog({ open, onClose, onCompose, initialName }: { open: boolean; onClose: () => void; onCompose: (files: Record<string, string>) => void; initialName: string }) {
  const [spec, setSpec] = useState<Spec>(DEFAULT_SPEC);
  const set = <K extends keyof Spec>(key: K, value: Spec[K]) => setSpec((prev) => ({ ...prev, [key]: value }));

  const palette = useMemo(() => makePalette(spec.color, spec.dark), [spec.color, spec.dark]);
  const ratio = contrast(palette.text, palette.bg);

  const chosen = spec.sections;
  const toggle = (id: SectionId) => set("sections", chosen.includes(id) ? chosen.filter((s) => s !== id) : ALL.filter((s) => s === id || chosen.includes(s)));
  const move = (id: SectionId, delta: -1 | 1) => {
    const index = chosen.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= chosen.length) return;
    const next = [...chosen];
    [next[index], next[target]] = [next[target]!, next[index]!];
    set("sections", next);
  };
  // Unchosen sections are listed after the chosen ones, so the list stays stable while editing.
  const ordered = [...chosen, ...ALL.filter((id) => !chosen.includes(id))];

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.98 }} className="card max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-3xl p-6" role="dialog" aria-label="Sett sammen en side">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight">
                  <LayoutTemplate className="size-[18px] text-accent" />
                  Sett sammen en side
                </h2>
                <p className="mt-1 text-[13px] text-muted">Ferdige seksjoner og en fargepalett som regnes ut fra én farge. Ingen AI, ingen ventetid.</p>
              </div>
              <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Lukk">
                <X className="size-4" />
              </button>
            </div>

            <div className="mt-5 space-y-3.5">
              <input value={spec.name} onChange={(e) => set("name", e.target.value)} placeholder={initialName && initialName !== "Nytt prosjekt" ? initialName : "Navn på firma eller prosjekt"} className={field} aria-label="Navn" />
              <input value={spec.tagline} onChange={(e) => set("tagline", e.target.value)} placeholder="Overskrift, f.eks. «Kaffe som tar seg tid»" className={field} aria-label="Overskrift" />
              <textarea value={spec.description} onChange={(e) => set("description", e.target.value)} placeholder="Kort beskrivelse" rows={2} className={cn(field, "resize-none")} aria-label="Beskrivelse" />
              <input type="email" value={spec.email} onChange={(e) => set("email", e.target.value)} placeholder="E-post for kontakt (valgfritt)" className={field} aria-label="E-post" />

              <div className="space-y-2">
                <p className="text-[12.5px] font-medium text-muted">Farge</p>
                <div className="flex flex-wrap items-center gap-2">
                  {BRAND_SUGGESTIONS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() => set("color", hex)}
                      aria-label={`Farge ${hex}`}
                      style={{ background: hex }}
                      className={cn("size-7 rounded-full border border-line-strong transition hover:scale-110", spec.color === hex && "ring-2 ring-accent ring-offset-2 ring-offset-[var(--surface)]")}
                    />
                  ))}
                  <label className="relative grid size-7 cursor-pointer place-items-center overflow-hidden rounded-full border border-dashed border-line-strong text-[12px] text-muted transition hover:scale-110" title="Egen farge">
                    +
                    <input type="color" aria-label="Egen farge" value={spec.color} onChange={(e) => set("color", e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
                  </label>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex overflow-hidden rounded-lg border border-line">
                    {[palette.bg, palette.surface, palette.brandSoft, palette.brand, palette.accent, palette.text].map((hex, i) => (
                      <span key={i} style={{ background: hex }} className="h-6 w-8" title={hex} />
                    ))}
                  </div>
                  <span className="text-[12px] text-faint">Tekst mot bakgrunn: {ratio.toFixed(1)}:1 {ratio >= 7 ? "(AAA)" : ratio >= 4.5 ? "(AA)" : ""}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Toggle
                  value={spec.dark ? "dark" : "light"}
                  onChange={(v) => set("dark", v === "dark")}
                  options={[
                    { value: "light", label: "Lys", icon: Sun },
                    { value: "dark", label: "Mørk", icon: Moon },
                  ]}
                />
                <Toggle value={spec.heroStyle} onChange={(v) => set("heroStyle", v)} options={[{ value: "centered", label: "Sentrert" }, { value: "split", label: "Delt" }]} />
              </div>

              <div className="space-y-1.5">
                <p className="text-[12.5px] font-medium text-muted">Seksjoner (navigasjon og bunntekst kommer alltid med)</p>
                {ordered.map((id) => {
                  const on = chosen.includes(id);
                  const index = chosen.indexOf(id);
                  return (
                    <div key={id} className={cn("flex items-center gap-2.5 rounded-xl border border-line px-3 py-2 text-[13px]", !on && "opacity-55")}>
                      <input type="checkbox" checked={on} onChange={() => toggle(id)} className="size-4 accent-[var(--accent)]" aria-label={SECTION_INFO[id].label} />
                      <span className="flex-1">{SECTION_INFO[id].label}</span>
                      {on && (
                        <>
                          <button type="button" onClick={() => move(id, -1)} disabled={index === 0} className="grid size-6 place-items-center rounded-md text-muted transition enabled:hover:bg-surface-2 disabled:opacity-30" aria-label="Flytt opp">
                            <ArrowUp className="size-3.5" />
                          </button>
                          <button type="button" onClick={() => move(id, 1)} disabled={index === chosen.length - 1} className="grid size-6 place-items-center rounded-md text-muted transition enabled:hover:bg-surface-2 disabled:opacity-30" aria-label="Flytt ned">
                            <ArrowDown className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => {
                  onCompose(composeSite({ ...spec, name: spec.name.trim() || (initialName !== "Nytt prosjekt" ? initialName : "") }));
                  onClose();
                }}
                className="bg-brand flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14.5px] font-medium text-white shadow-[0_8px_24px_-10px_var(--accent)] transition hover:brightness-110"
              >
                <LayoutTemplate className="size-4" />
                Sett sammen siden
              </button>
              <p className="text-center text-[11.5px] text-faint">Erstatter forsiden og seksjonsfilene. Du kan angre ved å gå tilbake i chatten, og finpusse tekst og farger direkte etterpå.</p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
