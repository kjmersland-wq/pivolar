"use client";

import { useSyncExternalStore } from "react";
import type { UIMessage } from "ai";
import type { UserEdit } from "@/lib/files";

/**
 * Projects are worked on in this browser (fast, works offline) and mirrored to the account in the
 * background by `sync.ts`. `rev` counts local changes, `syncedRev` is the revision last sent and
 * `remoteAt` is the server's timestamp from that send, so neither side depends on clocks agreeing.
 */
export type ProjectMeta = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  framework?: string;
  rev?: number;
  syncedRev?: number;
  remoteAt?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Projects with a UUID id can live on the account. Older ones (`p_…`) are moved by an explicit step. */
export const isAccountId = (id: string) => UUID.test(id);

type ChangeKind = "save" | "delete";
const listeners = new Set<(id: string, kind: ChangeKind) => void>();
export function subscribeChanges(listener: (id: string, kind: ChangeKind) => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
function emit(id: string, kind: ChangeKind) {
  for (const listener of listeners) listener(id, kind);
}

const LIST_KEY = "atelier:projects:v1";
const EVENT = "atelier:projects-changed";
const msgKey = (id: string) => `atelier:msgs:${id}`;
const editsKey = (id: string) => `atelier:edits:${id}`;
const publishKey = (id: string) => `atelier:publish:${id}`;
const importKey = (id: string) => `atelier:import:${id}`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable: the session still works, it just will not persist */
  }
}

let cachedRaw: string | null = null;
let cachedList: ProjectMeta[] = [];

function snapshot(): ProjectMeta[] {
  const raw = window.localStorage.getItem(LIST_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedList = raw ? (JSON.parse(raw) as ProjectMeta[]) : [];
    } catch {
      cachedList = [];
    }
  }
  return cachedList;
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

const EMPTY: ProjectMeta[] = [];

/** All projects, newest first. Returns an empty list on the server. */
export function useProjects(): ProjectMeta[] {
  const list = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
}

function saveList(list: ProjectMeta[]) {
  write(LIST_KEY, list);
  window.dispatchEvent(new Event(EVENT));
}

/** Marks a project as changed locally, so the sync layer knows there is something to send. */
function bump(id: string, patch: Partial<ProjectMeta> = {}) {
  const list = read<ProjectMeta[]>(LIST_KEY, []);
  if (!list.some((p) => p.id === id)) return;
  saveList(list.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now(), rev: (p.rev ?? 0) + 1 } : p)));
  emit(id, "save");
}

export function createProject(name = "Nytt prosjekt"): ProjectMeta {
  const project: ProjectMeta = { id: crypto.randomUUID(), name, createdAt: Date.now(), updatedAt: Date.now(), rev: 1 };
  saveList([project, ...read<ProjectMeta[]>(LIST_KEY, [])]);
  emit(project.id, "save");
  return project;
}

/**
 * A copy of a project: the conversation, the edits and where it came from. Publishing details are not
 * copied, so the copy cannot overwrite the original's repository or site.
 */
export function duplicateProject(id: string): ProjectMeta | null {
  const source = getProject(id);
  if (!source) return null;
  const copy = createProject(`${source.name} (kopi)`);
  const info = read<ImportInfo | null>(importKey(id), null);
  write(msgKey(copy.id), read<UIMessage[]>(msgKey(id), []));
  write(editsKey(copy.id), read<UserEdit[]>(editsKey(id), []));
  if (info) write(importKey(copy.id), info);
  bump(copy.id, source.framework ? { framework: source.framework } : {});
  return copy;
}

export function getProject(id: string): ProjectMeta | undefined {
  return read<ProjectMeta[]>(LIST_KEY, []).find((p) => p.id === id);
}

export function updateProject(id: string, patch: Partial<Pick<ProjectMeta, "name">>) {
  bump(id, patch);
}

export function deleteProject(id: string) {
  removeLocal(id);
  emit(id, "delete");
}

/** Removes a project from this browser only. Deleting from the account is `sync.ts`'s job. */
export function removeLocal(id: string) {
  saveList(read<ProjectMeta[]>(LIST_KEY, []).filter((p) => p.id !== id));
  try {
    window.localStorage.removeItem(msgKey(id));
    window.localStorage.removeItem(editsKey(id));
    window.localStorage.removeItem(publishKey(id));
    window.localStorage.removeItem(importKey(id));
  } catch {
    /* ignore */
  }
}

/** The prompt typed on the home page waits here until the new project's chat has taken it. */
export function setPendingPrompt(id: string, text: string) {
  try {
    window.sessionStorage.setItem(`atelier:pending:${id}`, text);
  } catch {
    /* ignore */
  }
}

/** Returns the waiting prompt once and removes it, so it can never be sent twice. */
export function takePendingPrompt(id: string): string | null {
  try {
    const key = `atelier:pending:${id}`;
    const text = window.sessionStorage.getItem(key);
    if (text !== null) window.sessionStorage.removeItem(key);
    return text;
  } catch {
    return null;
  }
}

