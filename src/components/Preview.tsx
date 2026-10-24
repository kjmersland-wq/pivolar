"use client";

import { useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from "react";
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
import type { Spec } from "@/lib/analyze/condense";
import { explainError } from "@/lib/explain/errors";
import { PROTECTED_PATHS, SANDBOX_DEPENDENCIES, TAILWIND_CDN, type FileMap } from "@/lib/files";
import { isStaticSite } from "@/components/StaticPreview";
import { mapForSandbox } from "@/lib/sandbox-map";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** "wide" is a fixed 1280 px frame, scaled to fit, so the preview can be measured against a reference at its width. */
export type Device = "desktop" | "tablet" | "mobile" | "wide";
export type View = "preview" | "code";

/** What the inspector inside the preview reports about the element the user clicked. */
export type PickedElement = Picked;

const WIDTHS: Record<Device, string> = { desktop: "100%", tablet: "820px", mobile: "390px", wide: "1280px" };
const WIDE = 1280;

const ignoreEdit = () => {};

const serialize = (files: FileMap) => JSON.stringify(Object.keys(files).sort().map((path) => [path, files[path]]));

function ErrorCard({ onFix, busy }: { onFix: (message: string) => void; busy: boolean }) {
  const { sandpack } = useSandpack();
  const message = sandpack.error?.message;
  const explained = useMemo(() => (message ? explainError(message) : null), [message]);
  if (!message) return null;
  // The raw message goes first, so repeated attempts at the same error are recognised; the reading follows.
  const fixMessage = explained ? `${message}

Tolkning: ${explained.hint}` : message;
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass absolute inset-x-4 bottom-4 z-10 max-h-[55%] overflow-auto rounded-2xl p-4 shadow-[var(--shadow)]"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-red-400" />
        <div className="min-w-0 flex-1">
          {explained ? (
            <>
              <p className="text-[13.5px] font-medium">{explained.summary}</p>
              <p className="mt-1 text-[12.5px] text-muted">{explained.cause}</p>
              <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12.5px]">
                {explained.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ul>
              {explained.where ? <p className="mt-1.5 text-[11.5px] text-muted">Sted: {explained.where}</p> : null}
              <details className="mt-2">
                <summary className="cursor-pointer text-[11.5px] text-muted">Teknisk melding</summary>
                <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted">{message}</pre>
              </details>
            </>
          ) : (
            <>
              <p className="text-[13.5px] font-medium">Forhåndsvisningen feilet</p>
              <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap font-mono text-[11.5px] text-muted">{message}</pre>
            </>
          )}
        </div>
        {explained && !explained.aiFixable ? null : (
          <button
            type="button"
            disabled={busy}
            onClick={() => onFix(fixMessage)}
            className="bg-brand flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white transition enabled:hover:brightness-110 disabled:opacity-50"
          >
            <Wand2 className="size-3.5" />
            Prøv å fikse
          </button>
        )}
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
  /** Shown instead of the in-browser preview when the project needs to be run for real. */
  runner?: React.ReactNode;
  /** Filled in with a function that measures the layout inside the preview. */
  measureRef?: MutableRefObject<(() => Promise<Spec>) | null>;
  /** Gets a small picture of the opening screen now and then, for the project list. */
  onShot?: (dataUrl: string) => void;
};

export function Sandbox({ files: projectFiles, view, device, busy, inspect, onFix, onEdit, onElement, onInspectDone, measureRef, runner, onShot }: SandboxProps) {
  const theme = useTheme();
  const frame = useRef<HTMLDivElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const wide = device === "wide";
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const [pickId, setPickId] = useState(0);
  // An imported Vite + React project is laid out like the starter for the preview only (see sandbox-map.ts).
  // Its real files stay as they are, so the code view of such a project is a read-only copy.
  const mapped = useMemo(() => mapForSandbox(projectFiles), [projectFiles]);
  const files = mapped?.files ?? projectFiles;
  // Other imported projects bring a package.json and a layout the sandbox cannot run.
  const previewable = mapped !== null || (!("/package.json" in projectFiles) && !isStaticSite(projectFiles));

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
  const dependencies = mapped?.dependencies;
  const customSetup = useMemo(() => ({ dependencies: dependencies ?? SANDBOX_DEPENDENCIES }), [dependencies]);
  const options = useMemo(
    () => ({ externalResources: [TAILWIND_CDN], recompileMode: "delayed" as const, recompileDelay: 350, initMode: "immediate" as const }),
    [],
  );

  // The wide frame is 1280 px and shrinks to fit the space it has.
  useEffect(() => {
    const node = pane.current;
    if (!node) return;
    const update = () => setScale(Math.min(1, Math.max(0.3, (node.clientWidth - 32) / WIDE)));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Layout measurement through the inspector inside the preview, for the comparison with a reference.
  useEffect(() => {
    if (!measureRef) return;
    measureRef.current = () =>
      new Promise<Spec>((resolve, reject) => {
        const target = frame.current?.querySelector("iframe")?.contentWindow;
        if (!target) return reject(new Error("Forhåndsvisningen er ikke klar."));
        const id = Math.random().toString(36).slice(2);
        const timer = window.setTimeout(() => {
          window.removeEventListener("message", onMessage);
          reject(new Error("Forhåndsvisningen svarte ikke. Sjekk at den vises uten feil."));
        }, 12000);
        function onMessage(event: MessageEvent) {
          if (event.source !== target || !event.data || event.data.type !== "atelier:measured" || event.data.id !== id) return;
          window.clearTimeout(timer);
          window.removeEventListener("message", onMessage);
          if (event.data.error || !event.data.spec) reject(new Error(String(event.data.error ?? "Målingen mislyktes.")));
          else resolve(event.data.spec as Spec);
        }
        window.addEventListener("message", onMessage);
        target.postMessage({ type: "atelier:measure", id, options: { maxBlocks: 90 } }, "*");
      });
    return () => {
      measureRef.current = null;
    };
  }, [measureRef, version]);

  // A small picture of the opening screen for the project list: asked for a few seconds after the
  // preview has settled, at desktop width only, and not more often than once a minute.
  const shotAt = useRef(0);
  useEffect(() => {
    if (!onShot || busy || view !== "preview" || device !== "desktop" || !previewable) return;
    const timer = window.setTimeout(() => {
      const target = frame.current?.querySelector("iframe")?.contentWindow;
      if (!target || Date.now() - shotAt.current < 60_000) return;
      shotAt.current = Date.now();
      const id = Math.random().toString(36).slice(2);
      const give = window.setTimeout(() => window.removeEventListener("message", onMessage), 15_000);
      function onMessage(event: MessageEvent) {
        if (event.source !== target || !event.data || event.data.type !== "atelier:captured" || event.data.id !== id) return;
        window.clearTimeout(give);
        window.removeEventListener("message", onMessage);
        if (typeof event.data.dataUrl === "string") onShot?.(event.data.dataUrl);
      }
      window.addEventListener("message", onMessage);
      target.postMessage({ type: "atelier:capture", id }, "*");
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [onShot, busy, view, device, previewable, version]);

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
      <EditorBridge known={known} snapshot={snapshot} onEdit={mapped ? ignoreEdit : onEdit} />
      {/* One provider for both views keeps the preview running while you look at the code. */}
      <div className={cn("relative h-full", view !== "preview" && "hidden")}>
        <div ref={pane} className={cn("flex h-full items-stretch overflow-auto bg-bg-soft p-0 sm:p-4", wide ? "justify-start overflow-hidden" : "justify-center")}>
          <motion.div
            ref={frame}
            animate={{ width: WIDTHS[device] }}
            transition={{ type: "spring", stiffness: 260, damping: 30 }}
            className={cn("h-full overflow-hidden bg-white", device !== "desktop" && "rounded-[22px] border border-line-strong shadow-[var(--shadow)]", device === "desktop" && "sm:rounded-xl sm:border sm:border-line")}
            style={wide ? { maxWidth: "none", flexShrink: 0, transform: `scale(${scale})`, transformOrigin: "top left", height: `${100 / scale}%` } : { maxWidth: "100%" }}
          >
            <SandpackLayout style={{ height: "100%", border: 0, borderRadius: 0, background: "transparent" }}>
              <SandpackPreview showNavigator={false} showOpenInCodeSandbox={false} showRefreshButton={false} showSandpackErrorOverlay={false} style={{ height: "100%", flex: 1 }} />
            </SandpackLayout>
          </motion.div>
        </div>
        {!previewable && (runner ?? null)}
        {picked ? (
          <ElementPanel
            key={pickId}
            picked={picked}
            files={projectFiles}
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
          previewable && <ErrorCard onFix={onFix} busy={busy} />
        )}
      </div>

      <div className={cn("flex h-full flex-col", view !== "code" && "hidden")}>
        {mapped && <p className="shrink-0 border-b border-line bg-surface-2 px-4 py-2 text-[12.5px] text-muted">Dette er en tilpasset kopi som brukes til forhåndsvisningen (stier og importer er justert). Filene i prosjektet endres med chatten.</p>}
        <SandpackLayout style={{ height: "100%", minHeight: 0, border: 0, borderRadius: 0 }}>
          <SandpackFileExplorer autoHiddenFiles style={{ height: "100%", minWidth: 200, maxWidth: 240 }} />
          <SandpackCodeEditor showLineNumbers showTabs showInlineErrors readOnly={mapped !== null} style={{ height: "100%", flex: 1 }} />
        </SandpackLayout>
      </div>
    </SandpackProvider>
  );
}
