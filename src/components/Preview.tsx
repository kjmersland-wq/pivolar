"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  SandpackCodeEditor,
  SandpackFileExplorer,
  SandpackLayout,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react";
import { motion } from "framer-motion";
import { AlertTriangle, Wand2 } from "lucide-react";
import { ElementPanel, type Picked } from "@/components/ElementPanel";
import { PROTECTED_PATHS, SANDBOX_DEPENDENCIES, TAILWIND_CDN, type FileMap } from "@/lib/files";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type Device = "desktop" | "tablet" | "mobile";
export type View = "preview" | "code";

/** What the inspector inside the preview reports about the element the user clicked. */
export type PickedElement = Picked;

const WIDTHS: Record<Device, string> = { desktop: "100%", tablet: "820px", mobile: "390px" };

const serialize = (files: FileMap) => JSON.stringify(Object.keys(files).sort().map((path) => [path, files[path]]));

function ErrorCard({ onFix, busy }: { onFix: (message: string) => void; busy: boolean }) {
  const { sandpack } = useSandpack();
  const message = sandpack.error?.message;
  if (!message) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass absolute inset-x-4 bottom-4 z-10 max-h-[45%] overflow-hidden rounded-2xl p-4 shadow-[var(--shadow)]"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-medium">Forhåndsvisningen feilet</p>
          <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted">{message}</pre>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => onFix(message)}
          className="bg-brand flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50"
        >
          <Wand2 className="size-3.5" />
          Prøv å fikse
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Watches the code editor. Whatever the user types is reported as an edit, and the sandbox's own
 * contents are remembered so the preview is not restarted for changes it already contains.
 */
function EditorBridge({
  known,
  snapshot,
  onEdit,
}: {
  known: RefObject<FileMap>;
  snapshot: RefObject<string>;
  onEdit: (path: string, content: string) => void;
}) {
  const { sandpack } = useSandpack();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current: FileMap = {};
      for (const path of Object.keys(known.current)) {
        const file = sandpack.files[path];
        if (file) current[path] = file.code;
      }
      snapshot.current = serialize(current);
      for (const [path, code] of Object.entries(current)) {
        if (known.current[path] !== code && !PROTECTED_PATHS.has(path)) onEdit(path, code);
      }
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sandpack.files]);
  return null;
}

type SandboxProps = {
  files: FileMap;
  view: View;
  device: Device;
  busy: boolean;
  inspect: boolean;
  onFix: (message: string) => void;
  onEdit: (path: string, content: string) => void;
  onElement: (picked: PickedElement, request: string) => void;
  onInspectDone: () => void;
};

