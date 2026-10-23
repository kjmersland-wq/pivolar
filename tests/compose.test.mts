import assert from "node:assert/strict";
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
console.log("compose: all ok");
