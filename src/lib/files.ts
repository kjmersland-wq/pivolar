import type { UIMessage } from "ai";

export type FileMap = Record<string, string>;

/** What every new project starts with. The preview runs it in a Sandpack (react-ts) sandbox. */
export const TEMPLATE: FileMap = {
  "/App.tsx": `export default function App() {
  return (
    <main className="min-h-screen grid place-items-center bg-zinc-950 text-zinc-100">
      <div className="text-center space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">Klar til å bygge</h1>
        <p className="text-zinc-400">Beskriv hva du vil lage i chatten.</p>
      </div>
    </main>
  );
}
`,
  "/index.tsx": `import React, { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import App from "./App";

const root = createRoot(document.getElementById("root")!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
`,
  "/styles.css": `html, body, #root { margin: 0; min-height: 100%; }
body { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
`,
};

/** Packages the generated app may import. Keep in sync with the system prompt. */
export const SANDBOX_DEPENDENCIES: Record<string, string> = {
  "lucide-react": "0.468.0",
  "framer-motion": "11.15.0",
  clsx: "2.1.1",
};

export const TAILWIND_CDN = "https://cdn.tailwindcss.com";

export function normalizePath(path: string) {
  let value = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!value.startsWith("/")) value = `/${value}`;
  return value;
}

export type ToolResult = { ok: boolean; message: string };

type AnyPart = { type: string; state?: string; input?: Record<string, unknown>; output?: Partial<ToolResult> };

/**
 * Applies one tool call to a file map. Used by the server while it runs the tools and by the
 * client to rebuild the project from the chat history, so both always agree on the result.
 */
export function applyTool(files: FileMap, tool: string, input: Record<string, unknown>): ToolResult {
  if (tool === "writeFile") {
    const path = normalizePath(String(input.path ?? ""));
    if (path === "/") return { ok: false, message: "Mangler filsti." };
    files[path] = String(input.content ?? "");
    return { ok: true, message: `Skrev ${path}` };
  }
  if (tool === "editFile") {
    const path = normalizePath(String(input.path ?? ""));
    const oldText = String(input.oldText ?? "");
    const newText = String(input.newText ?? "");
    const current = files[path];
    if (current === undefined) return { ok: false, message: `${path} finnes ikke.` };
    if (!oldText) return { ok: false, message: "oldText kan ikke være tom." };
    const first = current.indexOf(oldText);
    if (first === -1) return { ok: false, message: `Fant ikke teksten i ${path}. Les filen på nytt og prøv igjen.` };
    if (current.indexOf(oldText, first + oldText.length) !== -1) {
      return { ok: false, message: `Teksten finnes flere ganger i ${path}. Ta med mer rundt for å gjøre den unik.` };
    }
    files[path] = current.slice(0, first) + newText + current.slice(first + oldText.length);
    return { ok: true, message: `Endret ${path}` };
  }
  if (tool === "deleteFile") {
    const path = normalizePath(String(input.path ?? ""));
    if (!(path in files)) return { ok: false, message: `${path} finnes ikke.` };
    delete files[path];
    return { ok: true, message: `Slettet ${path}` };
  }
  return { ok: false, message: `Ukjent verktøy ${tool}` };
}

/** Rebuilds the whole project from the template plus every finished tool call in the chat. */
export function deriveFiles(messages: UIMessage[]): FileMap {
  const files: FileMap = { ...TEMPLATE };
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const raw of message.parts) {
      const part = raw as AnyPart;
      if (!part.type.startsWith("tool-") || part.state !== "output-available" || part.output?.ok === false) continue;
      applyTool(files, part.type.slice(5), part.input ?? {});
    }
  }
  return files;
}
