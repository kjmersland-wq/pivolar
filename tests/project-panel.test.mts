import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { UIMessage } from "ai";
import { originLabel, projectStats } from "../src/lib/project-stats.ts";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const user = (text: string): UIMessage => ({ id: text, role: "user", parts: [{ type: "text", text }] });
const tool = (type: string, state: string, ok = true) => ({ type, state, input: {}, output: { ok } });
const ai = (...parts: unknown[]): UIMessage => ({ id: "a" + Math.random(), role: "assistant", parts: parts as UIMessage["parts"] });

// --- what the panel counts
{
  const messages = [
    user("bygg en side"),
    ai({ type: "text", text: "Ok" }, tool("tool-writeFile", "output-available"), tool("tool-editFile", "output-available"), tool("tool-writeFile", "output-available", false), tool("tool-writeFile", "input-streaming"), tool("tool-searchImages", "output-available"), tool("tool-deleteFile", "output-available")),
    user("endre fargen"),
    ai(tool("tool-editFile", "output-available")),
  ];
  const stats = projectStats(messages, [{ at: 1, path: "/App.tsx", content: "x" }], { "/App.tsx": "a", "/styles.css": "b" });
  assert.deepEqual(stats, { messages: 2, aiEdits: 4, ownEdits: 1, files: 2 }, "only finished, successful file changes count, and only what the user wrote counts as messages");
  assert.deepEqual(projectStats([], [], {}), { messages: 0, aiEdits: 0, ownEdits: 0, files: 0 });
}

// --- where a project came from
assert.equal(originLabel(null), "Bygget i Pivolar");
assert.equal(originLabel({ source: "github", github: { owner: "kj", repo: "side" } }), "Importert fra GitHub: kj/side");
assert.equal(originLabel({ source: "cms", cms: { url: "https://old.no" } }), "Importert nettsted: https://old.no");
assert.equal(originLabel({ source: "zip", fileName: "a.zip" }), "Importert fra ZIP: a.zip");

// --- the panel, the button and the copy
{
  const panel = read("src/components/ProjectPanel.tsx");
  assert.equal((panel.match(/onClick=\{remove\}/g) ?? []).length, 1, "one button deletes");
  assert.match(panel, /\{confirmDelete \? \([\s\S]*?onClick=\{remove\}[\s\S]*?\) : \(\s*<button type="button" onClick=\{\(\) => setConfirmDelete\(true\)\}/, "and it only shows after the first click, which asks");
  assert.doesNotMatch(panel, /Object\.values\(values\)\.map|values\[[^\]]*\]\}<\//, "secret values are never shown");
  assert.match(panel, /Object\.values\(values\)\.filter\(Boolean\)\.length/, "only how many values there are");
  for (const target of ["analytics", "connectors", "check", "hosting", "export", "publish", "pr"]) assert.match(panel, new RegExp(`"${target}"`), `the menu reaches ${target}`);
  const workspace = read("src/components/Workspace.tsx");
  assert.match(workspace, /<ProjectPanel[\s\S]*onRename=/);
  assert.match(workspace, /setMoreOpen\(true\)/);
  const projects = read("src/lib/projects.ts");
  const copy = projects.slice(projects.indexOf("export function duplicateProject"), projects.indexOf("export function getProject"));
  assert.ok(copy.includes("msgKey(copy.id)") && copy.includes("editsKey(copy.id)") && copy.includes("importKey(copy.id)"));
  assert.doesNotMatch(copy, /publishKey|savePublish/, "the copy does not inherit the original's publishing");
}

console.log("project-panel: all ok");
