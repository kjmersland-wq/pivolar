"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FileMap } from "@/lib/files";

/** A plain HTML site: an index.html, no package.json and not a Pivolar-native project. */
export const isStaticSite = (files: FileMap) => "/index.html" in files && !("/package.json" in files) && !("/App.tsx" in files);

const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";

/** Resolves a relative reference from the page at `from`; returns null for absolute URLs and data URIs. */
function resolve(from: string, ref: string): string | null {
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
  const clean = ref.split(/[?#]/)[0] ?? "";
  const parts = (clean.startsWith("/") ? clean : `${dirOf(from)}/${clean}`).split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return `/${out.join("/")}`;
}

/** Builds one self-contained document: local stylesheets and scripts are inlined, since the iframe has no server. */
export function buildStaticDocument(files: FileMap, page = "/index.html", rawBase?: string): string {
  let html = files[page] ?? "";
  html = html.replace(/<link\b[^>]*>/gi, (tag) => {
    if (!/rel\s*=\s*["']?stylesheet/i.test(tag)) return tag;
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1];
    const path = href ? resolve(page, href) : null;
    return path && path in files ? `<style>${files[path]}</style>` : tag;
  });
  html = html.replace(/<script\b([^>]*)\bsrc\s*=\s*["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (tag, before: string, src: string, after: string) => {
    const path = resolve(page, src);
    if (!path || !(path in files)) return tag;
    const type = /type\s*=\s*["']module["']/i.test(before + after) ? ' type="module"' : "";
    return `<script${type}>${files[path]!.replace(/<\/script/gi, "<\\/script")}</script>`;
  });
  // Files that were not imported (images, large data files) are fetched from the repository itself,
  // pinned to the imported commit, so the page loads what the original loads. Root-absolute paths
  // ("/tenders.json") are what static sites use, so they are mapped there; page links go to the parent.
  if (rawBase) {
    html = html.replace(/<(img|source|video|audio|link)\b[^>]*>/gi, (tag) => tag.replace(/\b(src|poster|href)=(["'])\/(?!\/)/gi, `$1=$2${rawBase}`));
    const head = `<script>(function(){var B=${JSON.stringify(rawBase)};var f=window.fetch;window.fetch=function(u,o){if(typeof u==="string"&&/^\/(?!\/)/.test(u))u=B+u.slice(1);return f.call(this,u,o)};document.addEventListener("click",function(e){var a=e.target&&e.target.closest&&e.target.closest("a[href]");if(!a)return;var h=a.getAttribute("href")||"";if(h.charAt(0)==="#"){e.preventDefault();var t=document.getElementById(h.slice(1));if(t)t.scrollIntoView({behavior:"smooth"});return}if(/^\/(?!\/)/.test(h)){e.preventDefault();parent.postMessage({type:"static:nav",path:h},"*")}})})()</script>`;
    html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, (m) => `${m}${head}`) : `${head}${html}`;
  }
  return html;
}

/** Shows a static HTML project in an iframe over the preview. Local CSS and scripts are inlined; files that were not imported (large data, images) load from GitHub. */
export function StaticPreview({ files, github }: { files: FileMap; github: { owner: string; repo: string; sha: string } | null }) {
  const [page, setPage] = useState("/index.html");
  const frame = useRef<HTMLIFrameElement>(null);
  const rawBase = github ? `https://raw.githubusercontent.com/${github.owner}/${github.repo}/${github.sha}/` : undefined;
  const current = page in files ? page : "/index.html";
  const doc = useMemo(() => buildStaticDocument(files, current, rawBase), [files, current, rawBase]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== "static:nav" || typeof event.data.path !== "string") return;
      const path = (event.data.path.split(/[?#]/)[0] ?? "") as string;
      const target = path.endsWith("/") ? `${path}index.html` : path;
      if (target in files) setPage(target);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [files]);

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-bg-soft">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5 text-[12px] text-muted">
        <span>Statisk HTML-side{current !== "/index.html" ? ` · ${current}` : ""}. Filer som ikke ble importert (bilder, store datafiler) hentes direkte fra GitHub.</span>
        {current !== "/index.html" && (
          <button type="button" onClick={() => setPage("/index.html")} className="rounded-md px-2 py-1 transition hover:bg-surface-2 hover:text-fg">
            Til forsiden
          </button>
        )}
      </div>
      <iframe ref={frame} title="Forhåndsvisning" srcDoc={doc} sandbox="allow-scripts allow-forms allow-popups allow-modals" className="min-h-0 w-full flex-1 border-0 bg-white" />
    </div>
  );
}
