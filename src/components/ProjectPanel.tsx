"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { UIMessage } from "ai";
import { AnimatePresence, motion } from "framer-motion";
import { BarChart3, Copy, FileAudio, FileText, Image as ImageIcon, Loader2, Upload as UploadIcon, Download, ExternalLink, GitBranch, Globe, KeyRound, Plug, Rocket, Server, Settings, ShieldCheck, Trash2, Wallet, X } from "lucide-react";
import { connectorById } from "@/lib/connectors";
import { loadConnectors, removeConnector } from "@/lib/connectors/store";
import type { FileMap, UserEdit } from "@/lib/files";
import { deleteProject, duplicateProject, getProject, loadImportInfo, loadPublish } from "@/lib/projects";
import { addFiles, removeFile } from "@/lib/uploads/client";
import { UPLOAD_LIMITS, TYPES, type Upload } from "@/lib/uploads/rules";
import { MoveCheck } from "@/components/MoveCheck";
import { projectFiles } from "@/lib/runner/run";
import { KNOWLEDGE_MAX, KNOWLEDGE_TEMPLATES, knowledgeOf } from "@/lib/knowledge";
import { originLabel, projectStats } from "@/lib/project-stats";
import { fetchUsage, NOK_PER_USD } from "@/lib/usage/client";
import { cn } from "@/lib/utils";

/** The dialogs the panel can open. The workspace owns them; the panel only asks. */
export type PanelTarget = "analytics" | "connectors" | "check" | "hosting" | "export" | "publish" | "pr" | "domains";

type Icon = ComponentType<{ className?: string }>;

const NAV: { target: PanelTarget; label: string; icon: Icon }[] = [
  { target: "analytics", label: "Analyse", icon: BarChart3 },
  { target: "connectors", label: "Database og koblinger", icon: Plug },
  { target: "check", label: "Kontroll: sikkerhet og SEO", icon: ShieldCheck },
  { target: "hosting", label: "Hosting", icon: Server },
  { target: "publish", label: "Publisering", icon: Rocket },
  { target: "domains", label: "Domene", icon: Globe },
  { target: "export", label: "Eksport", icon: Download },
];

const SECTIONS = [
  { id: "detaljer", label: "Prosjektdetaljer" },
  { id: "kunnskap", label: "Kunnskap" },
  { id: "filer", label: "Filer" },
  { id: "publisering", label: "Publisering" },
  { id: "hemmeligheter", label: "Hemmeligheter" },
  { id: "flytting", label: "Flytting" },
  { id: "git", label: "Git" },
  { id: "handlinger", label: "Handlinger" },
] as const;

const date = (at: number) => new Date(at).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium">{label}</p>
        {hint && <p className="mt-0.5 text-[12.5px] text-muted">{hint}</p>}
      </div>
      <div className="min-w-0 shrink-0 text-right text-[13.5px]">{children}</div>
    </div>
  );
}

function Card({ id, title, text, children }: { id: string; title: string; text?: string; children: ReactNode }) {
  return (
    <section id={`panel-${id}`} className="scroll-mt-4">
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {text && <p className="mt-1 text-[12.5px] text-muted">{text}</p>}
      <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-surface-2">{children}</div>
    </section>
  );
}

/**
 * The project's own page, like the «More» view in Lovable: a menu to the dialogs the project uses, and
 * the settings of the project (details, publishing, secrets, Git and actions). It only reads what the
 * workspace already has, and the destructive actions ask twice.
 */
