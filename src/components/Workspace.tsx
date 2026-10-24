"use client";

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart, type UIMessage } from "ai";
import { BarChart3, ChevronLeft, Code2, Download, Eye, LayoutTemplate, Maximize2, Monitor, GitPullRequest, MousePointerClick, Plug, Rocket, ScanSearch, ShieldCheck, Smartphone, Tablet } from "lucide-react";
import { BudgetDialog } from "@/components/BudgetDialog";
import { CheckDialog } from "@/components/CheckDialog";
import { AnalyticsDialog } from "@/components/AnalyticsDialog";
import { ConnectorsDialog } from "@/components/ConnectorsDialog";
import { LoopDialog } from "@/components/LoopDialog";
import { PullRequestDialog } from "@/components/PullRequestDialog";
import { RunnerPreview } from "@/components/RunnerPreview";
import { isStaticSite, StaticPreview } from "@/components/StaticPreview";
import { CompareDialog } from "@/components/CompareDialog";
import { ChatPanel, type Mode } from "@/components/ChatPanel";
import { ComposeDialog } from "@/components/ComposeDialog";
import { ExportDialog } from "@/components/ExportDialog";
import { Logo } from "@/components/Logo";
import { PublishDialog } from "@/components/PublishDialog";
import { QueuedBar } from "@/components/QueuedBar";
import { Sandbox, type Device, type PickedElement, type View } from "@/components/Preview";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UsageMeter } from "@/components/UsageMeter";
import { deriveFiles, type UserEdit } from "@/lib/files";
import { getProject, loadEdits, loadImportInfo, loadMessages, saveEdits, saveMessages, takePendingPrompt, updateProject } from "@/lib/projects";
import { addQueued, loadQueued, removeQueued } from "@/lib/queued";
import { pullOne } from "@/lib/sync";
import { fetchUsage, invalidateUsage } from "@/lib/usage/client";
import type { Budget } from "@/lib/usage/summary";
import type { Spec } from "@/lib/analyze/condense";
import { findReference } from "@/lib/analyze/reference";
import { cn } from "@/lib/utils";

/** Times the same preview error is sent for fixing before the owner is asked. */
const MAX_FIX_ATTEMPTS = 2;

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (value: T) => void; options: { value: T; label?: string; icon: typeof Eye }[] }) {
  return (
    <div className="flex rounded-xl border border-line bg-surface-2 p-0.5">
      {options.map(({ value: v, label, icon: Icon }) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          title={label}
          aria-label={label}
          className={cn("flex items-center gap-1.5 rounded-[10px] px-2.5 py-1.5 text-[12.5px] transition", value === v ? "bg-surface text-fg shadow-sm" : "text-muted hover:text-fg")}
        >
          <Icon className="size-3.5" />
          {label && <span className="hidden md:inline">{label}</span>}
        </button>
      ))}
    </div>
  );
}

