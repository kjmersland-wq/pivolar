import {
  applyRemote,
  isAccountId,
  listLocal,
  markSynced,
  readState,
  removeLocal,
  renameLocal,
  subscribeChanges,
  type ProjectMeta,
  type ProjectState,
} from "@/lib/projects";

/**
 * Mirrors the browser's projects to the signed-in account.
 * - A local change is sent a moment later (debounced); the newest local change wins.
 * - A project changed on another device is fetched when this browser has no unsent changes to it.
 * - Older projects (p_ ids) are only moved by migrateLegacy, which the user starts.
 */

const DEBOUNCE_MS = 1500;
const TOMBSTONES = "atelier:deleted-pending:v1";

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const inflight = new Set<string>();
const again = new Set<string>();

function readTombstones(): string[] {
  try {
    return JSON.parse(window.localStorage.getItem(TOMBSTONES) ?? "[]") as string[];
  } catch {
    return [];
  }
}
function writeTombstones(ids: string[]) {
  try {
    window.localStorage.setItem(TOMBSTONES, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

const isDirty = (p: ProjectMeta) => (p.rev ?? 0) !== (p.syncedRev ?? -1);

function payload(meta: ProjectMeta, state: ProjectState) {
  return {
    name: meta.name,
    framework: meta.framework ?? null,
    createdAt: meta.createdAt,
    messages: state.messages,
    edits: state.edits,
    publish: state.publish,
    importInfo: state.importInfo,
  };
}

type SendResult = { ok: true; updatedAt: number } | { ok: false; error?: string };

async function send(id: string, meta: ProjectMeta, state: ProjectState): Promise<SendResult> {
  try {
    const response = await fetch(`/api/sync/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload(meta, state)),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      return { ok: false, error: body.error };
    }
    return { ok: true, updatedAt: ((await response.json()) as { updatedAt: number }).updatedAt };
  } catch {
    return { ok: false };
  }
}

export async function pushProject(id: string): Promise<boolean> {
  if (!isAccountId(id)) return false;
  if (inflight.has(id)) {
    again.add(id);
    return false;
  }
  const meta = listLocal().find((p) => p.id === id);
  if (!meta) return false;
  inflight.add(id);
  try {
    const rev = meta.rev ?? 0;
    const sent = await send(id, meta, readState(id));
    if (!sent.ok) return false;
    markSynced(id, rev, sent.updatedAt);
    return true;
  } finally {
    inflight.delete(id);
    if (again.delete(id)) schedule(id);
  }
}

function schedule(id: string) {
  clearTimeout(timers.get(id));
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      void pushProject(id);
    }, DEBOUNCE_MS),
  );
}

async function deleteRemote(id: string) {
  try {
    const response = await fetch(`/api/sync/${id}`, { method: "DELETE" });
    if (response.ok || response.status === 404) writeTombstones(readTombstones().filter((t) => t !== id));
  } catch {
    /* stays in the list and is retried on the next pull */
  }
}

async function fetchState(id: string): Promise<ProjectState | null> {
  try {
    const response = await fetch(`/api/sync/${id}`);
    if (!response.ok) return null;
    return (await response.json()) as ProjectState;
  } catch {
    return null;
  }
}

type RemoteMeta = { id: string; name: string; framework?: string; createdAt: number; updatedAt: number };

async function fetchList(): Promise<RemoteMeta[] | null> {
  try {
    const response = await fetch("/api/sync");
    if (!response.ok) return null;
    return ((await response.json()) as { projects: RemoteMeta[] }).projects;
  } catch {
    return null;
  }
}

async function pullInto(remote: RemoteMeta): Promise<boolean> {
  const state = await fetchState(remote.id);
  if (!state) return false;
  const rev = listLocal().find((p) => p.id === remote.id)?.rev ?? 0;
  applyRemote(
    { id: remote.id, name: remote.name, framework: remote.framework, createdAt: remote.createdAt, updatedAt: remote.updatedAt, rev, syncedRev: rev, remoteAt: remote.updatedAt },
    state,
  );
  return true;
}

/** Brings this browser in line with the account, then sends anything still unsent. */
export async function pullAll() {
  for (const id of readTombstones()) await deleteRemote(id);
  const remote = await fetchList();
  if (!remote) return;
  const gone = new Set(readTombstones());
  const local = listLocal();

  for (const r of remote) {
    if (gone.has(r.id)) continue;
    const mine = local.find((p) => p.id === r.id);
    if (!mine || (mine.remoteAt !== r.updatedAt && !isDirty(mine))) await pullInto(r);
  }

  // Deleted on another device: it was synced here once and is no longer on the account.
  const onAccount = new Set(remote.map((r) => r.id));
  for (const mine of local) {
    if (isAccountId(mine.id) && mine.remoteAt !== undefined && !onAccount.has(mine.id) && !isDirty(mine)) removeLocal(mine.id);
  }

  for (const mine of listLocal()) if (isAccountId(mine.id) && isDirty(mine)) schedule(mine.id);
}

/** Opens a project this browser has not seen yet, for example one made on another device. */
export async function pullOne(id: string): Promise<boolean> {
  if (!isAccountId(id)) return false;
  const remote = await fetchList();
  const found = remote?.find((r) => r.id === id);
  return found ? pullInto(found) : false;
}

export function legacyProjects() {
  return listLocal().filter((p) => !isAccountId(p.id));
}

export type MigrateResult = { moved: number; failed: { name: string; reason: string }[] };

/**
 * The explicit "Flytt til konto" step. Each project is uploaded first and only renamed locally once
 * the account has it, so a failure never leaves a project half moved.
 */
export async function migrateLegacy(): Promise<MigrateResult> {
  const result: MigrateResult = { moved: 0, failed: [] };
  for (const project of legacyProjects()) {
    const newId = crypto.randomUUID();
    const sent = await send(newId, { ...project, id: newId }, readState(project.id));
    if (!sent.ok) {
      result.failed.push({ name: project.name, reason: sent.error ?? "Kunne ikke nå kontoen. Prøv igjen." });
      continue;
    }
    renameLocal(project.id, newId);
    markSynced(newId, project.rev ?? 0, sent.updatedAt);
    result.moved++;
  }
  return result;
}

/** Starts background syncing. Returns a function that stops it. */
export function startSync() {
  const stop = subscribeChanges((id, kind) => {
    if (!isAccountId(id)) return;
    if (kind === "delete") {
      clearTimeout(timers.get(id));
      timers.delete(id);
      writeTombstones([...new Set([...readTombstones(), id])]);
      void deleteRemote(id);
    } else {
      schedule(id);
    }
  });
  const onFocus = () => void pullAll();
  window.addEventListener("focus", onFocus);
  void pullAll();
  return () => {
    stop();
    window.removeEventListener("focus", onFocus);
  };
}
