"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { SANDBOX_DEPENDENCIES, TAILWIND_CDN, type FileMap } from "@/lib/files";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

export type Device = "desktop" | "tablet" | "mobile";
export type View = "preview" | "code";

const WIDTHS: Record<Device, string> = { desktop: "100%", tablet: "820px", mobile: "390px" };

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

export function Sandbox({ files, view, device, busy, onFix }: { files: FileMap; view: View; device: Device; busy: boolean; onFix: (message: string) => void }) {
  const theme = useTheme();

  // SandpackProvider reads `files` only when it mounts, and in-place updates proved unreliable, so
  // the preview is restarted with the new files shortly after they settle. The short delay lets a
  // burst of tool calls collapse into one refresh.
  const [shown, setShown] = useState(files);
  const [version, setVersion] = useState(0);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      setShown(files);
      setVersion((v) => v + 1);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [files]);

  const customSetup = useMemo(() => ({ dependencies: SANDBOX_DEPENDENCIES }), []);
  const options = useMemo(
    () => ({ externalResources: [TAILWIND_CDN], recompileMode: "delayed" as const, recompileDelay: 350, initMode: "immediate" as const }),
    [],
  );

  return (
    <SandpackProvider key={version} template="react-ts" theme={theme} files={shown} customSetup={customSetup} options={options} style={{ height: "100%" }}>
      {/* One provider for both views keeps the preview running while you look at the code. */}
      <div className={cn("relative h-full", view !== "preview" && "hidden")}>
        <div className="flex h-full items-stretch justify-center overflow-auto bg-bg-soft p-0 sm:p-4">
          <motion.div
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
        <ErrorCard onFix={onFix} busy={busy} />
      </div>

      <div className={cn("h-full", view !== "code" && "hidden")}>
        <SandpackLayout style={{ height: "100%", border: 0, borderRadius: 0 }}>
          <SandpackFileExplorer style={{ height: "100%", minWidth: 200, maxWidth: 240 }} />
          <SandpackCodeEditor readOnly showReadOnly={false} showLineNumbers showTabs style={{ height: "100%", flex: 1 }} />
        </SandpackLayout>
      </div>
    </SandpackProvider>
  );
}