function Inner({ id, initialMessages, initialEdits, initialName }: { id: string; initialMessages: UIMessage[]; initialEdits: UserEdit[]; initialName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("build");
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const [view, setView] = useState<View>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [name, setName] = useState(initialName);
  const [inspect, setInspect] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  const [connectorsOpen, setConnectorsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [prOpen, setPrOpen] = useState(false);
  // Set when the project was imported from GitHub; changes can then be sent back as a pull request.
  const [github] = useState(() => loadImportInfo(id)?.github ?? null);
  const [exportOpen, setExportOpen] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  // The same preview error sent for fixing again and again. After MAX_FIX_ATTEMPTS the owner is asked first.
  const fixAttempts = useRef<{ key: string; count: number; startedAt: number } | null>(null);
  const [loopBlock, setLoopBlock] = useState<{ message: string; attempts: number; startedAt: number } | null>(null);
  const measureRef = useRef<(() => Promise<Spec>) | null>(null);

  // Code the user typed in the editor. Each edit remembers how many messages existed at that
  // moment, so reverting the chat also reverts the edits that came after.
  const [edits, setEdits] = useState<UserEdit[]>(initialEdits);
  const editsRef = useRef(edits);
  useEffect(() => {
    editsRef.current = edits;
    saveEdits(id, edits);
  }, [edits, id]);

  // The body is read when a request is sent, never during render, so the refs are safe here.
  // eslint-disable-next-line react-hooks/refs
  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat", body: () => ({ mode: modeRef.current, edits: editsRef.current }) }), []);
  const { messages, sendMessage, status, stop, setMessages, error } = useChat({ id, messages: initialMessages, transport });
  const busy = status === "submitted" || status === "streaming";

  // Every message goes through the budget check. A used-up budget never blocks for good: the owner
  // chooses to keep the message for later or to delete it. If the meter cannot be read, the message is sent.
  type Outgoing = { text: string; files?: FileUIPart[] };
  const [blocked, setBlocked] = useState<{ payload: Outgoing; budget: Budget } | null>(null);
  const [queued, setQueued] = useState(() => loadQueued(id));
  const guarded = useCallback(
    async (payload: Outgoing) => {
      const usage = await fetchUsage();
      if (usage?.budget.level === "over") return setBlocked({ payload, budget: usage.budget });
      sendMessage(payload);
    },
    [sendMessage],
  );
  // A finished turn has cost money; refresh the meter once the server has logged it.
  useEffect(() => {
    if (!busy) invalidateUsage(1500);
  }, [busy]);

  const files = useMemo(() => deriveFiles(messages, edits), [messages, edits]);

  // The newest measured reference site in the conversation, if there is one.
  const reference = useMemo(() => findReference(messages), [messages]);
  const measure = useCallback(
    () => (measureRef.current ? measureRef.current() : Promise.reject(new Error("Forhåndsvisningen er ikke klar ennå. Vent litt og prøv igjen."))),
    [],
  );
  const messageCount = useRef(messages.length);
  useEffect(() => {
    messageCount.current = messages.length;
  }, [messages.length]);

  const editFile = useCallback((path: string, content: string) => {
    setEdits((prev) => {
      const at = messageCount.current;
      return [...prev.filter((edit) => !(edit.at === at && edit.path === path)), { at, path, content }];
    });
  }, []);

  const compose = useCallback(
    (composed: Record<string, string>) => {
      for (const [path, content] of Object.entries(composed)) editFile(path, content);
    },
    [editFile],
  );

  // Save the chat whenever a turn is finished.
  useEffect(() => {
    if (!busy) saveMessages(id, messages);
  }, [busy, messages, id]);

  // Start from the prompt typed on the home page, exactly once.
  useEffect(() => {
    if (initialMessages.length > 0) return;
    // Wait a tick: React's dev-mode mount/unmount/mount would otherwise reset the chat right after
    // the first send. The cleanup cancels the first schedule, so only the settled mount sends.
    const timer = window.setTimeout(() => {
      const prompt = takePendingPrompt(id);
      if (prompt) void guarded({ text: prompt });
    }, 50);
    return () => window.clearTimeout(timer);
  }, [id, initialMessages.length, guarded]);

  // Name the project after the first request, unless the user already renamed it.
  useEffect(() => {
    if (name !== "Nytt prosjekt") return;
    const first = messages.find((m) => m.role === "user");
    const text = (first?.parts as { type: string; text?: string }[] | undefined)?.find((p) => p.type === "text")?.text?.trim();
    if (text) {
      const title = text.length > 42 ? `${text.slice(0, 42).trim()}…` : text;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- derived once from the first message
      setName(title);
      updateProject(id, { name: title });
    }
  }, [messages, name, id]);

  const send = useCallback(
    (text: string, attachments: FileUIPart[] = []) => {
      fixAttempts.current = null; // a message from the owner starts over
      return guarded(attachments.length > 0 ? { text, files: attachments } : { text });
    },
    [guarded],
  );
  const changeElement = useCallback(
    (picked: PickedElement, request: string) => {
      setMode("build");
      modeRef.current = "build";
      const details = [
        `Element: <${picked.tag}>`,
        picked.text ? `Tekst: «${picked.text}»` : "",
        picked.className ? `Klasser: ${picked.className}` : "",
        picked.components.length > 0 ? `Komponenter (innerst først): ${picked.components.join(" > ")}` : "",
        `HTML: ${picked.html}`,
      ]
        .filter(Boolean)
        .join("\n");
      void guarded({ text: `${request}\n\n<valgt-element>\n${details}\n</valgt-element>` });
    },
    [guarded],
  );
  const sendFix = useCallback(
    (message: string) => {
      setMode("build");
      modeRef.current = "build";
      void guarded({ text: `Forhåndsvisningen viser denne feilen. Finn årsaken og rett den:\n\n${message}` });
    },
    [guarded],
  );
  const fix = useCallback(
    (message: string) => {
      const key = message.replace(/\s+/g, " ").trim().slice(0, 240);
      const current = fixAttempts.current;
      const attempt = current && current.key === key ? { ...current, count: current.count + 1 } : { key, count: 1, startedAt: messages.length };
      fixAttempts.current = attempt;
      if (attempt.count > MAX_FIX_ATTEMPTS) return setLoopBlock({ message, attempts: attempt.count - 1, startedAt: attempt.startedAt });
      sendFix(message);
    },
    [messages.length, sendFix],
  );
  const revert = useCallback(
    (messageId: string) => {
      const index = messages.findIndex((m) => m.id === messageId);
      if (index < 0) return;
      setMessages(messages.slice(0, index + 1));
      setEdits((prev) => prev.filter((edit) => edit.at <= index + 1));
    },
    [messages, setMessages],
  );

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-3">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => router.push("/")} className="grid size-9 place-items-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-fg" aria-label="Til forsiden">
            <ChevronLeft className="size-[18px]" />
          </button>
          <Logo className="hidden sm:flex" />
          <span className="hidden h-5 w-px bg-line sm:block" />
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => updateProject(id, { name: name.trim() || "Nytt prosjekt" })}
            className="min-w-0 max-w-[260px] rounded-md bg-transparent px-2 py-1 text-[14px] font-medium outline-none transition hover:bg-surface-2 focus:bg-surface-2"
            aria-label="Prosjektnavn"
          />
        </div>

        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "preview", label: "Forhåndsvisning", icon: Eye },
            { value: "code", label: "Kode", icon: Code2 },
          ]}
        />

        <div className="flex items-center gap-1.5">
          {view === "preview" && (
            <button
              type="button"
              onClick={() => setInspect((on) => !on)}
              title="Velg et element i forhåndsvisningen og be om en endring"
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[12.5px] transition",
                inspect ? "border-accent bg-accent/10 text-accent" : "border-line bg-surface-2 text-muted hover:text-fg",
              )}
            >
              <MousePointerClick className="size-3.5" />
              <span className="hidden md:inline">{inspect ? "Velger …" : "Velg element"}</span>
            </button>
          )}
          {view === "preview" && (
            <Segmented
              value={device}
              onChange={setDevice}
              options={[
                { value: "desktop", label: "Desktop", icon: Monitor },
                { value: "tablet", label: "Nettbrett", icon: Tablet },
                { value: "mobile", label: "Mobil", icon: Smartphone },
                { value: "wide", label: "1280", icon: Maximize2 },
              ]}
            />
          )}
          <button
            type="button"
            onClick={() => setComposeOpen(true)}
            disabled={busy}
            title="Sett sammen en side av ferdige seksjoner, uten AI"
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-muted transition enabled:hover:text-fg disabled:opacity-50"
          >
            <LayoutTemplate className="size-3.5" />
            <span className="hidden md:inline">Sett sammen</span>
          </button>
          {github && (
            <button
              type="button"
              onClick={() => setPrOpen(true)}
              disabled={busy}
              title="Send endringene til GitHub som en pull request"
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-muted transition enabled:hover:text-fg disabled:opacity-50"
            >
              <GitPullRequest className="size-3.5" />
              <span className="hidden md:inline">Send til GitHub</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setCheckOpen(true)}
            title="Sjekk koden for rot og sikkerhetshull"
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-muted transition hover:text-fg"
          >
            <ShieldCheck className="size-3.5" />
            <span className="hidden md:inline">Kontroll</span>
          </button>
          <button
            type="button"
            onClick={() => setConnectorsOpen(true)}
            title="Legg til betaling og nyhetsbrev"
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-muted transition hover:text-fg"
          >
            <Plug className="size-3.5" />
            <span className="hidden md:inline">Koblinger</span>
          </button>
          <button
            type="button"
            onClick={() => setAnalyticsOpen(true)}
            title="Se besøk på den publiserte siden"
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-muted transition hover:text-fg"
          >
            <BarChart3 className="size-3.5" />
            <span className="hidden md:inline">Analyse</span>
          </button>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            title="Last ned hele prosjektet som ZIP"
            className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-muted transition hover:text-fg"
          >
            <Download className="size-3.5" />
            <span className="hidden md:inline">Eksporter</span>
          </button>
          {reference && (
            <button
              type="button"
              onClick={() => {
                setView("preview");
                setDevice("wide");
                setCompareOpen(true);
              }}
              disabled={busy}
              title="Mål forhåndsvisningen mot referansesiden og se hva som avviker"
              className="flex items-center gap-1.5 rounded-xl border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-muted transition enabled:hover:text-fg disabled:opacity-50"
            >
              <ScanSearch className="size-3.5" />
              <span className="hidden md:inline">Sammenlign</span>
            </button>
          )}
          <UsageMeter />
          <ThemeToggle />
          <button
            type="button"
            onClick={() => setPublishOpen(true)}
            disabled={busy}
            title="Legg koden på GitHub og siden live på Vercel"
            className="bg-brand flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium text-white shadow-[0_8px_24px_-10px_var(--accent)] transition enabled:hover:brightness-110 disabled:opacity-60"
          >
            <Rocket className="size-3.5" />
            <span className="hidden sm:inline">Publiser</span>
          </button>
        </div>
      </header>

      <QueuedBar
        items={queued}
        onSend={(item) => {
          setQueued(removeQueued(id, item.id));
          void guarded({ text: item.text });
        }}
        onDelete={(item) => setQueued(removeQueued(id, item.id))}
      />
      {blocked && (
        <BudgetDialog
          text={blocked.payload.text}
          hadAttachments={(blocked.payload.files?.length ?? 0) > 0}
          budget={blocked.budget}
          onSave={() => {
            setQueued(addQueued(id, blocked.payload.text, (blocked.payload.files?.length ?? 0) > 0));
            setBlocked(null);
          }}
          onDiscard={() => setBlocked(null)}
        />
      )}
      {loopBlock && (
        <LoopDialog
          attempts={loopBlock.attempts}
          error={loopBlock.message}
          onCancel={() => setLoopBlock(null)}
          onTryAnyway={() => {
            const { message } = loopBlock;
            setLoopBlock(null);
            sendFix(message);
          }}
          onGoBack={() => {
            // Back to how the project was before the first attempt, including the edits made after that point.
            const { startedAt } = loopBlock;
            setMessages(messages.slice(0, startedAt));
            setEdits((prev) => prev.filter((edit) => edit.at <= startedAt));
            fixAttempts.current = null;
            setLoopBlock(null);
          }}
        />
      )}
      <ComposeDialog open={composeOpen} onClose={() => setComposeOpen(false)} onCompose={compose} initialName={name} />
      <CompareDialog
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        reference={reference}
        measure={measure}
        busy={busy}
        onFix={(text) => {
          setMode("build");
          modeRef.current = "build";
          void guarded({ text });
        }}
      />
      {github && <PullRequestDialog open={prOpen} github={github} files={files} onClose={() => setPrOpen(false)} />}
      <CheckDialog
        open={checkOpen}
        files={files}
        busy={busy}
        onClose={() => setCheckOpen(false)}
        onFix={(text) => {
          setMode("build");
          modeRef.current = "build";
          void guarded({ text });
        }}
        onReview={(text) => {
          // A review only reports, so it runs in chat mode where no file can change.
          setMode("chat");
          modeRef.current = "chat";
          void guarded({ text });
        }}
      />
      <AnalyticsDialog open={analyticsOpen} projectId={id} onClose={() => setAnalyticsOpen(false)} />
      <ConnectorsDialog
        open={connectorsOpen}
        projectId={id}
        files={files}
        busy={busy}
        onClose={() => setConnectorsOpen(false)}
        onAddFiles={(added) => {
          for (const [path, content] of Object.entries(added)) editFile(path, content);
        }}
        onFix={(text) => {
          setMode("build");
          modeRef.current = "build";
          void guarded({ text });
        }}
      />
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} projectId={id} name={name} files={files} />
      <PublishDialog open={publishOpen} onClose={() => setPublishOpen(false)} projectId={id} projectName={name} files={files} />

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,430px)_1fr]">
        <aside className="min-h-0 border-b border-line bg-bg-soft/60 lg:border-b-0 lg:border-r">
          <ChatPanel messages={messages} status={status} error={error} mode={mode} onModeChange={setMode} onSend={send} onStop={stop} onRevert={revert} />
        </aside>
        <main className="min-h-0">
          <Sandbox files={files} view={view} device={device} busy={busy} inspect={inspect} onFix={fix} onEdit={editFile} onElement={changeElement} onInspectDone={() => setInspect(false)} measureRef={measureRef} runner={isStaticSite(files) ? <StaticPreview files={files} github={github} /> : <RunnerPreview projectId={id} files={files} github={github} />} />
        </main>
      </div>
    </div>
  );
}

