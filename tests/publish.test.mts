import assert from "node:assert/strict";
import { SANDBOX_DEPENDENCIES } from "../src/lib/files.ts";
import { HEADING_FONTS, metaTags, mix, readBrand, readableOn, rgba, safeSvg } from "../src/lib/publish/brand.ts";
import { buildDeployableProject, buildStyles } from "../src/lib/publish/project.ts";

const SVG = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="#6d5efc"/></svg>';

// --- safeSvg: only plain vector drawings pass
assert.equal(safeSvg(SVG), SVG);
assert.equal(safeSvg(undefined), null);
assert.equal(safeSvg("<div>not svg</div>"), null);
for (const bad of [
  '<svg><script>alert(1)</script></svg>',
  '<svg onload="x()"></svg>',
  '<svg><a href="javascript:alert(1)"></a></svg>',
  '<svg><foreignObject><div/></foreignObject></svg>',
  '<svg><image xlink:href="https://evil.example/x.png"/></svg>',
]) assert.equal(safeSvg(bad), null, bad);

// --- readBrand: valid values are used, broken ones fall back
{
  const brand = readBrand(
    {
      "/brand.json": JSON.stringify({ name: "Kaffebar", tagline: "Kaffe og ro", description: "Byens beste", primary: "#112233", secondary: "red" }),
      "/public/logo.svg": SVG,
      "/public/favicon.svg": SVG,
    },
    "Tittel",
  );
  assert.equal(brand.name, "Kaffebar");
  assert.equal(brand.primary, "#112233");
  assert.equal(brand.secondary, "#f5576c", "named colours are not trusted, the default is used");
  assert.equal(brand.logoSvg, SVG);
  assert.equal(brand.hasFavicon, true);
}
{
  const brand = readBrand({ "/brand.json": "{ not json" }, "Tittel");
  assert.equal(brand.name, "Tittel");
  assert.equal(brand.description, "Tittel");
  assert.equal(brand.logoSvg, null);
  assert.equal(brand.hasFavicon, false);
}

// --- headingFont and ogStyle: only known values are accepted
{
  const ok = readBrand({ "/brand.json": JSON.stringify({ headingFont: "Fraunces", ogStyle: "editorial" }) }, "T");
  assert.equal(ok.headingFont, "Fraunces");
  assert.equal(ok.ogStyle, "editorial");
  const bad = readBrand({ "/brand.json": JSON.stringify({ headingFont: "Comic Sans", ogStyle: "neon" }) }, "T");
  assert.equal(bad.headingFont, null);
  assert.equal(bad.ogStyle, "aurora", "unknown style falls back to the default");
  assert.ok(Object.values(HEADING_FONTS).every((f) => /^[a-z0-9-]+$/.test(f.id)), "font ids are safe to put in a URL");
}

// --- colour helpers
assert.equal(rgba("#ff8000", 0.5), "rgba(255, 128, 0, 0.5)");
assert.equal(rgba("#f80", 1), "rgba(255, 136, 0, 1)");
assert.equal(mix("#000000", "#ffffff", 0.5), "#808080");
assert.equal(mix("#112233", "#112233", 0.7), "#112233");

// --- readableOn picks a legible text colour
assert.equal(readableOn("#ffffff"), "#111111");
assert.equal(readableOn("#000000"), "#ffffff");
assert.equal(readableOn("#6d5efc"), "#ffffff");
assert.equal(readableOn("#fff"), "#111111");

