"use client";

import { Archive, Send, Trash2 } from "lucide-react";
import type { QueuedMessage } from "@/lib/queued";

/** Messages kept for later because the budget was used up. Sending one goes through the budget check again. */
export function QueuedBar({ items, onSend, onDelete }: { items: QueuedMessage[]; onSend: (item: QueuedMessage) => void; onDelete: (item: QueuedMessage) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-line bg-amber-500/5 px-4 py-2">
      {items.map((item) => (
        <div key={item.id} className="flex items-center gap-3 py-1 text-[13px]">
          <Archive className="size-4 shrink-0 text-amber-400" />
          <span className="min-w-0 flex-1 truncate text-muted">
            <span className="text-fg">Lagret melding:</span> {item.text}
          </span>
          <button type="button" onClick={() => onSend(item)} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2.5 py-1 text-[12.5px] transition hover:border-line-strong">
            <Send className="size-3.5" />
            Send nå
          </button>
          <button type="button" onClick={() => onDelete(item)} className="grid size-7 shrink-0 place-items-center rounded-lg text-muted transition hover:text-red-400" aria-label="Slett lagret melding" title="Slett">
            <Trash2 className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
