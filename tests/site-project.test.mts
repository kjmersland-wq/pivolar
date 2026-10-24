import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { securityFindings } from "../src/lib/checks/security.ts";
import { seoFindings } from "../src/lib/checks/seo.ts";
import type { Block, Media, Page, SiteModel } from "../src/lib/import/model.ts";
import { buildSiteProject, localizeHref } from "../src/lib/import/site-project.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";
import { bundleStorageImages } from "../src/lib/publish/storage-images.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const ORIGIN = "https://old.no";
const STORE = "https://db.example/storage/v1/object/public/pivolar-assets/u1/job1";

const page = (over: Partial<Page> & { id: string; path: string; title: string; blocks: Block[] }): Page => ({ kind: "page", url: ORIGIN + over.path, slug: over.path.split("/").pop() ?? "", parent: null, excerpt: "", seo: {}, featuredImage: null, signals: [], ...over });
const img = (file: string, alt = ""): Block => ({ type: "image", src: `/images/${file}`, alt, width: 800, height: 600 });
const A = "aaaaaaaaaaaa.webp";
const B = "bbbbbbbbbbbb.webp";

const pages: Page[] = [
  page({ id: "page-1", path: "/om-oss", title: "Om oss – Kaffebar", seo: { title: "Om oss | Kaffebar", description: "Vi brenner kaffe" }, featuredImage: `/images/${B}`, blocks: [
    { type: "heading", level: 1, text: "Historien vår" },
    { type: "heading", level: 3, text: "Siden 1990" },
    { type: "paragraph", html: 'Vi er <strong>små</strong>. <a href="https://old.no/kontakt/">Kontakt oss</a>, <a href="https://annen.example/side">en annen</a> og <a href="javascript:alert(1)">farlig</a>. A &amp; B &lt;script&gt;alert(2)&lt;/script&gt;' },
    img(A, "Kontoret"),
    { type: "gallery", images: [{ src: `/images/${A}`, alt: "A" }, { src: "https://old.no/uploaded/ikke-lagret.jpg", alt: "Ikke lagret" }] },
    { type: "columns", columns: [[{ type: "paragraph", html: "Venstre" }], [{ type: "list", ordered: true, items: ["Én", 'To <a href="/kontakt">lenke</a>'] }]] },
    { type: "quote", html: "Best i byen", cite: "Avisen" },
    { type: "button", label: "Bestill", href: "https://old.no/bestill/" },
    { type: "table", header: true, rows: [["Dag", "Åpent"], ["Man", "8–16"]] },
    { type: "embed", provider: "youtube", src: "https://www.youtube.com/embed/abc" },
    { type: "embed", provider: "other", src: "https://evil.example/frame" },
    { type: "code", text: "<b>ikke fet</b>" },
    { type: "divider" },
    { type: "unknown", reason: "form", text: "Navn E-post" },
  ] }),
  page({ id: "page-2", path: "/kontakt", title: "Kontakt", blocks: [{ type: "paragraph", html: "Ring oss." }] }),
  page({ id: "post-7", kind: "post", path: "/2026/03/nytt-brygg", title: "Nytt brygg", date: "2026-03-05T10:00:00", excerpt: "Prøv det", blocks: [{ type: "paragraph", html: "Prøv det." }] }),
];
const media: Media[] = [
  { id: "1", sourceUrl: "https://old.no/a.jpg", mime: "image/jpeg", alt: "", usedBy: ["page-1"], stored: { file: A, hash: "a".repeat(64), bytes: 1000, width: 800, height: 600 } },
  { id: "2", sourceUrl: "https://old.no/b.jpg", mime: "image/jpeg", alt: "", usedBy: ["page-1"], stored: { file: B, hash: "b".repeat(64), bytes: 1000, width: 800, height: 600 } },
];
const model: SiteModel = { source: "wordpress", url: ORIGIN, name: "Kaffebar", description: "Brent lokalt", language: "nb-NO", nav: [{ label: "Om oss", href: "https://old.no/om-oss/" }, { label: "Kontakt", href: "https://old.no/kontakt/" }, { label: "Ekstern", href: "https://annen.example/" }], pages, media, plugins: [{ name: "Contact Form 7", pages: 1 }], warnings: ["Et varsel"], truncated: false, stats: { pages: 2, posts: 1, media: 2, blocks: 18, unknownBlocks: 1, requests: 4, ms: 10 } };
const url = (file: string) => `${STORE}/${file}`;

