"use client";

import { useEffect, useState } from "react";
import { validThumb } from "./thumb-check";

/**
 * Small pictures of each project's opening screen, kept in this browser (IndexedDB, since local
 * storage is too small for pictures). They are a convenience: every call can fail quietly, and the
 * project list falls back to a colour when there is no picture.
 */

const DB_NAME = "pivolar-thumbs";
const STORE = "thumbs";
const EVENT = "pivolar:thumb";

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const request = work(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    } finally {
      window.setTimeout(() => db.close(), 0);
    }
  });
}

export async function saveThumb(id: string, dataUrl: unknown): Promise<boolean> {
  if (!validThumb(dataUrl)) return false;
  await run("readwrite", (store) => store.put(dataUrl, id));
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
  return true;
}

export async function loadThumb(id: string): Promise<string | null> {
  const value = await run<unknown>("readonly", (store) => store.get(id));
  return validThumb(value) ? value : null;
}

export async function dropThumb(id: string): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

/** The picture of a project, or null. Follows new pictures as the preview makes them. */
export function useThumb(id: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const read = () => void loadThumb(id).then((value) => !cancelled && setUrl(value));
    read();
    const onThumb = (event: Event) => (event as CustomEvent<string>).detail === id && read();
    window.addEventListener(EVENT, onThumb);
    return () => {
      cancelled = true;
      window.removeEventListener(EVENT, onThumb);
    };
  }, [id]);
  return url;
}
