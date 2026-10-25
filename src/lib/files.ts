import { MEASURE_SOURCE } from "./analyze/measure-script.ts";
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
  "/index.tsx": `import "./atelier-inspector";
import React, { StrictMode } from "react";
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
  "/atelier-inspector.js": String.raw`/* Pivolar inspector. Lets the editor pick an element in this preview. Hidden from the AI and the user. */
(function () {
  if (window.__atelierInspector) return;
  window.__atelierInspector = true;
  var active = false;
  var box = null;
  function ensureBox() {
    if (box) return box;
    box = document.createElement("div");
    box.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #f43f5e;background:rgba(244,63,94,.12);border-radius:4px;transition:all .06s ease-out;display:none";
    document.body.appendChild(box);
    return box;
  }
  function components(el) {
    var names = [];
    var key = null;
    for (var k in el) { if (k.indexOf("__reactFiber$") === 0) { key = k; break; } }
    var fiber = key ? el[key] : null;
    while (fiber && names.length < 5) {
      if (typeof fiber.type === "function" && fiber.type.name && names.indexOf(fiber.type.name) === -1) names.push(fiber.type.name);
      fiber = fiber.return;
    }
    return names;
  }
  function describe(el) {
    var html = el.outerHTML || "";
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || "").trim().slice(0, 160),
      className: typeof el.className === "string" ? el.className.slice(0, 240) : "",
      html: html.length > 500 ? html.slice(0, 500) + "…" : html,
      components: components(el)
    };
  }
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "atelier:inspect") return;
    active = !!e.data.on;
    document.documentElement.style.cursor = active ? "crosshair" : "";
    if (!active && box) box.style.display = "none";
  });
  document.addEventListener("mousemove", function (e) {
    if (!active) return;
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === box || el === document.body || el === document.documentElement) return;
    var r = el.getBoundingClientRect();
    var b = ensureBox();
    b.style.display = "block";
    b.style.left = r.left + "px"; b.style.top = r.top + "px";
    b.style.width = r.width + "px"; b.style.height = r.height + "px";
  }, true);
  document.addEventListener("click", function (e) {
    if (!active) return;
    e.preventDefault(); e.stopPropagation();
    var el = e.target;
    if (!el || el === box) return;
    window.parent.postMessage({ type: "atelier:select", info: describe(el) }, "*");
  }, true);
  window.parent.postMessage({ type: "atelier:ready" }, "*");
  // Layout measurement on request, so the preview can be compared with a reference site.
  var measure = ${MEASURE_SOURCE};
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "atelier:measure") return;
    var spec = null, error = null;
    try { spec = measure(e.data.options || {}); } catch (err) { error = String((err && err.message) || err); }
    window.parent.postMessage({ type: "atelier:measured", id: e.data.id, spec: spec, error: error }, "*");
  });
  // A small picture of the opening screen, for the project list. The drawing library is loaded the first time it is needed.
  var shotQueue = null;
  function withShotLib(done) {
    if (window.htmlToImage) return done(null);
    if (shotQueue) { shotQueue.push(done); return; }
    shotQueue = [done];
    var script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js";
    var finish = function (err) { var q = shotQueue; shotQueue = null; q.forEach(function (f) { f(err); }); };
    script.onload = function () { finish(null); };
    script.onerror = function () { finish(new Error("lib")); };
    document.head.appendChild(script);
  }
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "atelier:capture") return;
    var id = e.data.id;
    var reply = function (dataUrl, error) { window.parent.postMessage({ type: "atelier:captured", id: id, dataUrl: dataUrl, error: error }, "*"); };
    withShotLib(function (err) {
      if (err || !window.htmlToImage) return reply(null, "lib");
      if (box) box.style.display = "none";
      var width = Math.min(window.innerWidth || 1280, 1280);
      var height = Math.round(width * 0.625);
      var back = getComputedStyle(document.body).backgroundColor;
      if (!back || back === "rgba(0, 0, 0, 0)") back = getComputedStyle(document.documentElement).backgroundColor;
      if (!back || back === "rgba(0, 0, 0, 0)") back = "#ffffff";
      window.htmlToImage.toJpeg(document.body, { width: width, height: height, canvasWidth: 480, canvasHeight: 300, quality: 0.72, backgroundColor: back, imagePlaceholder: "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==" })
        .then(function (url) { reply(url, null); })
        .catch(function (error) { reply(null, String((error && error.message) || error)); });
    });
  });
})();
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
  recharts: "2.15.0",
  "react-router-dom": "6.28.0",
  "date-fns": "4.1.0",
  "@supabase/supabase-js": "2.45.4",
};

export const TAILWIND_CDN = "https://cdn.tailwindcss.com";

export function normalizePath(path: string) {
  let value = path.trim().replace(/\\/g, "/").replace(/\/+/g, "/");
  if (!value.startsWith("/")) value = `/${value}`;
  return value;
}

/** The owner's standing instructions for the project. A hidden file: see lib/knowledge.ts. */
export const KNOWLEDGE_PATH = "/KNOWLEDGE.md";
/** The list of files the owner has added (pictures, sound, PDFs). Hidden in the same way: see lib/uploads/rules.ts. */
export const UPLOADS_PATH = "/UPLOADS.json";

/**
 * Files the AI and the user must not change, and that are never shown, published or exported: the
 * sandbox entry point and the inspector it loads, and the owner's instructions (changed only from the project panel).
 */
export const PROTECTED_PATHS = new Set(["/index.tsx", "/atelier-inspector.js", KNOWLEDGE_PATH, UPLOADS_PATH]);

export type ToolResult = { ok: boolean; message: string };

/** A change the user typed into the code editor. `at` is how many chat messages existed at that moment. */
export type UserEdit = { at: number; path: string; content: string };

/** Files shown to the AI and in the editor: everything except the protected ones. */
export function visibleFiles(files: FileMap): FileMap {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !PROTECTED_PATHS.has(path)));
}

type AnyPart = { type: string; state?: string; input?: Record<string, unknown>; output?: Partial<ToolResult> };

/**
 * Applies one tool call to a file map. Used by the server while it runs the tools and by the
 * client to rebuild the project from the chat history, so both always agree on the result.
 */
export function applyTool(files: FileMap, tool: string, input: Record<string, unknown>): ToolResult {
  if (PROTECTED_PATHS.has(normalizePath(String(input.path ?? "")))) {
    return { ok: false, message: "Den filen er beskyttet og kan ikke endres." };
  }
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

/**
 * Rebuilds the whole project from the template, every finished tool call in the chat and the
 * user's own code edits, each applied at the point in the conversation where it happened.
 */
export function deriveFiles(messages: UIMessage[], edits: UserEdit[] = []): FileMap {
  const files: FileMap = { ...TEMPLATE };
  const applyEdits = (match: (at: number) => boolean) => {
    for (const edit of edits) {
      const path = normalizePath(edit.path);
      // The instructions and the list of added files are the protected files that the owner's own edits may set.
      if (match(edit.at) && (!PROTECTED_PATHS.has(path) || path === KNOWLEDGE_PATH || path === UPLOADS_PATH)) files[path] = edit.content;
    }
  };
  messages.forEach((message, index) => {
    applyEdits((at) => at === index);
    if (message.role !== "assistant") return;
    for (const raw of message.parts) {
      const part = raw as AnyPart;
      if (!part.type.startsWith("tool-") || part.state !== "output-available" || part.output?.ok === false) continue;
      applyTool(files, part.type.slice(5), part.input ?? {});
    }
  });
  applyEdits((at) => at >= messages.length);
  return files;
}
