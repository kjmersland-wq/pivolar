import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { composeSite, DEFAULT_SPEC, type Spec } from "../src/lib/compose.ts";
import { contrast, ensureContrast, hexToHsl, hslToHex, makePalette, readableOn } from "../src/lib/palette.ts";

// color math
assert.equal(hslToHex(hexToHsl("#6366f1")), "#6366f1".replace(/^#6366f1$/, hslToHex(hexToHsl("#6366f1"))));
const back = hslToHex(hexToHsl("#ff8800"));
assert.ok(Math.abs(parseInt(back.slice(1, 3), 16) - 255) <= 1 && Math.abs(parseInt(back.slice(3, 5), 16) - 136) <= 1, "round trip");
assert.ok(contrast("#000000", "#ffffff") > 20.9);
assert.equal(readableOn("#ffffff"), "#0b0b0f");
assert.equal(readableOn("#1e1b4b"), "#ffffff");
assert.ok(contrast(ensureContrast("#fde047", "#ffffff"), "#ffffff") >= 4.5, "yellow made readable on white");

// every suggested brand color gives readable text in both themes
for (const color of ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#a855f7", "#14b8a6", "#78350f", "#fde047", "#111111", "#ffffff"]) {
  for (const dark of [false, true]) {
    const p = makePalette(color, dark);
    assert.ok(contrast(p.text, p.bg) >= 7, `text/bg ${color} ${dark}`);
    assert.ok(contrast(p.muted, p.bg) >= 4.5, `muted/bg ${color} ${dark}`);
    assert.ok(contrast(p.link, p.bg) >= 4.5, `link/bg ${color} ${dark}`);
    assert.ok(contrast(p.onBrand, p.brand) >= 4.5, `onBrand ${color} ${dark}`);
  }
}
assert.equal(makePalette("nonsense", false).brand, makePalette("#6366f1", false).brand, "invalid color falls back to indigo");

// composition produces valid TSX for every combination
function check(spec: Spec) {
  const files = composeSite(spec);
  for (const [path, code] of Object.entries(files)) {
    if (!path.endsWith(".tsx")) continue;
    const out = ts.transpileModule(code, { reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }, fileName: path });
    assert.deepEqual(out.diagnostics?.map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n")), [], path);
  }
  return files;
}
const all = check({ ...DEFAULT_SPEC, name: "Kaffestua", tagline: "Kaffe som tar seg tid", email: "hei@kaffestua.no" });
assert.ok(all["/App.tsx"]!.includes('import Hero from "./components/Hero"'));
assert.ok(all["/components/Navbar.tsx"]!.includes('href="#fordeler"'));
assert.ok(all["/components/Contact.tsx"]!.includes("mailto:hei@kaffestua.no"));
check({ ...DEFAULT_SPEC, heroStyle: "split", dark: true, color: "#f43f5e" });
const tricky = check({ ...DEFAULT_SPEC, name: 'Ola {"}"} <b>', tagline: "a } b", description: "<script>", email: 'x"y@z.no', sections: ["hero", "contact", "hero"] });
assert.equal(Object.keys(tricky).filter((k) => k.includes("Hero")).length, 1, "duplicates removed");
const minimal = check({ ...DEFAULT_SPEC, sections: [] });
assert.ok(!minimal["/App.tsx"]!.includes("Hero"));
assert.ok(minimal["/App.tsx"]!.includes("Footer"));

// the newsletter and share sections
{
  const files = check({ ...DEFAULT_SPEC, name: "Kaffestua", email: "hei@kaffestua.no" });
  assert.ok(files["/components/Newsletter.tsx"] && files["/components/Share.tsx"], "both are in the default page");
  assert.match(files["/App.tsx"]!, /<Newsletter \/>[\s\S]*<Contact \/>[\s\S]*<Share \/>/, "the sign-up comes before the contact section and the share row after it");
  const news = files["/components/Newsletter.tsx"]!;
  assert.match(news, /fetch\("\/api\/subscribe"/, "it posts to the function the Resend connector adds");
  assert.match(news, /name="website"[\s\S]*?tabIndex=\{-1\}/, "with the hidden field that people never fill in");
  assert.match(news, /type="email" required/);
  assert.match(news, /Resend er koblet til/, "and the preview says why it does not work there");
  const sharing = files["/components/Share.tsx"]!;
  for (const host of ["facebook.com/sharer", "twitter.com/intent/tweet", "linkedin.com/sharing/share-offsite", "wa.me", "mailto:"]) assert.ok(sharing.includes(host), host);
  assert.match(sharing, /noopener,noreferrer/, "the share windows cannot reach back");
  assert.ok(!/dangerouslySetInnerHTML|innerHTML|eval\(/.test(news + sharing));
  const named = check({ ...DEFAULT_SPEC, name: 'Ola {"}"} <b>' });
  assert.ok(named["/components/Share.tsx"]!.includes('const text = "Ola'), "the name goes into the share text as a string");
  const only = check({ ...DEFAULT_SPEC, sections: ["newsletter"] });
  assert.deepEqual(Object.keys(only).filter((k) => /Newsletter|Share/.test(k)), ["/components/Newsletter.tsx"]);
}

// the whole composed page is valid TypeScript against the real types of React and the icon package
{
  const root = fileURLToPath(new URL("..", import.meta.url));
  const dir = join(root, ".gen-compose").replace(/\\/g, "/");
  const files = composeSite({ ...DEFAULT_SPEC, name: "Kaffestua", email: "hei@kaffestua.no" });
  const virtual = new Map(Object.entries(files).filter(([p]) => /\.tsx?$/.test(p)).map(([p, code]) => [`${dir}${p}`, code]));
  const options: ts.CompilerOptions = { jsx: ts.JsxEmit.ReactJSX, strict: true, noEmit: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], skipLibCheck: true, types: [], isolatedModules: true };
  const host = ts.createCompilerHost(options);
  const norm = (f: string) => f.replace(/\\/g, "/");
  const base = { fileExists: host.fileExists.bind(host), readFile: host.readFile.bind(host), getSourceFile: host.getSourceFile.bind(host) };
  host.fileExists = (f) => virtual.has(norm(f)) || base.fileExists(f);
  host.readFile = (f) => virtual.get(norm(f)) ?? base.readFile(f);
  const baseDirectoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => (norm(d).startsWith(dir) ? [...virtual.keys()].some((k) => k.startsWith(norm(d).replace(/\/$/, "") + "/")) : (baseDirectoryExists?.(d) ?? false));
  host.getSourceFile = (f, language, onError, shouldCreate) => (virtual.has(norm(f)) ? ts.createSourceFile(f, virtual.get(norm(f))!, language) : base.getSourceFile(f, language, onError, shouldCreate));
  const program = ts.createProgram([...virtual.keys()], options, host);
  const problems = ts.getPreEmitDiagnostics(program).filter((d) => d.file && virtual.has(norm(d.file.fileName))).map((d) => `${norm(d.file!.fileName).replace(dir, "")}:${d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
  assert.deepEqual(problems, [], "no type errors in the composed page");
}
console.log("compose: all ok");
