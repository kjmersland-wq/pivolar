"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import type { UIMessage } from "ai";
import { RunnerPreview } from "@/components/RunnerPreview";
import { isStaticSite, StaticPreview } from "@/components/StaticPreview";
import { Sandbox } from "@/components/Preview";
import { deriveFiles, type UserEdit } from "@/lib/files";
import { getProject, loadEdits, loadImportInfo, loadMessages } from "@/lib/projects";
import { pullOne } from "@/lib/sync";

const noop = () => {};

/**
 * The project's preview alone in a browser tab, without the chat or the toolbar, so the page can be
 * seen the way a visitor sees it. It reads the same project as the workspace and follows it: while
 * the AI builds in the other tab, this one updates.
 */
export function FullPreview() {
  const { id } = useParams<{ id?: string }>();
  const [state, setState] = useState<{ messages: UIMessage[]; edits: UserEdit[]; name: string } | "missing" | null>(null);
  const github = useMemo(() => (id ? (loadImportInfo(id)?.github ?? null) : null), [id]);
  const measureRef = useRef<(() => Promise<never>) | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    const read = () => {
      const project = getProject(id);
      if (!project) return false;
      if (!cancelled) setState({ messages: loadMessages(id), edits: loadEdits(id), name: project.name });
      return true;
    };
    void (async () => {
      // A project made on another device is not in this browser yet; fetch it from the account first.
      if (!read()) {
        await pullOne(id);
        if (!read() && !cancelled) setState("missing");
      }
    })();
    // The workspace in the other tab saves as it works; the browser tells this tab when storage changed.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onStorage = () => {
      clearTimeout(timer);
      timer = setTimeout(read, 400);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      window.removeEventListener("storage", onStorage);
    };
  }, [id]);

  const files = useMemo(() => (state && state !== "missing" ? deriveFiles(state.messages, state.edits) : null), [state]);

  useEffect(() => {
    if (state && state !== "missing") document.title = state.name;
  }, [state]);

  if (!id || state === null || !files) {
    return (
      <div className="grid h-dvh place-items-center">
        <div className="shimmer h-3 w-40 rounded-full" />
      </div>
    );
  }
  if (state === "missing") {
    return (
      <div className="grid h-dvh place-items-center text-center">
        <div className="space-y-3">
          <p className="text-[15px] font-medium">Fant ikke prosjektet</p>
          <Link href="/" className="bg-brand inline-block rounded-xl px-4 py-2 text-[13px] font-medium text-white">
            Til forsiden
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="h-dvh">
      <Sandbox
        files={files}
        view="preview"
        device="desktop"
        busy={false}
        inspect={false}
        onFix={noop}
        onEdit={noop}
        onElement={noop}
        onInspectDone={noop}
        measureRef={measureRef}
        runner={isStaticSite(files) ? <StaticPreview files={files} github={github} /> : <RunnerPreview projectId={id} files={files} github={github} />}
      />
    </div>
  );
}
