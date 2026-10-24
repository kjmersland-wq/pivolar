import { NextResponse } from "next/server";
import { checkPackages, packageFindings, readDependencies } from "@/lib/checks/deps";

export const maxDuration = 60;

/** Looks up the project's packages in OSV and answers with findings. The lookup runs here, so the browser needs no cross-origin access. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { packageJson?: unknown } | null;
  if (typeof body?.packageJson !== "string" || body.packageJson.length > 200_000) return NextResponse.json({ error: "Mangler package.json." }, { status: 400 });

  const { dependencies, skipped } = readDependencies({ "/package.json": body.packageJson });
  if (dependencies.length === 0) return NextResponse.json({ findings: [], checked: 0, skipped });
  try {
    const reports = await checkPackages(dependencies);
    return NextResponse.json({ findings: packageFindings(reports), checked: Math.min(dependencies.length, 400), skipped });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Pakkesjekken feilet." }, { status: 502 });
  }
}
