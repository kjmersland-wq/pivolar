import assert from "node:assert/strict";
import { cleanFont, contrast, DEFAULT_TOKENS, extractTheme, googleFamilies, isFontLink, lostFonts, parseColor, readable, resolveTokens, stylesheetLinks } from "../src/lib/import/theme.ts";

// --- colours: only plain colours get through
assert.equal(parseColor("#ABC"), "#aabbcc");
assert.equal(parseColor("#B45309"), "#b45309");
assert.equal(parseColor("rgb(180, 83, 9)"), "#b45309");
assert.equal(parseColor("rgba(180,83,9,1)"), "#b45309");
assert.equal(parseColor("#b45309 !important"), "#b45309");
for (const bad of ["red", "rgba(0,0,0,.5)", "rgb(300,0,0)", "url(x)", "#12", "#ggg", "red;}</style><script>", "var(--x)", "linear-gradient(#fff,#000)", undefined, ""]) assert.equal(parseColor(bad as string), null, String(bad));

// --- fonts: plain names only
assert.equal(cleanFont("Open Sans, Arial"), '"Open Sans", Arial, sans-serif');
assert.equal(cleanFont("'Lora', serif"), "Lora, serif");
assert.equal(cleanFont('Evil"; background:url(x); "'), undefined);
assert.equal(cleanFont("Arial, x}</style>"), "Arial, sans-serif", "the part that is not a name is dropped");
assert.equal(cleanFont("var(--x)"), undefined);
assert.equal(cleanFont(undefined), undefined);

// --- contrast
assert.ok(contrast("#000000", "#ffffff") > 20);
{
  const fixed = readable("#facc15", "#ffffff");
  assert.ok(contrast(fixed, "#ffffff") >= 4.5, "a yellow is darkened until it can be read");
  assert.equal(readable("#0f172a", "#ffffff"), "#0f172a", "a colour that already reads is kept");
}

// --- a WordPress theme: its own colours win over the default palette that every site carries
const CSS = `:root{--wp--preset--color--black:#000000;--wp--preset--color--vivid-red:#cf2e2e;--wp--preset--color--primary:#b45309;--wp--preset--color--base:#fffbf5;--wp--preset--color--contrast:#1c1917;--wp--preset--font-family--heading:"Playfair Display",serif;--body-font:Lora,serif}
body{background-color:var(--wp--preset--color--base);color:var(--wp--preset--color--contrast);font-family:var(--body-font)}
h1,h2,h3{font-family:var(--wp--preset--font-family--heading)}
a{color:#2563eb}`;
const HTML = `<html><head><meta name="theme-color" content="#111111"><style id="global-styles-inline-css">${CSS}</style><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&family=Playfair+Display&display=swap"><link rel="stylesheet" href="https://evil.example/css?x=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css?family=A&quot;);background:url(x)"></head><body></body></html>`;
{
  const theme = extractTheme(HTML);
  assert.equal(theme.primary, "#b45309", "the theme's own primary, not the default red");
  assert.equal(theme.background, "#fffbf5");
  assert.equal(theme.text, "#1c1917");
  assert.equal(theme.bodyFont, "Lora, serif");
  assert.equal(theme.headingFont, '"Playfair Display", serif');
  assert.equal(theme.fontLinks.length, 1, "only a plain Google Fonts address is kept");
  assert.deepEqual(googleFamilies(theme.fontLinks), ["Lora", "Playfair Display"]);
  assert.deepEqual(lostFonts(theme), [], "both fonts are in the address, so they follow along");
  assert.deepEqual(lostFonts({ fontLinks: [], bodyFont: "Brandfont, sans-serif" }), ["Brandfont"], "a font loaded from the old site is reported");

  // Without variables: the theme colour, then the link colour
  assert.equal(extractTheme(`<head><meta name="theme-color" content="#123456"><style>a{color:#2563eb}</style></head>`).primary, "#123456");
  assert.equal(extractTheme(`<head><style>a{color:rgb(37,99,235)}</style></head>`).primary, "#2563eb");
  // Style sheets from the files count too
  assert.equal(extractTheme("<head></head>", [":root{--primary:#0a7a3c}"]).primary, "#0a7a3c");
  // Nothing readable: nothing is invented
  assert.deepEqual(extractTheme("<html><body>Hei</body></html>"), { fontLinks: [] });
  // A value that is not a plain colour is not taken
  assert.equal(extractTheme(`<style>:root{--wp--preset--color--primary:red;}</style>`).primary, undefined);
}

// --- which style sheets are read
assert.deepEqual(stylesheetLinks(`<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="https://x.no/b.css?v=1"><link rel="stylesheet" href="https://cdn.other/c.css"><link rel="stylesheet" href="http://x.no/d.css"><link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/e.css"><link rel="stylesheet" href="/f.css">`, "https://x.no"), ["https://x.no/a.css", "https://x.no/b.css?v=1", "https://x.no/e.css"], "own address, https, no repeats, at most three");

// --- the tokens the new site uses
{
  assert.deepEqual(resolveTokens(undefined), DEFAULT_TOKENS);
  const warm = resolveTokens(extractTheme(HTML));
  assert.equal(warm.background, "#fffbf5");
  assert.equal(warm.primary, "#b45309");
  assert.equal(warm.onPrimary, "#ffffff");
  assert.equal(warm.headingFont, '"Playfair Display", serif');
  assert.ok(contrast(warm.text, warm.background) >= 7 && contrast(warm.primary, warm.background) >= 4.5);
  // A dark site keeps the fixed light layout, but keeps its main colour, made readable
  const dark = resolveTokens({ fontLinks: [], background: "#101010", text: "#f5f5f5", primary: "#ffcc00" });
  assert.equal(dark.background, "#ffffff");
  assert.ok(contrast(dark.primary, dark.background) >= 4.5);
  // Poor text contrast falls back to the default text colour
  assert.equal(resolveTokens({ fontLinks: [], background: "#ffffff", text: "#cccccc" }).text, DEFAULT_TOKENS.text);
  // A theme that has been tampered with in storage is checked again
  const hostile = resolveTokens({ fontLinks: [], primary: "red;}body{display:none", background: "url(x)", text: "#12", bodyFont: "a}b{", headingFont: 'x"; y' } as never);
  assert.equal(hostile.primary, DEFAULT_TOKENS.primary);
  assert.equal(hostile.bodyFont, DEFAULT_TOKENS.bodyFont);
  assert.equal(hostile.headingFont, "", "a name with a quote in it is not a name");
  assert.doesNotMatch(Object.values(hostile).join(" "), /[{};]|url\(/);
}
assert.ok(isFontLink("https://fonts.googleapis.com/css2?family=Lora:wght@400;700&display=swap"));
for (const bad of ['https://fonts.googleapis.com/css2?family=A");}body{', "http://fonts.googleapis.com/css2?family=A", "https://evil.example/css2?family=A", "https://fonts.googleapis.com.evil.example/css?family=A", "", 3]) assert.equal(isFontLink(bad), false, String(bad));

console.log("theme: all ok");