export function ProjectPanel({
  open,
  onClose,
  onOpen,
  projectId,
  name,
  onRename,
  files,
  messages,
  edits,
  onKnowledge,
  uploads,
  onUploads,
  onPrepare,
}: {
  open: boolean;
  onClose: () => void;
  onOpen: (target: PanelTarget) => void;
  projectId: string;
  name: string;
  onRename: (name: string) => void;
  files: FileMap;
  messages: UIMessage[];
  edits: UserEdit[];
  /** Saves the project's standing instructions for the AI. */
  onKnowledge: (text: string) => void;
  /** The files the owner has added, and a way to change the list. */
  uploads: Upload[];
  onUploads: (list: Upload[]) => void;
  /** Writes the files the Cloudflare preparation adds, as the owner's own edits. */
  onPrepare: (changes: Record<string, string>) => void;
}) {
  const router = useRouter();
  const scroller = useRef<HTMLDivElement>(null);
  const [month, setMonth] = useState<number | null>(null);
  const [saved, setSaved] = useState(() => loadConnectors(projectId));
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draft, setDraft] = useState(name);
  const stored = useMemo(() => knowledgeOf(files), [files]);
  const [know, setKnow] = useState(stored);
  const [sending, setSending] = useState("");
  const [fileErrors, setFileErrors] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  async function add(list: File[]) {
    if (list.length === 0 || sending) return;
    setFileErrors([]);
    setSending("Gjør klart …");
    const { added, errors } = await addFiles(projectId, list, setSending);
    if (added.length) onUploads([...uploads, ...added].slice(0, UPLOAD_LIMITS.perProject));
    setFileErrors(errors);
    setSending("");
  }

  async function dropFile(upload: Upload) {
    setFileErrors([]);
    const ok = await removeFile(upload);
    if (ok) onUploads(uploads.filter((u) => u.url !== upload.url));
    else setFileErrors([`Kunne ikke slette ${upload.name}.`]);
  }

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect -- the panel reads fresh values each time it opens */
    setSaved(loadConnectors(projectId));
    setConfirmDelete(false);
    setDraft(name);
    setKnow(stored);
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    void fetchUsage().then((summary) => !cancelled && setMonth(summary ? summary.monthUsd : null));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the text is read when the panel opens; typing is not overwritten by later file changes
  }, [open, projectId, name]);

  const project = open ? getProject(projectId) : undefined;
  const info = open ? loadImportInfo(projectId) : null;
  const published = open ? loadPublish(projectId) : null;
  // The move checklist is for imported projects that bring their own package.json
  const moving = useMemo(() => {
    if (!open) return null;
    const own = projectFiles(files);
    return "/package.json" in own ? own : null;
  }, [open, files]);
  const stats = useMemo(() => projectStats(messages, edits, files), [messages, edits, files]);
  const connected = Object.entries(saved)
    .map(([id, values]) => ({ id, connector: connectorById(id), filled: Object.values(values).filter(Boolean).length }))
    .filter((item) => item.filled > 0);

  const go = (target: PanelTarget) => {
    onClose();
    onOpen(target);
  };
  const jump = (id: string) => scroller.current?.querySelector(`#panel-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

  function duplicate() {
    const copy = duplicateProject(projectId);
    if (copy) router.push(`/p/${copy.id}`);
  }

  function remove() {
    deleteProject(projectId);
    router.push("/");
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
          <motion.div initial={{ opacity: 0, y: 16, scale: 0.99 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 16, scale: 0.99 }} role="dialog" aria-modal="true" aria-label="Mer om prosjektet" className="card flex h-[92dvh] w-full max-w-5xl overflow-hidden rounded-3xl">
            <nav className="hidden w-60 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line p-3 md:flex" aria-label="Prosjektmeny">
              {NAV.map(({ target, label, icon: Icon }) => (
                <button key={target} type="button" onClick={() => go(target)} className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13.5px] text-muted transition hover:bg-surface-2 hover:text-fg">
                  <Icon className="size-4 shrink-0" />
                  {label}
                </button>
              ))}
              <Link href="/forbruk" className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13.5px] text-muted transition hover:bg-surface-2 hover:text-fg">
                <Wallet className="size-4 shrink-0" />
                Forbruk
              </Link>
              <div className="my-2 border-t border-line" />
              <p className="flex items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2 text-[13.5px] font-medium">
                <Settings className="size-4 shrink-0" />
                Innstillinger
              </p>
              {SECTIONS.filter((section) => section.id !== "flytting" || moving).map((section) => (
                <button key={section.id} type="button" onClick={() => jump(section.id)} className="rounded-xl py-1.5 pl-9 pr-3 text-left text-[13px] text-muted transition hover:text-fg">
                  {section.label}
                </button>
              ))}
            </nav>

            <div ref={scroller} className="min-w-0 flex-1 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[20px] font-semibold tracking-tight">{name}</h2>
                  {project && <p className="mt-1 text-[12.5px] text-muted">Opprettet {date(project.createdAt)}</p>}
                </div>
                <button type="button" onClick={onClose} aria-label="Lukk" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg">
                  <X className="size-4" />
                </button>
              </div>

              {/* On a narrow screen the menu is a row of buttons above the settings. */}
              <div className="mt-4 flex flex-wrap gap-1.5 md:hidden">
                {NAV.map(({ target, label, icon: Icon }) => (
                  <button key={target} type="button" onClick={() => go(target)} className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-muted">
                    <Icon className="size-3.5" />
                    {label}
                  </button>
                ))}
              </div>

              <div className="mt-6 space-y-8">
                <Card id="detaljer" title="Prosjektdetaljer">
                  <Row label="Prosjektnavn">
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => draft.trim() && draft.trim() !== name && onRename(draft.trim())}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      aria-label="Prosjektnavn"
                      className="w-56 rounded-lg border border-transparent bg-transparent px-2 py-1 text-right outline-none transition hover:border-line focus:border-line-strong focus:bg-surface"
                    />
                  </Row>
                  <Row label="Opphav">{originLabel(info)}</Row>
                  <Row label="Meldinger" hint="Det du har skrevet til AI-en.">{stats.messages}</Row>
                  <Row label="AI-endringer" hint="Filer AI-en har skrevet, endret eller slettet.">{stats.aiEdits}</Row>
                  <Row label="Dine egne endringer" hint="Det du har skrevet i koden eller endret direkte.">{stats.ownEdits}</Row>
                  <Row label="Filer">{stats.files}</Row>
                  <Row label="Forbruk denne måneden" hint="For alle prosjektene dine til sammen.">
                    {month === null ? (
                      <span className="text-muted">Ikke tilgjengelig</span>
                    ) : (
                      <Link href="/forbruk" className="hover:underline">
                        ${month.toFixed(2)} (ca. {Math.round(month * NOK_PER_USD)} kr)
                      </Link>
                    )}
                  </Row>
                  <Row label="Prosjekt-id">
                    <code className="select-all break-all text-[12px] text-muted">{projectId}</code>
                  </Row>
                </Card>

                <Card id="kunnskap" title="Kunnskap" text="Faste regler for AI-en i dette prosjektet: tone, språk, hva den ikke skal røre, fakta om virksomheten. De leses i hver melding, følger prosjektet til kontoen din, og blir aldri publisert eller eksportert.">
                  <div className="space-y-3 p-5">
                    <textarea
                      value={know}
                      onChange={(e) => setKnow(e.target.value.slice(0, KNOWLEDGE_MAX))}
                      rows={7}
                      aria-label="Kunnskap"
                      placeholder={"For eksempel:\nVi er et lite brenneri på Grünerløkka.\nTonen er uformell. Skriv alltid norsk.\nIkke bruk emojier."}
                      className="w-full resize-y rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13.5px] leading-relaxed outline-none transition focus:border-line-strong"
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {KNOWLEDGE_TEMPLATES.map((item) => (
                        <button key={item.label} type="button" onClick={() => !know.includes(item.line) && setKnow((current) => `${current.trim() ? `${current.trim()}\n` : ""}${item.line}`.slice(0, KNOWLEDGE_MAX))} className="rounded-full border border-line px-2.5 py-1 text-[12px] text-muted transition hover:border-line-strong hover:text-fg">
                          + {item.label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[12px] text-faint">
                        {know.length} av {KNOWLEDGE_MAX} tegn
                      </span>
                      <button type="button" onClick={() => onKnowledge(know)} disabled={know.trim() === stored} className="bg-brand rounded-xl px-4 py-2 text-[13px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50">
                        {know.trim() === stored ? "Lagret" : "Lagre"}
                      </button>
                    </div>
                  </div>
                </Card>

                <Card id="filer" title="Filer" text="Bilder, lyd og PDF du legger til i prosjektet. AI-en får vite om dem og bruker dem der du ber om det. Når siden publiseres eller sendes som pull request, kopieres de inn i prosjektet.">
                  <div className="space-y-3 p-5">
                    <label
                      onDragOver={(e) => (e.preventDefault(), setDragging(true))}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        void add([...e.dataTransfer.files]);
                      }}
                      className={cn("flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center text-[13px] transition", dragging ? "border-accent bg-accent/5" : "border-line text-muted hover:border-line-strong")}
                    >
                      {sending ? <Loader2 className="size-5 animate-spin" /> : <UploadIcon className="size-5" />}
                      <span>{sending || "Slipp filer her, eller trykk for å velge"}</span>
                      <span className="text-[12px] text-faint">png, jpg, webp, gif, avif, mp3, m4a, ogg, wav og pdf, høyst {UPLOAD_LIMITS.fileBytes / 1024 / 1024} MB per fil</span>
                      <input type="file" multiple accept={Object.keys(TYPES).map((e) => `.${e}`).join(",")} disabled={Boolean(sending)} onChange={(e) => (void add([...(e.target.files ?? [])]), (e.target.value = ""))} className="sr-only" aria-label="Legg til filer" />
                    </label>
                    {fileErrors.map((message) => (
                      <p key={message} className="text-[12.5px] text-red-400">
                        {message}
                      </p>
                    ))}
                    {uploads.length === 0 ? (
                      <p className="text-[12.5px] text-muted">Ingen filer ennå. Etter at du har lagt til en, kan du be AI-en for eksempel: «Bruk bildet {uploads[0]?.name ?? "hero.jpg"} i toppseksjonen».</p>
                    ) : (
                      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                        {uploads.map((upload) => (
                          <li key={upload.url} className="flex items-center gap-3 px-3 py-2.5">
                            {upload.mime.startsWith("image/") ? (
                              // eslint-disable-next-line @next/next/no-img-element -- a small public picture from storage
                              <img src={upload.url} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                            ) : (
                              <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-muted">{upload.mime.startsWith("audio/") ? <FileAudio className="size-5" /> : upload.mime === "application/pdf" ? <FileText className="size-5" /> : <ImageIcon className="size-5" />}</span>
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[13px] font-medium">{upload.name}</p>
                              <p className="text-[12px] text-faint">{upload.bytes >= 1_000_000 ? `${(upload.bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(upload.bytes / 1000))} KB`}</p>
                            </div>
                            <button type="button" onClick={() => void navigator.clipboard?.writeText(upload.url)} className="rounded-lg border border-line px-2.5 py-1 text-[12px] text-muted transition hover:border-line-strong hover:text-fg">
                              Kopier adresse
                            </button>
                            <button type="button" onClick={() => void dropFile(upload)} aria-label={`Slett ${upload.name}`} className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-red-500/10 hover:text-red-400">
                              <Trash2 className="size-4" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </Card>

                <Card id="publisering" title="Publisering" text="Der siden ligger nå, og valgene for hvordan den publiseres.">
                  <Row label="Sist publisert" hint={published ? `Navn: ${published.name}` : "Ikke publisert ennå."}>
                    {published ? date(published.at) : "–"}
                  </Row>
                  {published?.liveUrl && (
                    <Row label="Side">
                      <a href={published.liveUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[22rem] items-center gap-1 break-all text-accent hover:underline">
                        {published.liveUrl}
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </Row>
                  )}
                  {published?.githubUrl && (
                    <Row label="Repo">
                      <a href={published.githubUrl} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-[22rem] items-center gap-1 break-all text-accent hover:underline">
                        {published.githubUrl}
                        <ExternalLink className="size-3 shrink-0" />
                      </a>
                    </Row>
                  )}
                  <Row label="Publiser eller velg vert" hint="Pivolar anbefaler vert ut fra hva siden trenger.">
                    <span className="flex gap-2">
                      <button type="button" onClick={() => go("publish")} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
                        Publiser
                      </button>
                      <button type="button" onClick={() => go("hosting")} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
                        Hosting
                      </button>
                    </span>
                  </Row>
                  <Row label="Forhåndsvisning i egen fane" hint="Slik en besøkende ser siden.">
                    <a href={`/p/${projectId}/full`} target="_blank" rel="noopener" className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
                      <Globe className="size-3.5" />
                      Åpne
                    </a>
                  </Row>
                </Card>

                <Card id="hemmeligheter" title="Hemmeligheter" text="Nøkler og verdier du har lagt inn i koblingene. De ligger bare i denne nettleseren og vises aldri her. Ved publisering får siden dem som miljøvariabler.">
                  {connected.length === 0 ? (
                    <p className="px-5 py-4 text-[13px] text-muted">Ingen koblinger har verdier ennå.</p>
                  ) : (
                    connected.map(({ id, connector, filled }) => (
                      <Row key={id} label={connector?.name ?? id} hint={`${filled} ${filled === 1 ? "verdi" : "verdier"} lagret`}>
                        <button
                          type="button"
                          onClick={() => {
                            removeConnector(projectId, id);
                            setSaved(loadConnectors(projectId));
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] text-muted transition hover:border-red-500/50 hover:text-red-400"
                        >
                          <KeyRound className="size-3.5" />
                          Fjern
                        </button>
                      </Row>
                    ))
                  )}
                  <Row label="Legg til eller endre">
                    <button type="button" onClick={() => go("connectors")} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
                      Åpne koblinger
                    </button>
                  </Row>
                </Card>

                {moving && (
                  <Card id="flytting" title="Flytting" text="Sjekkliste for å flytte et importert prosjekt (for eksempel fra Lovable) til din egen Supabase, egne betalingsnøkler og Cloudflare Pages. Leses fra filene; ingen hemmeligheter vises.">
                    <MoveCheck projectId={projectId} files={moving} onPrepare={onPrepare} omitted={info?.omittedSecrets ?? []} />
                  </Card>
                )}

                <Card id="git" title="Git" text="Hvor koden kommer fra og hvor den kan sendes.">
                  {info?.github ? (
                    <>
                      <Row label="Importert fra">
                        <a href={info.github.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                          {info.github.owner}/{info.github.repo} ({info.github.branch})
                          <ExternalLink className="size-3" />
                        </a>
                      </Row>
                      <Row label="Endringer" hint="Sendes som pull request, aldri rett på hovedgrenen.">
                        <button type="button" onClick={() => go("pr")} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
                          <GitBranch className="size-3.5" />
                          Send som pull request
                        </button>
                      </Row>
                    </>
                  ) : (
                    <Row label="Eksporter til GitHub" hint="Legger prosjektet som et ferdig Vite-prosjekt i et repo, i én commit.">
                      <button type="button" onClick={() => go("export")} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
                        <GitBranch className="size-3.5" />
                        Åpne eksport
                      </button>
                    </Row>
                  )}
                </Card>

                <Card id="handlinger" title="Prosjekthandlinger" text="Lag en kopi, eller last ned hele prosjektet.">
                  <Row label="Dupliser prosjekt" hint="Samme samtale og filer i et nytt prosjekt. Publiseringen følger ikke med, så kopien kan ikke overskrive den opprinnelige siden.">
                    <button type="button" onClick={duplicate} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
                      <Copy className="size-3.5" />
                      Dupliser
                    </button>
                  </Row>
                  <Row label="Last ned som ZIP">
                    <button type="button" onClick={() => go("export")} className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[12.5px] transition hover:border-line-strong">
                      <Download className="size-3.5" />
                      Eksporter
                    </button>
                  </Row>
                </Card>

                <section>
                  <h3 className="text-[15px] font-semibold text-red-400">Faresone</h3>
                  <div className="mt-3 overflow-hidden rounded-2xl border border-red-500/30 bg-red-500/5">
                    <Row label="Slett prosjekt" hint="Fjerner samtalen, filene og innstillingene fra denne nettleseren og fra kontoen. Den publiserte siden og repoet røres ikke.">
                      {confirmDelete ? (
                        <span className="flex gap-2">
                          <button type="button" onClick={() => setConfirmDelete(false)} className="rounded-lg border border-line px-3 py-1.5 text-[12.5px]">
                            Avbryt
                          </button>
                          <button type="button" onClick={remove} className="rounded-lg bg-red-500 px-3 py-1.5 text-[12.5px] font-medium text-white">
                            Ja, slett for godt
                          </button>
                        </span>
                      ) : (
                        <button type="button" onClick={() => setConfirmDelete(true)} className={cn("inline-flex items-center gap-1.5 rounded-lg border border-red-500/40 px-3 py-1.5 text-[12.5px] text-red-400 transition hover:bg-red-500/10")}>
                          <Trash2 className="size-3.5" />
                          Slett
                        </button>
                      )}
                    </Row>
                  </div>
                </section>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
