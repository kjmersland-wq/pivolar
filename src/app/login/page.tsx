import { LoginForm } from "@/components/LoginForm";
import { LogoMark } from "@/components/Logo";
import { authConfigured } from "@/lib/auth";

export default function LoginPage() {
  return (
    <div className="ambient grid min-h-dvh place-items-center px-4">
      <div className="card w-full max-w-sm rounded-3xl p-8">
        <LogoMark className="size-11 rounded-2xl" />
        <h1 className="mt-6 text-[24px] font-semibold tracking-tight">Velkommen tilbake</h1>
        <p className="mt-1.5 text-[14px] text-muted">Logg inn for å åpne Atelier.</p>
        <LoginForm configured={authConfigured()} emailRequired={Boolean(process.env.APP_EMAIL)} />
      </div>
    </div>
  );
}