// --- metaTags escape quotes and point the share image at __SITE_URL__
{
  const tags = metaTags(readBrand({ "/brand.json": JSON.stringify({ name: 'A "B" <c>', description: "d" }) }, "T"), "T");
  assert.match(tags, /og:title" content="A &quot;B&quot; &lt;c&gt;"/);
  assert.match(tags, /og:image" content="__SITE_URL__\/og\.png"/);
  assert.match(tags, /twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(tags, /rel="icon"/, "no favicon link without a favicon file");
}

// --- buildStyles hoists remote @import lines in front of Tailwind
{
  const css = buildStyles('@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");\nbody { color: red; }\n.font-display { font-family: "Fraunces"; }');
  assert.ok(css.startsWith('@import url("https://fonts.googleapis.com/css2?family=Inter&display=swap");\n@import "tailwindcss";'));
  assert.match(css, /body \{ color: red; \}/);
  assert.equal(css.match(/@import/g)!.length, 2);
  assert.equal(buildStyles("body{}"), '@import "tailwindcss";\n\nbody{}\n');
}

// --- buildDeployableProject
{
  const project = buildDeployableProject(
    {
      "/App.tsx": "export default function App(){return null}",
      "/components/Logo.tsx": "export {}",
      "/styles.css": '@import url("https://fonts.googleapis.com/css2?family=Sora&display=swap");\n.x{}',
      "/brand.json": JSON.stringify({ name: "Kaffebar", description: "Byens beste kaffe", primary: "#112233" }),
      "/public/favicon.svg": SVG,
      "/public/logo.svg": SVG,
      "/index.tsx": "protected",
      "/atelier-inspector.js": "protected",
    },
    "Kaffebar",
  );
  assert.ok(project["public/favicon.svg"] && project["public/logo.svg"], "public files stay under public/");
  assert.ok(!("src/public/favicon.svg" in project));
  assert.ok(project["src/App.tsx"] && project["src/components/Logo.tsx"]);
  assert.ok(!("src/index.tsx" in project) && !("src/atelier-inspector.js" in project));
  assert.match(project["index.html"]!, /<title>Kaffebar<\/title>/);
  assert.match(project["index.html"]!, /og:image" content="__SITE_URL__\/og\.png"/);
  assert.match(project["index.html"]!, /rel="icon" type="image\/svg\+xml" href="\/favicon\.svg"/);
  assert.ok(project["src/styles.css"]!.startsWith("@import url("));
  assert.match(project["vite.config.ts"]!, /VERCEL_PROJECT_PRODUCTION_URL/);
  assert.doesNotMatch(project["vite.config.ts"]!, /\$\{/, "the generated config has no stray template placeholders");
  const deps = JSON.parse(project["package.json"]!).dependencies;
  for (const name of Object.keys(SANDBOX_DEPENDENCIES)) assert.ok(name in deps, `${name} is installed in the published project`);
  assert.throws(() => buildDeployableProject({ "/styles.css": "" }, "x"), /App\.tsx/);
}

// --- tests, CI and installable app
{
  const files = { "/App.tsx": "export default function App(){return null}", "/brand.json": JSON.stringify({ name: "Kaffebar", primary: "#112233" }) };
  const project = buildDeployableProject(files, "Kaffebar");
  const pkg = JSON.parse(project["package.json"]!);
  assert.equal(pkg.scripts.typecheck, "tsc --noEmit");
  assert.equal(pkg.scripts.test, "vitest run");
  for (const dep of ["vitest", "jsdom", "@testing-library/react"]) assert.ok(dep in pkg.devDependencies, dep);
  assert.match(project["vite.config.ts"]!, /from "vitest\/config"/);
  assert.match(project["vite.config.ts"]!, /setupFiles: \["\.\/src\/test-setup\.ts"\]/);
  assert.ok(project["src/App.test.tsx"] && project["src/test-setup.ts"], "a smoke test ships with the project");
  assert.match(project["src/App.test.tsx"]!, /render\(<App \/>\)/);
  const ci = project[".github/workflows/ci.yml"]!;
  for (const step of ["npm run typecheck", "npm test", "npm run build"]) assert.ok(ci.includes(step), step);
  assert.match(project["index.html"]!, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.ok(project["public/sw.js"]!.includes('addEventListener("fetch"'));
  assert.match(project["src/main.tsx"]!, /serviceWorker\.register\("\/sw\.js"\)/);
  assert.match(project["src/main.tsx"]!, /import\.meta\.env\.PROD/, "no service worker while developing");
  const bare = JSON.parse(project["public/manifest.webmanifest"]!);
  assert.equal(bare.name, "Kaffebar");
  assert.equal(bare.display, "standalone");
  assert.equal(bare.theme_color, "#112233");
  assert.deepEqual(bare.icons, [], "no icon entries when the icons are not generated");
  const withIcons = JSON.parse(buildDeployableProject(files, "Kaffebar", { icons: true })["public/manifest.webmanifest"]!);
  assert.deepEqual(withIcons.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`), ["192x192:any", "512x512:any", "512x512:maskable"]);
}

console.log("publish: all ok");
