"use client";

import { useSyncExternalStore } from "react";
import type { UIMessage } from "ai";
import { uid } from "@/lib/utils";
import type { UserEdit } from "@/lib/files";

/** Phase 1 keeps projects in this browser. The shape is ready to move to a database later. */
export type ProjectMeta = { id: string; name: string; createdAt: number; updatedAt: number };

const LIST_KEY = "atelier:projects:v1";
const EVENT = "atelier:projects-changed";
const msgKey = (id: string) => `atelier:msgs:${id}`;
const editsKey = (id: string) => `atelier:edits:${id}`;
const publishKey = (id: string) => `atelier:publish:${id}`;

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

export function createProject(name = "Nytt prosjekt"): ProjectMeta {
  const project: ProjectMeta = { id: uid("p"), name, createdAt: Date.now(), updatedAt: Date.now() };
  saveList([project, ...read<ProjectMeta[]>(LIST_KEY, [])]);
  return project;
}

export function getProject(id: string): ProjectMeta | undefined {
  return read<ProjectMeta[]>(LIST_KEY, []).find((p) => p.id === id);
}

export function updateProject(id: string, patch: Partial<Pick<ProjectMeta, "name">>) {
  saveList(read<ProjectMeta[]>(LIST_KEY, []).map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)));
}

export function deleteProject(id: string) {
  saveList(read<ProjectMeta[]>(LIST_KEY, []).filter((p) => p.id !== id));
  try {
    window.localStorage.removeItem(msgKey(id));
    window.localStorage.removeItem(editsKey(id));
    window.localStorage.removeItem(publishKey(id));
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
}

export function loadEdits(id: string): UserEdit[] {
  return read<UserEdit[]>(editsKey(id), []);
}

export function saveEdits(id: string, edits: UserEdit[]) {
  write(editsKey(id), edits);
}

export function saveMessages(id: string, messages: UIMessage[]) {
  write(msgKey(id), withoutImageData(messages));
  const list = read<ProjectMeta[]>(LIST_KEY, []);
  if (list.some((p) => p.id === id)) saveList(list.map((p) => (p.id === id ? { ...p, updatedAt: Date.now() } : p)));
}
