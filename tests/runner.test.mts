import assert from "node:assert/strict";
import { TEMPLATE } from "../src/lib/files.ts";
import { strToU8, zipSync } from "fflate";
import { ARCHIVE_LIMITS, archiveFiles } from "../src/lib/runner/archive.ts";
import { devCommand, DIR, parseEnv, projectFiles, startProject, syncProject, type RunEvent, type SandboxLike } from "../src/lib/runner/run.ts";

const pkg = (dev: string) => JSON.stringify({ scripts: { dev } });

// --- dev commands
assert.deepEqual(devCommand({ "/package.json": pkg("vite dev") })!.args, ["run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]);
assert.deepEqual(devCommand({ "/package.json": pkg("next dev --webpack") })!.args, ["run", "dev", "--", "-H", "0.0.0.0", "-p", "3000"]);
assert.deepEqual(devCommand({ "/package.json": pkg("node server.js") })!.args, ["run", "dev"]);
assert.equal(devCommand({ "/package.json": pkg("node server.js") })!.env.PORT, "3000");
assert.equal(devCommand({ "/package.json": JSON.stringify({ scripts: {} }) }), null);
assert.equal(devCommand({ "/package.json": "{ broken" }), null);
assert.equal(devCommand({}), null);

// --- env text
assert.deepEqual(parseEnv('VITE_URL=https://x.supabase.co\nexport KEY="quoted value"\n# comment\n\nBAD LINE\nEMPTY=\nSPACED = a b '), { VITE_URL: "https://x.supabase.co", KEY: "quoted value", EMPTY: "", SPACED: "a b" });

// --- which files go to the sandbox
{
  const files = { ...TEMPLATE, "/package.json": pkg("vite dev"), "/src/App.tsx": "x" };
  assert.deepEqual(Object.keys(projectFiles(files)).sort(), ["/package.json", "/src/App.tsx"], "the starter template and Pivolar's entry files stay out");
}

// --- a fake sandbox
function fake(opts: { up?: () => boolean; installExit?: number } = {}) {
  const log: { cmd: string; args?: string[]; env?: Record<string, string>; detached?: boolean; cwd?: string }[] = [];
  const written: Record<string, string> = {};
  let started = false;
  const sandbox: SandboxLike = {
    domain: (port) => `https://sb-${port}.vercel.run`,
    writeFiles: async (list) => void list.forEach((f) => (written[f.path] = f.content.toString("utf8"))),
    runCommand: async (p) => {
      log.push(p);
      let out = "";
      let exit = 0;
      if (p.cmd === "bash") out = (opts.up ? opts.up() : started) ? "200" : "000";
      if (p.cmd === "npm" && p.args?.[0] === "install") exit = opts.installExit ?? 0;
      if (p.detached) started = true;
      return { exitCode: exit, stdout: async () => out, stderr: async () => (exit ? "npm ERR! boom\n".repeat(30) : "") };
    },
  };
  return { sandbox, log, written };
}
const collect = async (g: AsyncGenerator<RunEvent>) => {
  const out: RunEvent[] = [];
  for await (const e of g) out.push(e);
  return out;
};
const fast = { tries: 3, delay: 1 };

// --- a fresh start: write, install, start, wait, ready
{
  const { sandbox, log, written } = fake();
  const files = { ...TEMPLATE, "/package.json": pkg("vite dev"), "/src/App.tsx": "hello" };
  const events = await collect(startProject(sandbox, files, { VITE_URL: "u" }, fast));
  assert.deepEqual(events.map((e) => e.step + ("status" in e ? `:${e.status}` : "")), ["files", "install:running", "install:done", "start", "ready"]);
  assert.equal((events.at(-1) as { url: string }).url, "https://sb-3000.vercel.run");
  assert.equal(written[`${DIR}/src/App.tsx`], "hello");
  assert.ok(!(`${DIR}/index.tsx` in written), "Pivolar's own entry file is not sent");
  const dev = log.find((l) => l.detached)!;
  assert.equal(dev.cwd, DIR);
  assert.equal(dev.env!.VITE_URL, "u");
  assert.equal(dev.env!.__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS, "sb-3000.vercel.run", "Vite is told to accept the sandbox address");
  assert.ok(log.findIndex((l) => l.args?.[0] === "install") < log.findIndex((l) => l.detached), "install comes before start");
}

// --- already serving: only the files are updated
{
  const { sandbox, log } = fake({ up: () => true });
  const events = await collect(startProject(sandbox, { "/package.json": pkg("vite dev"), "/src/App.tsx": "new" }, {}, fast));
  assert.deepEqual(events.map((e) => e.step), ["files", "ready"]);
  assert.ok(!log.some((l) => l.args?.[0] === "install" || l.detached), "no reinstall and no second server");
}

// --- failures say what happened
{
  const bad = await collect(startProject(fake({ installExit: 1 }).sandbox, { "/package.json": pkg("vite dev") }, {}, fast));
  const err = bad.at(-1) as { step: string; message: string };
  assert.equal(err.step, "error");
  assert.match(err.message, /Installasjonen feilet/);
  assert.ok(err.message.split("\n").length <= 14, "only the end of the log is shown");
  const never = await collect(startProject(fake({ up: () => false }).sandbox, { "/package.json": pkg("vite dev") }, {}, fast));
  assert.match((never.at(-1) as { message: string }).message, /startet ikke/);
  const nodev = await collect(startProject(fake().sandbox, { "/package.json": JSON.stringify({}) }, {}, fast));
  assert.match((nodev[0] as { message: string }).message, /dev/);
}

// --- sync
{
  const { sandbox, log, written } = fake();
  await syncProject(sandbox, { "/src/A.tsx": "a" }, ["/src/gone.ts"]);
  assert.equal(written[`${DIR}/src/A.tsx`], "a");
  assert.deepEqual(log.find((l) => l.cmd === "rm")!.args, ["-f", `${DIR}/src/gone.ts`]);
  const quiet = fake();
  await syncProject(quiet.sandbox, {}, []);
  assert.equal(quiet.log.length, 0);
}

// --- the repository archive: binaries included, one wrapper folder removed, unsafe paths dropped
{
  const png = new Uint8Array([137, 80, 78, 71, 0, 1, 2, 255]);
  const zip = zipSync({
    "o-r-abc123/package.json": strToU8("{}"),
    "o-r-abc123/src/logo.png": png,
    "o-r-abc123/node_modules/x/index.js": strToU8("no"),
    "o-r-abc123/data/big.json": strToU8("[1,2,3]"),
  });
  const out = archiveFiles(zip);
  assert.deepEqual(Object.keys(out).sort(), ["/data/big.json", "/package.json", "/src/logo.png"]);
  assert.deepEqual([...out["/src/logo.png"]!], [...png], "binary files are intact");
  assert.throws(() => archiveFiles(zipSync({ "a/big.bin": new Uint8Array(ARCHIVE_LIMITS.bytes + 1) })), /for stort/);
  assert.deepEqual(Object.keys(archiveFiles(zipSync({ "a/../../evil.txt": strToU8("x"), "a/ok.txt": strToU8("y") }))), ["/ok.txt"], "paths that leave the folder are dropped");
}

// --- the repository goes in first and Pivolar's text versions win
{
  const { sandbox, written } = fake();
  const base = { "/src/logo.png": Buffer.from([1, 2, 3]), "/src/App.tsx": Buffer.from("original") };
  const events = await collect(startProject(sandbox, { "/package.json": pkg("vite dev"), "/src/App.tsx": "edited in Pivolar" }, {}, fast, base));
  assert.equal(events.at(-1)!.step, "ready");
  assert.deepEqual([...Buffer.from(written[`${DIR}/src/logo.png`]!, "utf8")].length > 0, true, "the image is written");
  assert.equal(written[`${DIR}/src/App.tsx`], "edited in Pivolar", "the edited file replaces the repository's version");
}

console.log("runner: all ok");
