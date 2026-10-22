"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { ChevronLeft, Code2, Eye, Monitor, Rocket, Smartphone, Tablet } from "lucide-react";
import { ChatPanel, type Mode } from "@/components/ChatPanel";
import { Logo } from "@/components/Logo";
import { Sandbox, type Device, type View } from "@/components/Preview";
import { ThemeToggle } from "@/components/ThemeToggle";
import { deriveFiles } from "@/lib/files";
import { getProject, loadMessages, saveMessages, takePendingPrompt, updateProject } from "@/lib/projects";
import { cn } from "@/lib/utils";

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

function Inner({ id, initialMessages, initialName }: { id: string; initialMessages: UIMessage[]; initialName: string }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("build");
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const [view, setView] = useState<View>("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [name, setName] = useState(initialName);

  const transport = useMemo(() => new DefaultChatTransport({ api: "/api/chat", body: () => ({ mode: modeRef.current }) }), []);
  const { messages, sendMessage, status, stop, setMessages, error } = useChat({ id, messages: initialMessages, transport });
  const busy = status === "submitted" || status === "streaming";

  const files = useMemo(() => deriveFiles(messages), [messages]);

  // Save the chat whenever a turn is finished.
  useEffect(() => {
    if (!busy) saveMessages(id, messages);
  }, [busy, messages, id]);

  // Start from the prompt typed on the home page, exactly once.
  useEffect(() => {
    if (initialMessages.length > 0) return;
    const prompt = takePendingPrompt(id);
    if (prompt) sendMessage({ text: prompt });
  }, [id, initialMessages.length, sendMessage]);

  // Name the project after the first request, unless the user already renamed it.
  useEffect(() => {
    if (name !== "Nytt prosjekt") return;
    const first = messages.find((m) => m.role === "user");
    const text = (first?.parts as { type: string; text?: string }[] | undefined)?.find((p) => p.type === "text")?.text?.trim();
    if (text) {
      const title = text.length > 42 ? `${text.slice(0, 42).trim()}…` : text;
      setName(title);
      updateProject(id, { name: title });
    }
  }, [messages, name, id]);

  const send = useCallback((text: string) => sendMessage({ text }), [sendMessage]);
  const fix = useCallback(
    (message: string) => {
      setMode("build");
      modeRef.current = "build";
      sendMessage({ text: `Forhåndsvisningen viser denne feilen. Finn årsaken og rett den:\n\n${message}` });
    },
    [sendMessage],
  );
  const revert = useCallback(
    (messageId: string) => {
      const index = messages.findIndex((m) => m.id === messageId);
      if (index >= 0) setMessages(messages.slice(0, index + 1));
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
            <Segmented
              value={device}
              onChange={setDevice}
              options={[
                { value: "desktop", label: "Desktop", icon: Monitor },
                { value: "tablet", label: "Nettbrett", icon: Tablet },
                { value: "mobile", label: "Mobil", icon: Smartphone },
              ]}
            />
          )}
          <ThemeToggle />
          <button
            type="button"
            disabled
            title="Publisering kommer i neste etappe"
            className="bg-brand hidden items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-medium text-white opacity-60 sm:flex"
          >
            <Rocket className="size-3.5" />
            Publiser
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(340px,430px)_1fr]">
        <aside className="min-h-0 border-b border-line bg-bg-soft/60 lg:border-b-0 lg:border-r">
          <ChatPanel messages={messages} status={status} error={error} mode={mode} onModeChange={setMode} onSend={send} onStop={stop} onRevert={revert} />
        </aside>
        <main className="min-h-0">
          <Sandbox files={files} view={view} device={device} busy={busy} onFix={fix} />
        </main>
      </div>
    </div>
  );
}

function Loader({ id }: { id: string | undefined }) {
  const [state, setState] = useState<{ messages: UIMessage[]; name: string } | "missing" | null>(null);
  useEffect(() => {
    if (!id) return;
    const project = getProject(id);
    setState(project ? { messages: loadMessages(id), name: project.name } : "missing");
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
          <p className="text-[13px] text-muted">Prosjektene ligger i denne nettleseren.</p>
          <a href="/" className="bg-brand inline-block rounded-xl px-4 py-2 text-[13px] font-medium text-white">
            Til forsiden
          </a>
        </div>
      </div>
    );
  }
  return <Inner key={id} id={id} initialMessages={state.messages} initialName={state.name} />;
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
