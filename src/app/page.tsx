import { ImportZip } from "@/components/ImportZip";
import { LogOutButton } from "@/components/LogOutButton";
import { Logo } from "@/components/Logo";
import { ProjectGrid } from "@/components/ProjectGrid";
import { PromptBox } from "@/components/PromptBox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UsageMeter } from "@/components/UsageMeter";

export default function Home() {
  return (
    <div className="ambient min-h-dvh">
      <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <div className="flex items-center gap-1">
          <UsageMeter />
          <ThemeToggle />
          <LogOutButton />
        </div>
      </header>

      <main className="px-4">
        <section className="mx-auto max-w-3xl pt-16 text-center sm:pt-24">
          <p className="mx-auto mb-5 w-fit rounded-full border border-line bg-surface/60 px-3.5 py-1 text-[12.5px] text-muted backdrop-blur">
            Bygg apper ved å snakke
          </p>
          <h1 className="text-balance text-[40px] font-semibold leading-[1.05] tracking-tight sm:text-[64px]">
            Hva vil du <span className="text-brand">bygge</span> i dag?
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-pretty text-[16px] leading-relaxed text-muted sm:text-[18px]">
            Beskriv det med dine egne ord. Pivolar skriver koden, og du ser resultatet vokse frem ved siden av samtalen.
          </p>
        </section>

        <div className="mt-10">
          <PromptBox />
        </div>
        <div className="mt-5 flex justify-center">
          <ImportZip />
        </div>
      </main>

      <ProjectGrid />
    </div>
  );
}