function Loader({ id }: { id: string | undefined }) {
  const [state, setState] = useState<{ messages: UIMessage[]; edits: UserEdit[]; name: string } | "missing" | null>(null);
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      // A project made on another device is not in this browser yet; fetch it from the account first.
      if (!getProject(id)) await pullOne(id);
      if (cancelled) return;
      const project = getProject(id);
      setState(project ? { messages: loadMessages(id), edits: loadEdits(id), name: project.name } : "missing");
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (!id || state === null) {
    return (
      <div className="grid h-dvh place-items-center">
        <div className="shimmer h-3 w-40 rounded-full" />
      </div>
    );
  }
  if (state === "missing") {
    return (
      <div className="grid h-dvh place-items-center text-center">
        <div className="space-y-3">
          <p className="text-[15px] font-medium">Fant ikke prosjektet</p>
          <p className="text-[13px] text-muted">Det finnes ikke i denne nettleseren eller på kontoen din.</p>
          <Link href="/" className="bg-brand inline-block rounded-xl px-4 py-2 text-[13px] font-medium text-white">
            Til forsiden
          </Link>
        </div>
      </div>
    );
  }
  return <Inner key={id} id={id} initialMessages={state.messages} initialEdits={state.edits} initialName={state.name} />;
}

function FromRoute() {
  const { id } = useParams<{ id?: string }>();
  return <Loader id={id} />;
}

export function Workspace() {
  return (
    <Suspense fallback={null}>
      <FromRoute />
    </Suspense>
  );
}