// --- addresses
{
  assert.equal(localizeHref("https://old.no/om-oss/", ORIGIN), "/om-oss");
  assert.equal(localizeHref("https://old.no/", ORIGIN), "/");
  assert.equal(localizeHref("https://old.no/side/?a=1#del", ORIGIN), "/side?a=1#del");
  assert.equal(localizeHref("https://annen.example/side/", ORIGIN), "https://annen.example/side/", "another site is left alone");
  assert.equal(localizeHref("mailto:a@b.no", ORIGIN), "mailto:a@b.no");
  assert.equal(localizeHref("/allerede/lokal", ORIGIN), "/allerede/lokal");
}

const project = buildSiteProject(model, url);
const files = project.files;

// --- the files
{
  for (const f of ["/App.tsx", "/styles.css", "/brand.json", "/IMPORT.md", "/lib/types.ts", "/lib/inline.tsx", "/components/Blocks.tsx", "/components/Layout.tsx", "/components/SiteRoutes.tsx", "/components/PageView.tsx", "/components/Home.tsx", "/components/Seo.tsx", "/content/site.ts", "/content/index.ts", "/content/pages/page-1.ts", "/content/pages/page-2.ts", "/content/pages/post-7.ts"]) assert.ok(f in files, `${f} exists`);
  assert.deepEqual(project.report, { pages: 2, posts: 1, routes: 3, images: 2, unknownBlocks: 1, homeFromPosts: true });
  assert.ok(Object.values(files).every((c) => c.length < 200_000), "no file comes near the size limit");
  const home = files["/content/pages/page-1.ts"]!;
  assert.ok(home.includes(url(A)) && home.includes(url(B)), "pictures point at the storage addresses, so the preview shows them and publishing can copy them");
  assert.ok(!home.includes("/images/"), "no unresolved picture path is left for stored pictures");
  assert.ok(home.includes("https://old.no/uploaded/ikke-lagret.jpg"), "a picture that was not stored keeps its old address");
  assert.ok(home.includes('href=\\"/kontakt\\"') || home.includes('href=\\"/kontakt'), "links to the old site became paths on the new one");
  assert.ok(!home.includes("old.no/kontakt"));
  const site = files["/content/site.ts"]!;
  assert.ok(site.includes('"href":"/om-oss"') && site.includes('"href":"/kontakt"'));
  assert.ok(site.includes('"href":"/"'), "the front page is always in the menu");
  assert.deepEqual(JSON.parse(files["/brand.json"]!).name, "Kaffebar");
  const notes = files["/IMPORT.md"]!;
  assert.match(notes, /3 sider og innlegg og 2 bilder/);
  assert.match(notes, /Om oss – Kaffebar: form \(Navn E-post\)/);
  assert.match(notes, /Contact Form 7 \(1 sider\)/);
  assert.match(notes, /Et varsel/);
  assert.ok(!Object.values(files).some((c) => /dangerouslySetInnerHTML|innerHTML|eval\(|document\.write/.test(c)), "the generated code writes no HTML from text");
  // Two pages that would get the same module name still get different files
  const dup = buildSiteProject({ ...model, pages: [pages[0]!, { ...pages[0]!, id: "Page 1", path: "/en" }] });
  assert.equal(Object.keys(dup.files).filter((f) => f.startsWith("/content/pages/")).length, 2);
}

// --- the generated code is valid TypeScript, with the real types of React and the router
{
  const dir = join(root, ".gen-site").replace(/\\/g, "/");
  const virtual = new Map(Object.entries(files).map(([path, code]) => [`${dir}${path}`, code]));
  const options: ts.CompilerOptions = { jsx: ts.JsxEmit.ReactJSX, strict: true, noEmit: true, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, target: ts.ScriptTarget.ES2022, lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"], skipLibCheck: true, types: [], isolatedModules: true, noUnusedLocals: false, exactOptionalPropertyTypes: true, noUncheckedIndexedAccess: true };
  const host = ts.createCompilerHost(options);
  const norm = (f: string) => f.replace(/\\/g, "/");
  const base = { fileExists: host.fileExists.bind(host), readFile: host.readFile.bind(host), getSourceFile: host.getSourceFile.bind(host) };
  host.fileExists = (f) => virtual.has(norm(f)) || base.fileExists(f);
  host.readFile = (f) => virtual.get(norm(f)) ?? base.readFile(f);
  // The folders of the project exist only in memory, but the compiler must be told they are there to look inside them.
  const baseDirectoryExists = host.directoryExists?.bind(host);
  host.directoryExists = (d) => (norm(d).startsWith(dir) ? [...virtual.keys()].some((k) => k.startsWith(norm(d).replace(/\/$/, "") + "/")) : (baseDirectoryExists?.(d) ?? false));
  host.getSourceFile = (f, language, onError, shouldCreate) => (virtual.has(norm(f)) ? ts.createSourceFile(f, virtual.get(norm(f))!, language) : base.getSourceFile(f, language, onError, shouldCreate));
  const program = ts.createProgram([...virtual.keys()], options, host);
  const errors = ts.getPreEmitDiagnostics(program).filter((d) => d.file && virtual.has(norm(d.file.fileName))).map((d) => `${norm(d.file!.fileName).replace(dir, "")}:${d.file!.getLineAndCharacterOfPosition(d.start ?? 0).line + 1} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
  assert.deepEqual(errors, [], "no type errors in the generated project");
}

// --- the site really renders: every page on its old path, with the right content
const out = join(root, "node_modules", ".cache", "pivolar-site-test");
rmSync(out, { recursive: true, force: true });
for (const [path, code] of Object.entries(files)) {
  if (!/\.tsx?$/.test(path)) continue;
  const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const target = join(out, path.replace(/\.tsx?$/, ".js"));
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, js);
}
const load = createRequire(join(out, "run.js"));
const React = load("react") as typeof import("react");
const { renderToString } = load("react-dom/server") as typeof import("react-dom/server");
const { StaticRouter } = load("react-router-dom/server") as typeof import("react-router-dom/server");
const { SiteRoutes } = load("./components/SiteRoutes.js") as { SiteRoutes: () => React.ReactElement };
const render = (location: string) => renderToString(React.createElement(StaticRouter, { location }, React.createElement(SiteRoutes)));

{
  const about = render("/om-oss");
  assert.match(about, /<h1[^>]*>Om oss – Kaffebar<\/h1>/, "the title is the one main heading");
  assert.match(about, /<h2[^>]*>Historien vår<\/h2>/, "a first-level heading in the text became a second-level one");
  assert.match(about, /<h3[^>]*>Siden 1990<\/h3>/);
  assert.equal((about.match(/<h1/g) ?? []).length, 1, "exactly one h1");
  assert.match(about, /<strong>små<\/strong>/);
  assert.match(about, /<a[^>]*href="\/kontakt"[^>]*>Kontakt oss<\/a>/, "a link to the old site is a link on the new one");
  assert.match(about, /<a[^>]*href="https:\/\/annen\.example\/side"[^>]*target="_blank"[^>]*rel="noopener noreferrer"[^>]*>en annen<\/a>/);
  assert.doesNotMatch(about, /javascript:/, "an address with script in it is not a link");
  assert.match(about, /farlig/, "but its text stays");
  assert.match(about, /A &amp; B &lt;script&gt;alert\(2\)&lt;\/script&gt;/, "text that looks like a tag stays text");
  assert.doesNotMatch(about, /<script/i);
  assert.match(about, new RegExp(`<img[^>]*src="${url(A).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}"[^>]*alt="Kontoret"`), "the picture, with its description");
  assert.match(about, /width="800"[^>]*height="600"|height="600"[^>]*width="800"/, "the size is given, so the page does not jump");
  assert.match(about, /loading="lazy"/);
  assert.match(about, /ikke-lagret\.jpg/);
  assert.match(about, /Venstre/);
  assert.match(about, /<ol[^>]*><li>Én<\/li><li>To <a[^>]*href="\/kontakt"[^>]*>lenke<\/a><\/li><\/ol>/);
  assert.match(about, /<blockquote[^>]*>Best i byen<footer[^>]*>Avisen<\/footer><\/blockquote>/);
  assert.match(about, /<a[^>]*href="\/bestill"[^>]*>Bestill<\/a>/, "a button to the old site's own page is a link on the new one");
  assert.match(about, /<th[^>]*>Dag<\/th>/);
  assert.match(about, /<td[^>]*>8–16<\/td>/);
  assert.match(about, /<iframe[^>]*src="https:\/\/www\.youtube\.com\/embed\/abc"/);
  assert.doesNotMatch(about, /evil\.example\/frame"[^>]*>\s*<\/iframe>|<iframe[^>]*evil\.example/, "a frame of another kind is a link, not a frame");
  assert.match(about, /href="https:\/\/evil\.example\/frame"[^>]*>Åpne innholdet/);
  assert.match(about, /&lt;b&gt;ikke fet&lt;\/b&gt;/, "code is shown as it is");
  assert.match(about, /<hr/);
  assert.doesNotMatch(about, /Navn E-post/, "what could not be imported is not shown");
  assert.match(about, /src="[^"]*bbbbbbbbbbbb\.webp"/, "the picture of the page is shown");
  // The frame around it
  assert.match(about, /<a[^>]*href="\/"[^>]*>Kaffebar<\/a>/);
  assert.match(about, /<nav[^>]*aria-label="Hovedmeny"/);
  assert.match(about, /<a aria-current="page"[^>]*href="\/om-oss"/, "the current page is marked in the menu");
  assert.match(about, /<footer[^>]*>Kaffebar(?:<!-- -->)? · Brent lokalt<\/footer>/);

  // A trailing slash, as on the old site, opens the same page
  assert.match(render("/om-oss/"), /<h1[^>]*>Om oss – Kaffebar<\/h1>/);
  assert.match(render("/kontakt"), /<h1[^>]*>Kontakt<\/h1>/);
  // A post, on the path it had
  const post = render("/2026/03/nytt-brygg");
  assert.match(post, /<h1[^>]*>Nytt brygg<\/h1>/);
  assert.match(post, /5\. mars 2026/, "the date, in Norwegian");
  // No front page on the old site: the posts are listed
  const front = render("/");
  assert.match(front, /<h1[^>]*>Kaffebar<\/h1>/);
  assert.match(front, /Brent lokalt/);
  assert.match(front, /<a[^>]*href="\/2026\/03\/nytt-brygg"[^>]*>Nytt brygg<\/a>/);
  assert.match(front, /Prøv det/);
  // An address that does not exist
  assert.match(render("/finnes-ikke"), /Fant ikke siden/);
}

{
  // A site that does have a page for the front page uses it
  const withFront = buildSiteProject({ ...model, pages: [page({ id: "page-9", path: "/", title: "Velkommen", blocks: [{ type: "paragraph", html: "Hei!" }] }), ...pages] }, url);
  assert.equal(withFront.report.homeFromPosts, false);
}

{
  // The look of the old site: colours and fonts follow into the styles, the brand and the published project
  const themed = buildSiteProject({ ...model, theme: { primary: "#b45309", background: "#fffbf5", text: "#1c1917", headingFont: '"Playfair Display", serif', bodyFont: "Lora, serif", fontLinks: ["https://fonts.googleapis.com/css2?family=Lora&family=Playfair+Display&display=swap"] } }, url);
  const css = themed.files["/styles.css"]!;
  assert.match(css, /^@import url\("https:\/\/fonts\.googleapis\.com\/css2\?family=Lora/, "the fonts the old site loaded");
  assert.match(css, /--pv-primary: #b45309;[^}]*--pv-bg: #fffbf5/);
  assert.match(css, /font-family: Lora, serif/);
  assert.match(css, /h1, h2, h3, h4, h5, h6 \{ font-family: "Playfair Display", serif; \}/);
  assert.equal(JSON.parse(themed.files["/brand.json"]!).primary, "#b45309", "the share image and the theme colour use the main colour too");
  const deployed = buildDeployableProject(themed.files, "Kaffebar");
  assert.match(deployed["src/styles.css"]!, /^@import url\([^\n]*;\n@import "tailwindcss";/, "the font address stays in front of Tailwind's import");
  assert.match(themed.files["/components/PageView.tsx"]!, /pageHead/);
  // Tampered values are never written into the CSS
  const tampered = buildSiteProject({ ...model, theme: { primary: "red;}body{display:none", bodyFont: "a}b{", fontLinks: ['https://fonts.googleapis.com/css2?family=A");}body{display:none;', "https://evil.example/x.css"] } as never }, url);
  assert.doesNotMatch(tampered.files["/styles.css"]!, /display:none|evil\.example|@import/);
  assert.equal(JSON.parse(tampered.files["/brand.json"]!).primary, "#0f172a");
  // Without a theme (an older import) the plain look is used
  assert.match(files["/styles.css"]!, /--pv-primary: #0f172a;/);
}

// --- what Pivolar's own checks say about the result
{
  const security = securityFindings(files).filter((f) => f.severity !== "low");
  assert.deepEqual(security.map((f) => f.title), [], "no dangerous patterns in the generated code");
  const seo = seoFindings(files).map((f) => f.id);
  assert.ok(!seo.includes("no-brand") && !seo.includes("no-h1") && !seo.some((id) => id.startsWith("img-alt")), "brand and headings are in place");
}

// --- publishing it
{
  const deploy = buildDeployableProject(files, "Kaffebar");
  assert.ok("src/App.tsx" in deploy && "src/content/pages/page-1.ts" in deploy && "src/components/SiteRoutes.tsx" in deploy);
  assert.ok(JSON.parse(deploy["package.json"]!).dependencies["react-router-dom"], "the router is among the packages");
  assert.deepEqual(JSON.parse(deploy["vercel.json"]!).rewrites, [{ source: "/(.*)", destination: "/index.html" }], "every address opens the page, which shows the right content");
  assert.match(deploy["index.html"]!, /og:title/);

  // The pictures in storage are copied into the site, and the code then points at the copies
  const database = "https://db.example";
  const served = new Map([[url(A), "AAAA"], [url(B), "BBBB"]]);
  const fetched: string[] = [];
  const bundled = await bundleStorageImages(files, database, async (u) => {
    fetched.push(u);
    return served.has(u) ? new Response(served.get(u)) : new Response("nei", { status: 404 });
  });
  assert.equal(Object.keys(bundled.images).length, 2);
  assert.ok(Object.keys(bundled.images).every((p) => /^public\/images\/[0-9a-f]{10}\.webp$/.test(p)));
  assert.ok(!bundled.files["/content/pages/page-1.ts"]!.includes(STORE), "the code no longer depends on Pivolar's storage");
  assert.match(bundled.files["/content/pages/page-1.ts"]!, /"src":"\/images\/[0-9a-f]{10}\.webp"/);
  assert.deepEqual(bundled.failed, []);
  assert.ok(fetched.every((u) => u.startsWith(database)), "only Pivolar's own storage is fetched");
  // Both buckets and every picture type an import can bring
  const mixed = await bundleStorageImages({ "/a.ts": `${database}/storage/v1/object/public/pivolar-images/u/x.png ${database}/storage/v1/object/public/pivolar-assets/u/j/y.gif ${database}/storage/v1/object/public/pivolar-assets/u/j/z.avif ${database}/storage/v1/object/public/andre-bote/u/q.png` }, database, async () => new Response("x"));
  assert.equal(Object.keys(mixed.images).length, 3, "a bucket that is not Pivolar's is never touched");
  // A lot of pictures are handled a few at a time, and the whole is bounded
  const many = Object.fromEntries(Array.from({ length: 60 }, (_, i) => [`/p${i}.ts`, `${database}/storage/v1/object/public/pivolar-assets/u/j/${String(i).padStart(12, "0")}.webp`]));
  let live = 0;
  let peak = 0;
  const slow = await bundleStorageImages(many, database, async () => {
    live++;
    peak = Math.max(peak, live);
    await new Promise((r) => setTimeout(r, 2));
    live--;
    return new Response("x");
  });
  assert.equal(Object.keys(slow.images).length, 60);
  assert.ok(peak > 1 && peak <= 6, `${peak} at a time`);
}

// --- the button, the steps and the owner's confirmation
{
  const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  assert.match(read("src/app/page.tsx"), /<ImportCms \/>/, "the import is on the start page");
  const ui = read("src/components/ImportCms.tsx");
  assert.match(ui, /disabled=\{busy \|\| url\.trim\(\)\.length < 3 \|\| !owner\}/, "nothing is checked before the owner has said the site is theirs");
  assert.match(ui, /onClick=\{\(\) => void run\(\)\} disabled=\{!owner\}/, "and nothing is fetched either");
  assert.match(ui, /round < 80/, "the picture steps end after a fixed number of rounds");
  assert.match(ui, /if \(busy\) return;/, "the window cannot be closed in the middle of a step");
  const client = read("src/lib/import/client.ts");
  assert.match(client, /confirmOwner: true/);
  assert.match(client, /buildSiteProject\(loaded\.model/);
  assert.match(client, /source: "cms"/);
  assert.doesNotMatch(client, /anthropic|openai|streamText|generateText/i, "the whole import, from the button to the project, uses no AI");
}

// --- pre-rendering: every page is also written as finished HTML, so search engines need no JavaScript
{
  const deploy = buildDeployableProject(files, "Kaffebar");
  const scripts = JSON.parse(deploy["package.json"]!).scripts as Record<string, string>;
  assert.match(scripts.build!, /vite build --ssr src\/entry-server\.tsx --outDir \.ssr && node scripts\/prerender\.mjs$/, "the build draws the pages after building the site");
  for (const f of ["src/entry-server.tsx", "scripts/prerender.mjs", "src/lib/head.ts"]) assert.ok(f in deploy, `${f} is in the published project`);
  assert.match(deploy[".gitignore"]!, /^\.ssr$/m);
  assert.match(deploy["src/main.tsx"]!, /hydrateRoot\(root, app\)/, "the browser takes over the finished page");
  assert.match(deploy["src/main.tsx"]!, /root\.replaceChildren\(\);\s*createRoot/, "and draws from scratch on an address with no finished page");
  // A project that is not an import is built as before
  const plain = buildDeployableProject({ "/App.tsx": "export default function App() { return <h1>Hei</h1>; }" }, "Plain");
  assert.equal(JSON.parse(plain["package.json"]!).scripts.build, "vite build");
  assert.ok(!("scripts/prerender.mjs" in plain) && !("src/entry-server.tsx" in plain));

  // The script is run for real, on the code the project would be built from
  const prepare = (name: string, site: SiteModel, siteUrl: string) => {
    const built = buildDeployableProject(buildSiteProject(site, url).files, "Kaffebar");
    const dir = join(root, "node_modules", ".cache", name);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(dir, "dist"), { recursive: true });
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "package.json"), '{ "type": "commonjs" }');
    writeFileSync(join(dir, "scripts", "prerender.mjs"), built["scripts/prerender.mjs"]!);
    writeFileSync(join(dir, "dist", "index.html"), built["index.html"]!.replaceAll("__SITE_URL__", siteUrl));
    for (const [path, code] of Object.entries(built)) {
      if (!/^src\/.*\.tsx?$/.test(path) || /\.d\.ts$|App\.test|main\.tsx|test-setup/.test(path)) continue;
      const js = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
      const target = join(dir, ".ssr", path.slice(4).replace(/\.tsx?$/, ".js"));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, js);
    }
    const run = spawnSync(process.execPath, ["scripts/prerender.mjs"], { cwd: dir, encoding: "utf8", env: { ...process.env, VERCEL_PROJECT_PRODUCTION_URL: siteUrl ? siteUrl.replace("https://", "") : "", SITE_URL: "" } });
    return { dir, run, read: (p: string) => readFileSync(join(dir, "dist", p), "utf8"), has: (p: string) => existsSync(join(dir, "dist", p)) };
  };

  const site = prepare("pivolar-prerender-test", model, "https://kaffe.example");
  assert.equal(site.run.status, 0, site.run.stderr);
  assert.match(site.run.stdout, /prerender: 4 pages/);
  const about = site.read("om-oss/index.html");
  assert.match(about, /<title>Om oss \| Kaffebar<\/title>/, "its own title");
  assert.match(about, /<meta name="description" content="Vi brenner kaffe" \/>/, "its own description");
  assert.match(about, /<link rel="canonical" href="https:\/\/kaffe\.example\/om-oss" \/>/);
  assert.equal((about.match(/rel="canonical"/g) ?? []).length, 1);
  assert.match(about, /<meta property="og:url" content="https:\/\/kaffe\.example\/om-oss" \/>/);
  assert.match(about, /<meta property="og:title" content="Om oss \| Kaffebar" \/>/);
  assert.match(about, /<meta property="og:image" content="[^"]*bbbbbbbbbbbb\.webp" \/>/, "the picture of the page is the share picture");
  assert.match(about, /<html lang="nb-NO"/);
  assert.match(about, /<div id="root" data-path="\/om-oss"><div[^>]*>[\s\S]*<h1[^>]*>Om oss – Kaffebar<\/h1>/, "the content is in the file itself");
  assert.match(about, /<script type="module"[^>]*src="\/src\/main\.tsx"/, "the browser script is still loaded");
  assert.match(site.read("2026/03/nytt-brygg/index.html"), /5\. mars 2026/);
  assert.match(site.read("index.html"), /<link rel="canonical" href="https:\/\/kaffe\.example\/" \/>[\s\S]*Brent lokalt/, "the front page, made from the posts");
  const sitemap = site.read("sitemap.xml");
  assert.deepEqual([...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]), ["https://kaffe.example/om-oss", "https://kaffe.example/kontakt", "https://kaffe.example/2026/03/nytt-brygg", "https://kaffe.example/"], "every page is in the sitemap");

  // Without a known address no page claims the front page as its own
  const bare = prepare("pivolar-prerender-bare", model, "");
  assert.equal(bare.run.status, 0, bare.run.stderr);
  assert.doesNotMatch(bare.read("om-oss/index.html"), /rel="canonical"|og:url/);
  assert.ok(!bare.has("sitemap.xml"), "no sitemap without an address to put in it");

  // Addresses come from another site: none may write outside the build folder, over its files, or break the page
  const hostile: SiteModel = {
    ...model,
    pages: [
      page({ id: "page-1", path: "/ok", title: "Ok", seo: { description: 'A "quoted" <b>tag</b> $& price $1' }, blocks: [{ type: "paragraph", html: "Hei" }] }),
      page({ id: "page-2", path: "/../utenfor", title: "Ut", blocks: [] }),
      page({ id: "page-3", path: "/%2e%2e/utenfor2", title: "Ut2", blocks: [] }),
      page({ id: "page-4", path: "/assets/x", title: "Eiendeler", blocks: [] }),
      page({ id: "page-5", path: "/a%2Fb", title: "Skråstrek", blocks: [] }),
      page({ id: "page-6", path: "/%zz", title: "Ugyldig", blocks: [] }),
    ],
  };
  const evil = prepare("pivolar-prerender-evil", hostile, "https://kaffe.example");
  assert.equal(evil.run.status, 0, evil.run.stderr);
  assert.match(evil.run.stdout, /prerender: 2 pages/, "only the front page and /ok were written");
  assert.ok(!existsSync(join(evil.dir, "utenfor")) && !existsSync(join(evil.dir, "utenfor2")) && !evil.has("assets/x/index.html") && !evil.has("a/b/index.html"));
  assert.match(evil.read("ok/index.html"), /<meta name="description" content="A &quot;quoted&quot; &lt;b&gt;tag&lt;\/b&gt; \$&amp; price \$1" \/>/, "text from the old site is escaped and never read as a pattern");
  for (const d of [site.dir, bare.dir, evil.dir]) rmSync(d, { recursive: true, force: true });
}

rmSync(out, { recursive: true, force: true });
console.log("site-project: all ok");