export function Sandbox({ files, view, device, busy, inspect, onFix, onEdit, onElement, onInspectDone }: SandboxProps) {
  const theme = useTheme();
  const frame = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const [pickId, setPickId] = useState(0);
  // Imported projects bring their own package.json and layout, which the sandbox cannot run.
  const previewable = !("/package.json" in files);

  const known = useRef(files);
  const snapshot = useRef(serialize(files));
  useEffect(() => {
    known.current = files;
  }, [files]);

  // SandpackProvider reads `files` only when it mounts, and in-place updates proved unreliable, so
  // the preview is restarted with new files shortly after they settle. A burst of tool calls
  // collapses into one refresh, and edits typed in the editor (already in the sandbox) never restart it.
  const [shown, setShown] = useState(files);
  const [version, setVersion] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      if (serialize(files) === snapshot.current) return;
      setShown(files);
      snapshot.current = serialize(files);
      setVersion((v) => v + 1);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [files]);

  const sandpackFiles = useMemo(
    () => Object.fromEntries(Object.entries(shown).map(([path, code]) => [path, PROTECTED_PATHS.has(path) ? { code, hidden: true } : code])),
    [shown],
  );
  const customSetup = useMemo(() => ({ dependencies: SANDBOX_DEPENDENCIES }), []);
  const options = useMemo(
    () => ({ externalResources: [TAILWIND_CDN], recompileMode: "delayed" as const, recompileDelay: 350, initMode: "immediate" as const }),
    [],
  );

  // Talk to the inspector script inside the preview iframe.
  const inspectRef = useRef(inspect);
  useEffect(() => {
    inspectRef.current = inspect;
  }, [inspect]);
  useEffect(() => {
    const iframe = () => frame.current?.querySelector("iframe") ?? null;
    const send = () => iframe()?.contentWindow?.postMessage({ type: "atelier:inspect", on: inspectRef.current }, "*");
    const onMessage = (event: MessageEvent) => {
      const target = iframe()?.contentWindow;
      if (!target || event.source !== target || !event.data || typeof event.data !== "object") return;
      if (event.data.type === "atelier:ready") send();
      if (event.data.type === "atelier:select") {
        setPicked(event.data.info as PickedElement);
        setPickId((id) => id + 1);
      }
    };
    window.addEventListener("message", onMessage);
    send();
    return () => window.removeEventListener("message", onMessage);
  }, [version]);
  useEffect(() => {
    frame.current?.querySelector("iframe")?.contentWindow?.postMessage({ type: "atelier:inspect", on: inspect }, "*");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the selection belongs to inspect mode
    if (!inspect) setPicked(null);
  }, [inspect]);

  return (
    <SandpackProvider key={version} template="react-ts" theme={theme} files={sandpackFiles} customSetup={customSetup} options={options} style={{ height: "100%" }}>
      <EditorBridge known={known} snapshot={snapshot} onEdit={onEdit} />
      {/* One provider for both views keeps the preview running while you look at the code. */}
      <div className={cn("relative h-full", view !== "preview" && "hidden")}>
        <div className="flex h-full items-stretch justify-center overflow-auto bg-bg-soft p-0 sm:p-4">
          <motion.div
            ref={frame}
            animate={{ width: WIDTHS[device] }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className={cn("h-full overflow-hidden bg-white", device !== "desktop" && "rounded-[22px] border border-line-strong shadow-[var(--shadow)]", device === "desktop" && "sm:rounded-xl sm:border sm:border-line")}
            style={{ maxWidth: "100%" }}
          >
            <SandpackLayout style={{ height: "100%", border: 0, borderRadius: 0, background: "transparent" }}>
              <SandpackPreview showNavigator={false} showOpenInCodeSandbox={false} showRefreshButton={false} showSandpackErrorOverlay={false} style={{ height: "100%", flex: 1 }} />
            </SandpackLayout>
          </motion.div>
        </div>
        {!previewable && (
          <div className="absolute inset-0 z-10 grid place-items-center bg-bg-soft p-8 text-center">
            <div className="max-w-sm space-y-2">
              <p className="text-[15px] font-medium">Forhåndsvisning støttes ikke for dette prosjektet ennå</p>
              <p className="text-[13px] leading-relaxed text-muted">Det er importert utenfra og må kjøres i et isolert miljø for å vises. Bytt til «Kode» for å lese og redigere filene, eller til «Eksporter» for å laste dem ned.</p>
            </div>
          </div>
        )}
        {picked ? (
          <ElementPanel
            key={pickId}
            picked={picked}
            files={files}
            onFile={onEdit}
            onPicked={setPicked}
            onClose={() => setPicked(null)}
            onSend={(request) => {
              onElement(picked, request);
              setPicked(null);
              onInspectDone();
            }}
          />
        ) : (
          <ErrorCard onFix={onFix} busy={busy} />
        )}
      </div>

      <div className={cn("h-full", view !== "code" && "hidden")}>
        <SandpackLayout style={{ height: "100%", border: 0, borderRadius: 0 }}>
          <SandpackFileExplorer autoHiddenFiles style={{ height: "100%", minWidth: 200, maxWidth: 240 }} />
          <SandpackCodeEditor showLineNumbers showTabs showInlineErrors style={{ height: "100%", flex: 1 }} />
        </SandpackLayout>
      </div>
    </SandpackProvider>
  );
}
