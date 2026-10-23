"use client";

/**
 * Messages the owner chose to keep when the budget was used up. They stay in this browser, per
 * project, until sent or deleted. Pictures are not kept, only the text.
 */
export type QueuedMessage = { id: string; text: string; at: number; hadAttachments: boolean };

const key = (projectId: string) => `atelier:queued:${projectId}`;

export function loadQueued(projectId: string): QueuedMessage[] {
  try {
    const raw = window.localStorage.getItem(key(projectId));
    const parsed = raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(projectId: string, list: QueuedMessage[]) {
  try {
    if (list.length === 0) window.localStorage.removeItem(key(projectId));
    else window.localStorage.setItem(key(projectId), JSON.stringify(list));
  } catch {
    /* storage full or unavailable */
  }
}

export function addQueued(projectId: string, text: string, hadAttachments: boolean): QueuedMessage[] {
  const next = [...loadQueued(projectId), { id: crypto.randomUUID(), text, at: Date.now(), hadAttachments }];
  save(projectId, next);
  return next;
}

export function removeQueued(projectId: string, id: string): QueuedMessage[] {
  const next = loadQueued(projectId).filter((item) => item.id !== id);
  save(projectId, next);
  return next;
}
