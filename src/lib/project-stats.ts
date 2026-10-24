import type { UIMessage } from "ai";
import type { FileMap, UserEdit } from "./files.ts";

/** What the project panel shows about the work so far. Counted from the conversation, never from the model. */
export type ProjectStats = { messages: number; aiEdits: number; ownEdits: number; files: number };

const EDIT_TOOLS = new Set(["tool-writeFile", "tool-editFile", "tool-deleteFile"]);

export function projectStats(messages: UIMessage[], edits: UserEdit[], files: FileMap): ProjectStats {
  let aiEdits = 0;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      const tool = part as { type: string; state?: string; output?: { ok?: boolean } };
      if (EDIT_TOOLS.has(tool.type) && tool.state === "output-available" && tool.output?.ok !== false) aiEdits++;
    }
  }
  return { messages: messages.filter((m) => m.role === "user").length, aiEdits, ownEdits: edits.length, files: Object.keys(files).length };
}

/** Where a project came from, in words. */
export function originLabel(info: { source?: string; fileName?: string; github?: { owner: string; repo: string }; cms?: { url: string } } | null): string {
  if (!info) return "Bygget i Pivolar";
  if (info.source === "github" && info.github) return `Importert fra GitHub: ${info.github.owner}/${info.github.repo}`;
  if (info.source === "cms") return `Importert nettsted: ${info.cms?.url ?? info.fileName ?? ""}`;
  if (info.source === "zip") return `Importert fra ZIP${info.fileName ? `: ${info.fileName}` : ""}`;
  return "Importert";
}
