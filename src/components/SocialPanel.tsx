"use client";

import { useMemo, useState } from "react";
import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import { shareLinks, socialPosts, SHARE_BUTTONS_REQUEST } from "@/lib/checks/social";
import type { FileMap } from "@/lib/files";
import { readBrand } from "@/lib/publish/brand";
import { cn } from "@/lib/utils";

const URL_KEY = "atelier:siteurl";

function readUrl(): string {
  try {
    return window.localStorage.getItem(URL_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Ready-to-post texts per platform, share links and a prompt for share buttons on the site. */
export function SocialPanel({ files, busy, onFix }: { files: FileMap; busy: boolean; onFix: (text: string) => void }) {
  const [url, setUrl] = useState(readUrl);
  const [copied, setCopied] = useState("");
  const brand = useMemo(() => readBrand(files, "Appen"), [files]);
  const posts = useMemo(() => socialPosts(brand, url), [brand, url]);
  const links = useMemo(() => (url.trim() ? shareLinks(/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`, brand.name) : []), [url, brand.name]);

  function changeUrl(value: string) {
    setUrl(value);
    try {
      window.localStorage.setItem(URL_KEY, value);
    } catch {
      /* the address just is not remembered */
    }
  }

  async function copy(platform: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(platform);
      window.setTimeout(() => setCopied(""), 1600);
    } catch {
      /* clipboard blocked: the text can still be selected by hand */
    }
  }

  return (
    <div className="space-y-3">
      <label className="block text-[12.5px] text-muted">
        Adressen til siden din
        <input
          value={url}
          onChange={(e) => changeUrl(e.target.value)}
          placeholder="minside.vercel.app"
          className="mt-1 w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-[14px] text-fg outline-none transition focus:border-line-strong"
        />
        <span className="mt-1 block text-faint">Lenken i hvert innlegg får merking (utm) så du ser i statistikken hvor besøkene kom fra.</span>
      </label>

      {posts.map((post) => (
        <div key={post.platform} className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-[13.5px] font-medium">{post.label}</p>
            <div className="flex items-center gap-2">
              <span className={cn("text-[11.5px] tabular-nums", post.text.length > post.limit ? "text-red-400" : "text-faint")}>
                {post.text.length}/{post.limit}
              </span>
              <button type="button" onClick={() => void copy(post.platform, post.text)} className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition hover:border-line-strong">
                {copied === post.platform ? <Check className="size-3.5 text-emerald-400" /> : <Copy className="size-3.5" />}
                {copied === post.platform ? "Kopiert" : "Kopier"}
              </button>
            </div>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-[12.5px] text-muted">{post.text}</p>
        </div>
      ))}

      {links.length > 0 && (
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <p className="text-[13.5px] font-medium">Del siden</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {links.map((link) => (
              <a key={link.label} href={link.href} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition hover:border-line-strong">
                {link.label}
                <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border border-line bg-surface-2 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[13.5px] font-medium">Delingsknapper på siden</p>
            <p className="mt-0.5 text-[12.5px] text-muted">Besøkende kan dele siden med ett trykk. Bare vanlige lenker, ingen skript fra plattformene.</p>
          </div>
          <button type="button" disabled={busy} onClick={() => onFix(SHARE_BUTTONS_REQUEST)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] transition enabled:hover:border-line-strong disabled:opacity-50">
            <Share2 className="size-3.5" />
            Legg til
          </button>
        </div>
      </div>
    </div>
  );
}
