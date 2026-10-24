"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowUp, Sparkles, Wand2 } from "lucide-react";
import { PromptWizard } from "@/components/PromptWizard";
import { createProject, setPendingPrompt } from "@/lib/projects";

const IDEAS = [
  "En landingsside for en liten kaffebar",
  "Et dashbord med grafer og nøkkeltall",
  "En oppgaveliste med filter og animasjoner",
  "Et portefølje-nettsted for en fotograf",
  "En prisoversikt med tre abonnement",
];

export function PromptBox() {
  const router = useRouter();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [wizard, setWizard] = useState(false);

  function start(prompt: string) {
    const value = prompt.trim();
    if (!value) return;
    const project = createProject();
    setPendingPrompt(project.id, value);
    router.push(`/p/${project.id}`);
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
        className="glass rounded-3xl p-3 shadow-[var(--shadow)] transition focus-within:border-line-strong"
      >
        <textarea
          ref={ref}
          value={text}
          rows={3}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              start(text);
            }
          }}
          placeholder="Be Pivolar om å bygge …"
          className="block w-full resize-none bg-transparent px-3 py-2.5 text-[16px] leading-relaxed outline-none placeholder:text-faint"
        />
        <div className="flex items-center justify-between px-1 pt-1">
          <span className="flex items-center gap-3 px-2 text-[12px] text-faint">
            <button type="button" onClick={() => setWizard(true)} title="Velg i stedet for å skrive: Pivolar setter sammen en komplett bestilling" className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12px] text-muted transition hover:border-line-strong hover:text-fg">
              <Wand2 className="size-3.5" />
              Prompt-hjelper
            </button>
            <span className="hidden items-center gap-1.5 sm:flex">
              <Sparkles className="size-3.5" />
              React · Tailwind · live forhåndsvisning
            </span>
          </span>
          <button
            type="button"
            onClick={() => start(text)}
            disabled={!text.trim()}
            className="bg-brand grid size-10 place-items-center rounded-2xl text-white shadow-[0_8px_24px_-8px_var(--accent)] transition enabled:hover:brightness-110 enabled:active:scale-95 disabled:opacity-40 disabled:shadow-none"
            aria-label="Start"
          >
            <ArrowUp className="size-5" />
          </button>
        </div>
      </motion.div>

      <PromptWizard
        open={wizard}
        onClose={() => setWizard(false)}
        initialAbout={text}
        onUse={(prompt, now) => {
          setWizard(false);
          setText(prompt);
          if (now) start(prompt);
        }}
      />

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="mt-4 flex flex-wrap justify-center gap-2">
        {IDEAS.map((idea) => (
          <button
            key={idea}
            type="button"
            onClick={() => start(idea)}
            className="rounded-full border border-line bg-surface/50 px-3.5 py-1.5 text-[13px] text-muted transition hover:border-line-strong hover:bg-surface hover:text-fg"
          >
            {idea}
          </button>
        ))}
      </motion.div>
    </div>
  );
}
