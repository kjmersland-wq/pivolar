import assert from "node:assert/strict";
import { seoFindings, seoRequest } from "../src/lib/checks/seo.ts";
import { hashtags, POST_LIMITS, shareLinks, socialPosts, withUtm } from "../src/lib/checks/social.ts";
import { metaTags, readBrand, structuredData } from "../src/lib/publish/brand.ts";
import { buildDeployableProject } from "../src/lib/publish/project.ts";

const SVG = '<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="#6d5efc"/></svg>';
const good = {
  name: "Kaffebar",
  tagline: "Kaffe og ro i sentrum",
  description: "Håndbrent kaffe, bakst og rolige bord midt i byen. Åpent hver dag fra klokken åtte.",
};
const page = (body: string) => `export default function App() {\n  return <main>${body}</main>;\n}\n`;

// --- seo: a complete page has nothing to report
{
  const files = { "/App.tsx": page("<h1>Kaffebar</h1>"), "/brand.json": JSON.stringify(good), "/public/favicon.svg": SVG };
  assert.deepEqual(seoFindings(files), []);
}

// --- seo: missing brand.json, h1 and icon
{
  const ids = seoFindings({ "/App.tsx": page("<p>hei</p>") }).map((f) => f.id);
  assert.deepEqual(ids.slice(0, 2).sort(), ["no-brand", "no-h1"].sort(), "worst first");
  assert.ok(ids.includes("no-icon"));
}

// --- seo: description length, long name
{
  const short = seoFindings({ "/App.tsx": page("<h1>x</h1>"), "/brand.json": JSON.stringify({ ...good, description: "Kaffe" }), "/public/favicon.svg": SVG });
  assert.equal(short.length, 1);
  assert.equal(short[0]!.severity, "high");
  assert.match(short[0]!.title, /kort \(5 tegn\)/);
  const long = seoFindings({ "/App.tsx": page("<h1>x</h1>"), "/brand.json": JSON.stringify({ ...good, description: "a".repeat(200) }), "/public/favicon.svg": SVG });
  assert.equal(long[0]!.id, "description-long");
  const name = seoFindings({ "/App.tsx": page("<h1>x</h1>"), "/brand.json": JSON.stringify({ ...good, name: "N".repeat(70) }), "/public/favicon.svg": SVG });
  assert.equal(name[0]!.id, "title-long");
}

// --- seo: several h1 and images without alt, with line numbers
{
  const source = "export default function App() {\n  return (\n    <main>\n      <h1>A</h1>\n      <h1>B</h1>\n      <img src=\"/a.png\" />\n      <img src=\"/b.png\" alt=\"\" />\n    </main>\n  );\n}\n";
  const f = seoFindings({ "/App.tsx": source, "/brand.json": JSON.stringify(good), "/public/favicon.svg": SVG });
  assert.equal(f.length, 2);
  const alt = f.find((x) => x.id.startsWith("img-alt"))!;
  assert.equal(alt.line, 6, "only the image without alt");
  assert.equal(alt.severity, "medium");
  assert.equal(f.find((x) => x.id.startsWith("many-h1"))!.line, 5);
  assert.match(seoRequest(f), /Utseendet skal være likt/);
}

// --- social: hashtags, utm and posts
{
  assert.deepEqual(hashtags({ name: "Kaffebar", tagline: "Kaffe og ro i sentrum" }), ["#Kaffebar", "#Kaffe", "#Sentrum"]);
  assert.equal(withUtm("", "x"), "");
  assert.equal(withUtm("minside.no", "facebook"), "https://minside.no/?utm_source=facebook&utm_medium=social&utm_campaign=innlegg");
  const posts = socialPosts(good, "minside.no");
  assert.deepEqual(posts.map((p) => p.platform), ["x", "facebook", "instagram", "linkedin"]);
  for (const post of posts) {
    assert.ok(post.text.length <= POST_LIMITS[post.platform], `${post.platform} fits`);
    assert.match(post.text, new RegExp(`utm_source=${post.platform}`), "tagged address stays in the text");
  }
  // a long description is shortened, the address and tags are not
  const long = socialPosts({ ...good, description: "ord ".repeat(200) }, "minside.no")[0]!;
  assert.ok(long.text.length <= 280);
  assert.match(long.text, /utm_source=x/);
  assert.match(long.text, /#Kaffebar/);
  const noUrl = socialPosts(good, "")[0]!;
  assert.doesNotMatch(noUrl.text, /https?:/);
  assert.match(socialPosts(good, "")[2]!.text, /^Kaffebar\n/);
  assert.doesNotMatch(socialPosts(good, "")[2]!.text, /Lenke i bio/);
}

// --- social: share links are encoded
{
  const links = shareLinks("https://minside.no/?a=1&b=2", "Kaffe & ro");
  assert.equal(links.length, 5);
  assert.match(links[0]!.href, /sharer\.php\?u=https%3A%2F%2Fminside\.no%2F%3Fa%3D1%26b%3D2$/);
  assert.match(links[1]!.href, /text=Kaffe%20%26%20ro/);
}

// --- publish: canonical, og:url, structured data (escaped), robots and sitemap at build time
{
  const brand = readBrand({ "/brand.json": JSON.stringify({ ...good, description: "</script><b>x</b>" }) }, "T");
  const tags = metaTags(brand, "T");
  assert.match(tags, /rel="canonical" href="__SITE_URL__\/"/);
  assert.match(tags, /og:url" content="__SITE_URL__\/"/);
  assert.match(tags, /og:locale" content="nb_NO"/);
  const ld = structuredData(brand, "T");
  assert.match(ld, /^<script type="application\/ld\+json">/);
  assert.equal(ld.split("</script>").length, 2, "the data cannot close the script tag");
  const parsed = JSON.parse(ld.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""));
  assert.equal(parsed["@type"], "WebSite");
  assert.equal(parsed.description, "</script><b>x</b>");
  const project = buildDeployableProject({ "/App.tsx": page("<h1>x</h1>"), "/brand.json": JSON.stringify(good) }, "Kaffebar");
  assert.match(project["index.html"]!, /application\/ld\+json/);
  assert.match(project["vite.config.ts"]!, /robots\.txt/);
  assert.match(project["vite.config.ts"]!, /sitemap\.xml/);
}

console.log("seo: all ok");