export function loadMessages(id: string): UIMessage[] {
  return read<UIMessage[]>(msgKey(id), []);
}

/**
 * Pictures are large (base64) and localStorage is small, so saved chats keep only a marker where an
 * image was. The current session still shows the real picture.
 */
function withoutImageData(messages: UIMessage[]): UIMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) =>
      part.type === "file" && part.url.startsWith("data:") ? { ...part, url: "" } : part,
    ),
  })) as UIMessage[];
}

/** Where a project was last published, so publishing again updates the same repo and site. */
export type PublishInfo = { name: string; githubUrl?: string; liveUrl?: string; at: number };

export function loadPublish(id: string): PublishInfo | null {
  return read<PublishInfo | null>(publishKey(id), null);
}

export function savePublish(id: string, info: PublishInfo) {
  write(publishKey(id), info);
  bump(id);
}

export function loadEdits(id: string): UserEdit[] {
  return read<UserEdit[]>(editsKey(id), []);
}

export function saveEdits(id: string, edits: UserEdit[]) {
  write(editsKey(id), edits);
  bump(id);
}

export function saveMessages(id: string, messages: UIMessage[]) {
  write(msgKey(id), withoutImageData(messages));
  bump(id);
}

/** What is known about a project that came from outside, kept for the export manifest. */
export type ImportInfo = {
  source: "zip" | "github" | "cms";
  fileName: string;
  at: number;
  skippedBinaries: string[];
  omittedSecrets: string[];
  /** Where a GitHub import came from, so changes can be sent back to the same repository. */
  github?: { owner: string; repo: string; branch: string; sha: string; private: boolean; url: string };
  /** Where a website import came from. The job holds the model and the pictures. */
  cms?: { url: string; job: string; pages: number; images: number };
};

export function loadImportInfo(id: string): ImportInfo | null {
  return read<ImportInfo | null>(importKey(id), null);
}

/**
 * Creates a project from imported files. Unlike the other writes this one reports failure, because
 * browser storage is small and a half-saved import would silently lose files.
 */
export function importProject(name: string, files: Record<string, string>, info: ImportInfo, framework: string): { ok: true; project: ProjectMeta } | { ok: false; error: string } {
  const project: ProjectMeta = { id: crypto.randomUUID(), name, createdAt: Date.now(), updatedAt: Date.now(), framework, rev: 1 };
  const edits: UserEdit[] = Object.entries(files).map(([path, content]) => ({ at: 0, path, content }));
  try {
    window.localStorage.setItem(editsKey(project.id), JSON.stringify(edits));
    window.localStorage.setItem(importKey(project.id), JSON.stringify(info));
  } catch {
    try {
      window.localStorage.removeItem(editsKey(project.id));
      window.localStorage.removeItem(importKey(project.id));
    } catch {
      /* ignore */
    }
    return { ok: false, error: "Nettleserlagringen er full. Slett et gammelt prosjekt og prøv igjen." };
  }
  saveList([project, ...read<ProjectMeta[]>(LIST_KEY, [])]);
  emit(project.id, "save");
  return { ok: true, project };
}

/** Everything a project consists of, as it is sent to the account. */
export type ProjectState = { messages: UIMessage[]; edits: UserEdit[]; publish: PublishInfo | null; importInfo: ImportInfo | null };

export function listLocal(): ProjectMeta[] {
  return read<ProjectMeta[]>(LIST_KEY, []);
}

export function readState(id: string): ProjectState {
  return {
    messages: read<UIMessage[]>(msgKey(id), []),
    edits: read<UserEdit[]>(editsKey(id), []),
    publish: read<PublishInfo | null>(publishKey(id), null),
    importInfo: read<ImportInfo | null>(importKey(id), null),
  };
}

/** Stores a project fetched from the account. Does not count as a local change. */
export function applyRemote(meta: ProjectMeta, state: ProjectState) {
  write(msgKey(meta.id), state.messages);
  write(editsKey(meta.id), state.edits);
  if (state.publish) write(publishKey(meta.id), state.publish);
  if (state.importInfo) write(importKey(meta.id), state.importInfo);
  const rest = listLocal().filter((p) => p.id !== meta.id);
  saveList([meta, ...rest]);
}

/** Records that `rev` reached the account. Does not count as a local change. */
export function markSynced(id: string, syncedRev: number, remoteAt: number) {
  saveList(listLocal().map((p) => (p.id === id ? { ...p, syncedRev, remoteAt } : p)));
}

/** Gives an older project (`p_…` id) a UUID so it can live on the account. Returns the new id. */
export function renameLocal(oldId: string, newId: string) {
  const state = readState(oldId);
  write(msgKey(newId), state.messages);
  write(editsKey(newId), state.edits);
  if (state.publish) write(publishKey(newId), state.publish);
  if (state.importInfo) write(importKey(newId), state.importInfo);
  const list = listLocal().map((p) => (p.id === oldId ? { ...p, id: newId } : p));
  saveList(list);
  try {
    for (const key of [msgKey(oldId), editsKey(oldId), publishKey(oldId), importKey(oldId)]) window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}
