import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import zlib from "node:zlib";
import { htmlToBlocks, navFrom } from "../src/lib/import/clean.ts";
import { countBlocks, imagesIn, type Block } from "../src/lib/import/model.ts";
import { createRobots, ImportFetchError, makeSend, publicLookup, robotsAllows, safeFetch, type SafeResponse, type Send } from "../src/lib/import/safe-fetch.ts";
import { roughTokens, toSkeleton } from "../src/lib/import/skeleton.ts";
import { fetchWordPress, IMPORT_LIMITS, originalOf, probeWordPress, siteBase } from "../src/lib/import/wordpress.ts";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const rejects = async (promise: Promise<unknown>, code: string, message = code) => {
  await assert.rejects(promise, (error: unknown) => error instanceof ImportFetchError && error.code === code, message);
};

// --- the address check at the moment of connecting
{
  const resolver = (answer: { address: string; family: number }[]) => (_h: string, _o: unknown, cb: (e: null, a: typeof answer) => void) => cb(null, answer);
  const lookup = (answer: { address: string; family: number }[]) => publicLookup(resolver(answer) as never);
  const ask = (fn: ReturnType<typeof publicLookup>, all: boolean) => new Promise<{ error: NodeJS.ErrnoException | null; address?: unknown; family?: number }>((resolve) => fn("example.no", { all }, (error, address, family) => resolve({ error, address, family })));

  const ok = await ask(lookup([{ address: "93.184.216.34", family: 4 }]), false);
  assert.equal(ok.error, null);
  assert.equal(ok.address, "93.184.216.34");
  const all = await ask(lookup([{ address: "93.184.216.34", family: 4 }]), true);
  assert.deepEqual(all.address, [{ address: "93.184.216.34", family: 4 }]);
  for (const bad of ["127.0.0.1", "10.1.2.3", "192.168.0.5", "169.254.169.254", "172.16.0.9", "::1", "fd00::1", "0.0.0.0"]) {
    const r = await ask(lookup([{ address: bad, family: bad.includes(":") ? 6 : 4 }]), false);
    assert.equal(r.error?.code, "EBLOCKED", `${bad} is refused when connecting`);
  }
  const mixed = await ask(lookup([{ address: "93.184.216.34", family: 4 }, { address: "10.0.0.1", family: 4 }]), true);
  assert.equal(mixed.error?.code, "EBLOCKED", "one private address among public ones is enough to refuse");
  assert.equal((await ask(lookup([]), false)).error?.code, "EBLOCKED");
}

// --- redirects, limits and what is sent, with the network replaced
{
  const checked: string[] = [];
  const checkUrl = async (u: URL | string) => {
    const url = new URL(u.toString());
    checked.push(url.toString());
    if (url.hostname === "intern.example") throw new ImportFetchError("blocked", "Adressen kan ikke hentes.");
    return url;
  };
  const answer = (status: number, headers: Record<string, string> = {}, body = ""): Awaited<ReturnType<Send>> => ({ status, headers, body: Buffer.from(body) });

  const hops: Send = async (url) => (url.pathname === "/a" ? answer(301, { location: "/b" }) : url.pathname === "/b" ? answer(302, { location: "https://andre.example/c" }) : answer(200, { "content-type": "text/plain" }, "ferdig"));
  const res = await safeFetch("https://start.example/a", {}, { send: hops, checkUrl });
  assert.equal(res.text(), "ferdig");
  assert.equal(res.url, "https://andre.example/c");
  assert.deepEqual(checked, ["https://start.example/a", "https://start.example/b", "https://andre.example/c"], "every step of a redirect chain is checked, not just the first");

  const inside: Send = async () => answer(302, { location: "https://intern.example/hemmelig" });
  await rejects(safeFetch("https://start.example/", {}, { send: inside, checkUrl }), "blocked", "a redirect to an internal address is refused");
  const loop: Send = async () => answer(302, { location: "/igjen" });
  await rejects(safeFetch("https://start.example/", { maxRedirects: 2 }, { send: loop, checkUrl }), "redirects");
  const broken: Send = async () => answer(302, { location: "http://[bad" });
  await rejects(safeFetch("https://start.example/", {}, { send: broken, checkUrl }), "network");

  let seen: Parameters<Send>[1] | null = null;
  const spy: Send = async (_u, options) => {
    seen = options;
    return answer(404, { "content-type": "text/html" });
  };
  const notFound = await safeFetch("https://start.example/", { timeoutMs: 3000, maxBytes: 1000, accept: /json/, headers: { Accept: "application/json" } }, { send: spy, checkUrl });
  assert.equal(notFound.ok, false);
  assert.equal(notFound.status, 404);
  assert.match(seen!.headers["User-Agent"]!, /^PivolarImporter\//, "it says who it is");
  assert.equal(seen!.headers.Accept, "application/json");
  assert.equal(seen!.timeoutMs, 3000);
  assert.equal(seen!.maxBytes, 1000);
  assert.ok(!("Cookie" in seen!.headers) && !("Authorization" in seen!.headers), "no cookies or credentials leave");
  assert.deepEqual(JSON.parse((await safeFetch("https://start.example/", {}, { send: async () => answer(200, {}, '{"a":1}'), checkUrl })).text()), { a: 1 });

  // The real address check refuses internal places before anything is opened
  for (const bad of ["http://127.0.0.1/", "http://localhost/", "http://169.254.169.254/latest/meta-data/", "http://10.0.0.1/", "https://user:pw@example.com/", "ftp://example.com/", "http://example.com:8080/", "file:///etc/passwd"]) {
    await rejects(safeFetch(bad, {}, { send: async () => answer(200) }), "blocked", `${bad} is refused`);
  }
}

// --- the real sender, against a local server (name lookup replaced, since the server is on this machine)
{
  const server = http.createServer((req, res) => {
    if (req.url === "/json") return void res.writeHead(200, { "Content-Type": "application/json" }).end('{"ok":true}');
    if (req.url === "/gzip") return void res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip" }).end(zlib.gzipSync("hei gzip"));
    if (req.url === "/big") return void res.writeHead(200, { "Content-Type": "text/plain" }).end("x".repeat(100_000));
    if (req.url === "/bomb") return void res.writeHead(200, { "Content-Type": "text/plain", "Content-Encoding": "gzip" }).end(zlib.gzipSync("a".repeat(5_000_000)));
    if (req.url === "/image") return void res.writeHead(200, { "Content-Type": "image/png" }).end("png");
    if (req.url === "/slow") return; // never answers
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  const plainLookup = (_h: string, o: { all?: boolean }, cb: (e: null, a: unknown, f?: number) => void) => (o.all ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : cb(null, "127.0.0.1", 4));
  const send = makeSend(plainLookup);
  const options = (over: Partial<Parameters<Send>[1]> = {}) => ({ headers: { "User-Agent": "test" }, timeoutMs: 2000, maxBytes: 50_000, ...over });
  const url = (path: string) => new URL(`http://test.local:${port}${path}`);
  try {
    assert.equal((await send(url("/json"), options())).body.toString(), '{"ok":true}');
    assert.equal((await send(url("/gzip"), options())).body.toString(), "hei gzip", "compressed answers are read");
    await rejects(send(url("/big"), options({ maxBytes: 1000 })), "too-large");
    await rejects(send(url("/bomb"), options({ maxBytes: 100_000 })), "too-large", "a small download that unpacks to a huge one is stopped");
    await rejects(send(url("/image"), options({ accept: /json/ })), "bad-type");
    assert.equal((await send(url("/image"), options({ accept: /image/ }))).body.toString(), "png");
    const started = Date.now();
    await rejects(send(url("/slow"), options({ timeoutMs: 300 })), "timeout");
    assert.ok(Date.now() - started < 2000, "a slow site is cut off");
    // The real lookup refuses a name that points at this machine, even if the first check had let it through
    await rejects(makeSend(publicLookup())(new URL(`http://localhost:${port}/json`), options()), "blocked", "the connection itself refuses an internal address");
  } finally {
    server.close();
  }
}

// --- robots.txt
{
  const robots = "User-agent: *\nDisallow: /privat/\nDisallow: /*.pdf$\nAllow: /privat/apen/\n\nUser-agent: PivolarImporter\nDisallow: /kun-oss/\n";
  assert.equal(robotsAllows(robots, "/kun-oss/side"), false, "the importer's own group wins");
  assert.equal(robotsAllows(robots, "/privat/side"), true, "and then the general group is not used");
  const general = "User-agent: *\nDisallow: /privat/\nDisallow: /*.pdf$\nAllow: /privat/apen/\n";
  assert.equal(robotsAllows(general, "/privat/hemmelig"), false);
  assert.equal(robotsAllows(general, "/privat/apen/side"), true, "the more specific rule wins");
  assert.equal(robotsAllows(general, "/mappe/fil.pdf"), false);
  assert.equal(robotsAllows(general, "/mappe/fil.pdf.html"), true, "$ means the end of the address");
  assert.equal(robotsAllows(general, "/om-oss"), true);
  assert.equal(robotsAllows("", "/hvor-som-helst"), true);
  assert.equal(robotsAllows("User-agent: *\nDisallow: /", "/side"), false, "Disallow: / shuts everything");
  assert.equal(robotsAllows("User-agent: *\nDisallow:", "/side"), true, "an empty Disallow allows everything");
  assert.equal(robotsAllows("# kommentar\nUser-agent: *  # alle\nDisallow: /x # noe\n", "/x/y"), false);
  assert.equal(robotsAllows("User-agent: googlebot\nDisallow: /", "/side"), true, "a rule for another robot is not ours");

  let calls = 0;
  const fake = async (u: string): Promise<SafeResponse> => {
    calls++;
    return { url: u, status: 200, ok: true, contentType: "text/plain", headers: {}, body: Buffer.from(general), text: () => general, json: () => ({}) };
  };
  const allowed = createRobots(fake);
  assert.equal(await allowed("https://x.example/privat/a"), false);
  assert.equal(await allowed("https://x.example/om"), true);
  assert.equal(calls, 1, "robots.txt is read once per site");
  const missing = createRobots(async () => {
    throw new ImportFetchError("network", "x");
  });
  assert.equal(await missing("https://y.example/hva-som-helst"), true, "a site without a robots.txt allows everything");
}

// --- from HTML to blocks
{
  const base = "https://example.no/om-oss/";
  const html = `
    <script>alert(1)</script><style>.a{color:red}</style>
    <h2 class="wp-block-heading" style="color:red">Om  oss</h2>
    <p>Vi er <strong>en liten</strong> kaffebar. <a href="/kontakt/" onclick="steal()" class="x">Kontakt oss</a> eller <a href="javascript:alert(1)">klikk her</a>.</p>
    <figure class="wp-block-image"><img src="/bilder/kontor-300x200.jpg" srcset="/bilder/kontor-300x200.jpg 300w, /bilder/kontor-1024x683.jpg 1024w" alt="Kontoret" width="1024" height="683"><figcaption>Vårt kontor</figcaption></figure>
    <img class="lazy" src="data:image/gif;base64,R0lGOD" data-src="https://cdn.example/bilde.png" alt="Lat">
    <ul><li>Kaffe<ul><li>Svart</li></ul></li><li>Te</li></ul>
    <ol><li>Først</li><li>Så</li></ol>
    <blockquote><p>Best i byen</p><cite>Avisen</cite></blockquote>
    <div class="wp-block-buttons"><div class="wp-block-button"><a class="wp-block-button__link wp-element-button" href="https://example.no/bestill">Bestill nå</a></div></div>
    <div class="wp-block-columns"><div class="wp-block-column"><p>Venstre</p></div><div class="wp-block-column"><p>Høyre</p></div></div>
    <figure class="wp-block-gallery"><img src="/a.jpg" alt="A"><img src="/b.jpg" alt="B"></figure>
    <table><thead><tr><th>Dag</th><th>Åpent</th></tr></thead><tbody><tr><td>Man</td><td>8–16</td></tr></tbody></table>
    <iframe src="https://www.youtube.com/embed/abc"></iframe>
    <iframe src="https://www.google.com/maps/embed?pb=1"></iframe>
    <iframe src="https://evil.example/x"></iframe>
    <hr><pre>kode()</pre>
    <form class="wpcf7-form"><input name="x"><button>Send</button></form>
    <p>[gallery ids="1,2"]</p>
    <div class="et_pb_row"><div><div><p>Pakket inn</p></div></div></div>
    <video src="/v.mp4"></video>
    <p></p><p>&nbsp;</p>`;
  const { blocks, signals, images } = htmlToBlocks(html, base);
  const types = blocks.map((b) => b.type);
  assert.deepEqual(types.slice(0, 11), ["heading", "paragraph", "image", "image", "list", "list", "quote", "button", "columns", "gallery", "table"]);
  const text = JSON.stringify(blocks);
  assert.ok(!/alert\(1\)|steal|onclick|color:red|javascript:/.test(text), "no script, no handler, no style, no javascript address survives");
  assert.deepEqual(blocks[0], { type: "heading", level: 2, text: "Om oss" });
  const p = blocks[1] as Extract<Block, { type: "paragraph" }>;
  assert.equal(p.html, 'Vi er <strong>en liten</strong> kaffebar. <a href="https://example.no/kontakt/">Kontakt oss</a> eller klikk her.');
  const fig = blocks[2] as Extract<Block, { type: "image" }>;
  assert.equal(fig.src, "https://example.no/bilder/kontor-1024x683.jpg", "the widest picture in srcset");
  assert.deepEqual([fig.alt, fig.caption, fig.width, fig.height], ["Kontoret", "Vårt kontor", 1024, 683]);
  assert.equal((blocks[3] as Extract<Block, { type: "image" }>).src, "https://cdn.example/bilde.png", "a lazy-loading picture gets its real address");
  assert.deepEqual(blocks[4], { type: "list", ordered: false, items: ["Kaffe", "Svart", "Te"] });
  assert.deepEqual(blocks[5], { type: "list", ordered: true, items: ["Først", "Så"] });
  assert.deepEqual(blocks[6], { type: "quote", html: "Best i byen", cite: "Avisen" });
  assert.deepEqual(blocks[7], { type: "button", label: "Bestill nå", href: "https://example.no/bestill" });
  assert.deepEqual(blocks[8], { type: "columns", columns: [[{ type: "paragraph", html: "Venstre" }], [{ type: "paragraph", html: "Høyre" }]] });
  assert.deepEqual(blocks[9], { type: "gallery", images: [{ src: "https://example.no/a.jpg", alt: "A" }, { src: "https://example.no/b.jpg", alt: "B" }] });
  assert.deepEqual(blocks[10], { type: "table", header: true, rows: [["Dag", "Åpent"], ["Man", "8–16"]] });
  assert.deepEqual(blocks.slice(11, 14).map((b) => (b.type === "embed" ? b.provider : b.type)), ["youtube", "map", "other"]);
  assert.ok(blocks.some((b) => b.type === "divider") && blocks.some((b) => b.type === "code"));
  assert.ok(blocks.some((b) => b.type === "unknown" && b.reason === "form"), "a form is reported, not copied");
  assert.ok(blocks.some((b) => b.type === "unknown" && b.reason === "shortcode:gallery"), "a leftover shortcode is reported");
  assert.ok(blocks.some((b) => b.type === "paragraph" && b.html === "Pakket inn"), "layout wrappers are dropped and the content stays");
  assert.ok(blocks.some((b) => b.type === "unknown" && b.reason === "video"));
  assert.ok(!blocks.some((b) => b.type === "paragraph" && b.html.trim() === ""), "empty paragraphs vanish");
  assert.ok(signals.includes("Divi") && signals.includes("Contact Form 7") && signals.includes("form"));
  assert.ok(images.includes("https://example.no/bilder/kontor-1024x683.jpg") && images.includes("https://cdn.example/bilde.png"));
  assert.equal(new Set(images).size, images.length);
  assert.deepEqual(countBlocks(blocks).unknown, blocks.filter((b) => b.type === "unknown").length);
  assert.equal(imagesIn(blocks).length, 4, "two single pictures and two in the gallery");
}

// --- nothing dangerous gets through, whatever the markup
{
  const hostile = `<p onmouseover="x()"><a href="data:text/html,<script>alert(1)</script>">a</a><a href="  JavaScript:alert(2)">b</a><a href="vbscript:x">c</a><a href="mailto:a@b.no">mail</a><a href="tel:+4712345678">tlf</a>&lt;script&gt;alert(3)&lt;/script&gt;</p>
    <img src="javascript:alert(4)" alt="x"><img src="https://ok.example/a.png" onerror="alert(5)" alt="&quot;><script>alert(6)</script>">
    <p>1 < 2 &amp; 3 > 2</p><svg><script>alert(7)</script></svg><iframe src="javascript:alert(8)"></iframe>`;
  const { blocks } = htmlToBlocks(hostile, "https://example.no/");
  const json = JSON.stringify(blocks);
  assert.ok(!/<script|onerror|onmouseover|javascript:|vbscript:|data:text/i.test(json.replace(/\\u003c/g, "<")), "no script or dangerous address in the result");
  const first = blocks[0] as Extract<Block, { type: "paragraph" }>;
  assert.match(first.html, /<a href="mailto:a@b\.no">mail<\/a>/);
  assert.match(first.html, /<a href="tel:\+4712345678">tlf<\/a>/);
  assert.match(first.html, /&lt;script&gt;alert\(3\)&lt;\/script&gt;/, "text that looks like a tag stays text");
  const img = blocks.find((b) => b.type === "image") as Extract<Block, { type: "image" }>;
  assert.equal(img.src, "https://ok.example/a.png");
  assert.ok(!/</.test(img.alt) || /&lt;|</.test(img.alt), "the alt text is data, and the page shows it as text");
  for (const block of blocks) if (block.type === "paragraph") assert.ok(!/<(?!\/?(a|strong|em|u|s|sub|sup|mark|code|br)\b)/.test(block.html.replace(/&lt;|&gt;/g, "")), "only the allowed tags in paragraphs");
}

// --- the menu
{
  const html = `<header><nav><ul><li><a href="/">Hjem</a></li><li><a href="/om-oss/">Om oss</a></li><li><a href="https://annen.example/">Ekstern</a></li><li><a href="#hopp">Hopp</a></li><li><a href="/om-oss">Om oss</a></li></ul></nav></header><main><a href="/skjult">Ikke i menyen</a></main>`;
  assert.deepEqual(navFrom(html, "https://example.no/"), [{ label: "Hjem", href: "https://example.no/" }, { label: "Om oss", href: "https://example.no/om-oss/" }], "only this site, no duplicates, no anchors, and only the header");
}

// --- the skeleton the AI will read
{
  const body = "Dette er en lang tekst om kaffe som butikken har solgt i mange år og som ikke skal sendes til AI-en i sin helhet. ".repeat(20);
  const blocks: Block[] = [
    { type: "heading", level: 1, text: "Velkommen til kaffebaren vår i sentrum" },
    { type: "paragraph", html: `<strong>${body}</strong>` },
    { type: "image", src: "https://example.no/a.jpg", alt: "Kaffekopp", width: 800, height: 600, caption: "En kopp" },
    { type: "columns", columns: [[{ type: "button", label: "Bestill", href: "https://example.no/bestill" }], [{ type: "list", ordered: false, items: ["Kaffe", "Te"] }]] },
    { type: "unknown", reason: "form", text: "Navn E-post" },
  ];
  const { text, slots } = toSkeleton(blocks);
  assert.match(text, /heading\[1\] \{t1: "Velkommen til kaffebaren vår i sentrum"\}/);
  assert.match(text, /paragraph \{t2: "Dette er en lang tekst om kaffe som butikken har…"\}/);
  assert.match(text, /image \{m1\} alt="Kaffekopp" caption \{t3\} 800x600/);
  assert.match(text, /columns\(2\)\n {2}column 1\n {4}button \{t4: "Bestill"\} link \{l1\}\n {2}column 2\n {4}list\(unordered\)/);
  assert.match(text, /unknown\(form\) \{t7: "Navn E-post"\}/);
  assert.equal(slots.t2, `<strong>${body}</strong>`, "the whole text is kept as data");
  assert.equal(slots.m1, "https://example.no/a.jpg");
  assert.equal(slots.l1, "https://example.no/bestill");
  assert.ok(!text.includes(body.slice(0, 120)), "the long text is not in what the AI reads");
  assert.ok(roughTokens(text) * 8 < roughTokens(JSON.stringify(blocks)), "the skeleton is a fraction of the page");
  assert.equal(toSkeleton([]).text, "");
}

// --- the WordPress adapter, against a site that is made up
const SITE = "https://example.no";
const title = (s: string) => ({ rendered: s });
const wpPages = [
  { id: 1, slug: "om-oss", link: `${SITE}/om-oss/`, title: title("Om oss &#8211; Kaffebar"), content: { rendered: `<h2>Historien</h2><p>Siden 1990. <a href="/kontakt/">Kontakt</a></p><img src="${SITE}/wp-content/uploads/2026/01/kontor-300x200.jpg" alt="Kontoret"><div class="wpcf7"><form>x</form></div>`, protected: false }, excerpt: title("<p>Kort om oss</p>"), parent: 0, date: "2026-01-02T10:00:00", modified: "2026-02-03T11:00:00", featured_media: 10, yoast_head_json: { title: "Om oss | Kaffebar", description: "Vi brenner kaffe", og_image: [{ url: `${SITE}/wp-content/uploads/2026/01/kontor.jpg` }], canonical: `${SITE}/om-oss/` } },
  { id: 2, slug: "tjenester", link: `${SITE}/om-oss/tjenester/`, title: title("Tjenester"), content: { rendered: `<p>Vi tilbyr kaffe.</p>`, protected: false }, excerpt: title(""), parent: 1, featured_media: 0 },
  { id: 3, slug: "hemmelig", link: `${SITE}/hemmelig/`, title: title("Hemmelig"), content: { rendered: "", protected: true }, excerpt: title(""), parent: 0, featured_media: 0 },
  { id: 4, slug: "privat", link: `${SITE}/privat/side/`, title: title("Privat"), content: { rendered: "<p>Ikke for roboter</p>", protected: false }, excerpt: title(""), parent: 0, featured_media: 0 },
];
const wpPosts = [{ id: 7, slug: "nytt-brygg", link: `${SITE}/2026/03/nytt-brygg/`, title: title("Nytt brygg"), content: { rendered: `<p>Prøv det.</p><img src="${SITE}/wp-content/uploads/2026/03/ekstern.png" alt="">`, protected: false }, excerpt: title("<p>Prøv</p>"), parent: 0, featured_media: 0 }];
const wpMedia = [
  { id: 10, source_url: `${SITE}/wp-content/uploads/2026/01/kontor.jpg`, mime_type: "image/jpeg", alt_text: "Kontor &amp; bord", media_details: { width: 1200, height: 800 } },
  { id: 11, source_url: `${SITE}/wp-content/uploads/2026/01/ubrukt.png`, mime_type: "image/png", alt_text: "", media_details: { width: 100, height: 100 } },
];
const HOME = `<html lang="nb-NO"><head><title>Kaffebar</title><meta name="generator" content="WordPress 6.6"><meta name="theme-color" content="#111111"><link rel="stylesheet" href="/wp-content/themes/kaffe/style.css"><link rel="stylesheet" href="https://cdn.evil.example/x.css"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Lora:wght@400;700&display=swap"></head><body><header><nav><a href="/">Hjem</a><a href="/om-oss/">Om oss</a></nav></header></body></html>`;

function wpSite(options: { rest?: boolean; robots?: string; wordpress?: boolean; pages?: unknown[]; posts?: unknown[]; media?: unknown[] } = {}) {
  const { rest = true, robots = "User-agent: *\nDisallow: /privat/\n", wordpress = true, pages = wpPages, posts = wpPosts, media = wpMedia } = options;
  const requests: string[] = [];
  const reply = (body: unknown, headers: Record<string, string> = {}, status = 200, type = "application/json"): SafeResponse => {
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return { url: "", status, ok: status >= 200 && status < 300, contentType: type, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), body: Buffer.from(text), text: () => text, json: () => JSON.parse(text) };
  };
  const list = (items: unknown[], url: URL) => {
    const per = Number(url.searchParams.get("per_page") ?? 10);
    const page = Number(url.searchParams.get("page") ?? 1);
    return reply(items.slice((page - 1) * per, page * per), { "X-WP-Total": String(items.length), "X-WP-TotalPages": String(Math.max(Math.ceil(items.length / per), 1)) });
  };
  const fetcher = async (u: string): Promise<SafeResponse> => {
    requests.push(u);
    const url = new URL(u);
    if (url.pathname === "/robots.txt") return reply(robots, {}, 200, "text/plain");
    if (url.pathname === "/wp-content/themes/kaffe/style.css") return reply("body{font-family:Lora,serif;color:#222}:root{--wp--preset--color--primary:#b45309}", {}, 200, "text/css");
    if (url.pathname === "/") return reply(wordpress ? HOME : "<html><body>Hei</body></html>", {}, 200, "text/html");
    if (!rest) return reply("{}", {}, 404);
    if (url.pathname === "/wp-json/") return reply({ name: "Kaffebar &amp; Co", description: "Brent lokalt", namespaces: ["oembed/1.0", "wp/v2"] });
    if (url.pathname === "/wp-json/wp/v2/pages") return list(pages, url);
    if (url.pathname === "/wp-json/wp/v2/posts") return list(posts, url);
    if (url.pathname === "/wp-json/wp/v2/media") return list(media, url);
    return reply("{}", {}, 404);
  };
  return { fetcher, requests };
}

{
  const site = wpSite();
  const probe = await probeWordPress("example.no/", { fetch: site.fetcher });
  assert.deepEqual([probe.cms, probe.rest, probe.restBase, probe.base], ["wordpress", true, `${SITE}/wp-json`, SITE]);
  assert.deepEqual([probe.name, probe.description, probe.language], ["Kaffebar & Co", "Brent lokalt", "nb-NO"]);
  assert.deepEqual(probe.counts, { pages: 4, posts: 1, media: 2 });

  // The API shut, but the page says WordPress
  const closed = await probeWordPress(SITE, { fetch: wpSite({ rest: false }).fetcher });
  assert.deepEqual([closed.cms, closed.rest], ["wordpress", false]);
  assert.match(closed.notes[0]!, /REST-API-et er stengt/);
  const other = await probeWordPress(SITE, { fetch: wpSite({ rest: false, wordpress: false }).fetcher });
  assert.deepEqual([other.cms, other.rest], ["unknown", false]);
  assert.match(other.notes[0]!, /Joomla, Drupal, Wix og Squarespace kommer/);
  // The site asks robots to stay away
  const noRobots = wpSite({ robots: "User-agent: *\nDisallow: /\n" });
  const refused = await probeWordPress(SITE, { fetch: noRobots.fetcher });
  assert.equal(refused.cms, "unknown");
  assert.match(refused.notes[0]!, /holde seg unna/);
  assert.ok(!noRobots.requests.some((r) => r.includes("wp-json")), "nothing is read from a site that says no");
  assert.equal(siteBase("Example.no/blogg/?x=1#y"), "https://example.no/blogg", "a site in a folder keeps its folder");
  assert.throws(() => siteBase("http://[ugyldig"));
}

{
  const site = wpSite();
  const probe = await probeWordPress(SITE, { fetch: site.fetcher });
  const clock = { t: 1_000 };
  const model = await fetchWordPress(SITE, probe, { fetch: site.fetcher, now: () => (clock.t += 10) });
  assert.equal(model.source, "wordpress");
  assert.deepEqual([model.name, model.language, model.truncated], ["Kaffebar & Co", "nb-NO", false]);
  assert.deepEqual(model.pages.map((p) => p.id), ["page-1", "page-2", "post-7"], "a protected page and a page robots forbids are left out");
  assert.match(model.warnings.join(" "), /1 passordbeskyttede sider/);
  assert.match(model.warnings.join(" "), /1 sider ble hoppet over fordi robots\.txt/);
  const about = model.pages[0]!;
  assert.deepEqual([about.kind, about.path, about.slug, about.title, about.parent], ["page", "/om-oss", "om-oss", "Om oss – Kaffebar", null], "the title is plain text, with the dash decoded");
  assert.equal(model.pages[1]!.parent, "page-1");
  assert.equal(model.pages[1]!.path, "/om-oss/tjenester");
  assert.equal(about.excerpt, "Kort om oss");
  assert.deepEqual(about.seo, { title: "Om oss | Kaffebar", description: "Vi brenner kaffe", image: `${SITE}/wp-content/uploads/2026/01/kontor.jpg`, canonical: `${SITE}/om-oss/` });
  assert.equal(about.featuredImage, `${SITE}/wp-content/uploads/2026/01/kontor.jpg`);
  assert.equal(about.date, "2026-01-02T10:00:00");
  const image = about.blocks.find((b) => b.type === "image") as Extract<Block, { type: "image" }>;
  assert.equal(image.src, `${SITE}/wp-content/uploads/2026/01/kontor.jpg`, "a resized picture in the text is the original in the model");
  assert.deepEqual(about.signals.sort(), ["Contact Form 7", "form"].sort());
  assert.deepEqual(model.plugins, [{ name: "Contact Form 7", pages: 1 }, { name: "form", pages: 1 }]);
  assert.match(model.warnings.join(" "), /deler \(skjemaer, video, kortkoder/);
  // Pictures: the library, which page uses which, and one that is only in the text
  const office = model.media.find((m) => m.id === "10")!;
  assert.deepEqual([office.alt, office.width, office.height, office.mime], ["Kontor & bord", 1200, 800, "image/jpeg"]);
  assert.deepEqual(office.usedBy, ["page-1"], "counted once per page, though it is both in the text and the featured image");
  assert.deepEqual(model.media.find((m) => m.id === "11")!.usedBy, [], "an unused picture is listed with no pages");
  const outside = model.media.find((m) => m.id.startsWith("ext-"))!;
  assert.deepEqual([outside.sourceUrl, outside.mime, outside.usedBy], [`${SITE}/wp-content/uploads/2026/03/ekstern.png`, "image/png", ["post-7"]]);
  assert.deepEqual(model.nav, [{ label: "Hjem", href: `${SITE}/` }, { label: "Om oss", href: `${SITE}/om-oss/` }]);
  // The look is read from the site's own style sheet, and no other site is asked
  assert.equal(model.theme?.primary, "#b45309", "the colour variable beats the theme colour");
  assert.equal(model.theme?.bodyFont, "Lora, serif");
  assert.deepEqual(model.theme?.fontLinks, ["https://fonts.googleapis.com/css2?family=Lora:wght@400;700&display=swap"]);
  assert.ok(!site.requests.some((r) => r.includes("evil.example")), "a style sheet on another site is never fetched");
  assert.deepEqual([model.stats.pages, model.stats.posts, model.stats.media], [2, 1, 3]);
  assert.ok(model.stats.requests >= 5 && model.stats.ms > 0);
  assert.ok(site.requests.every((r) => /^https:\/\/example\.no\//.test(r)), "only this site is contacted");
}

{
  // Limits: a cap on pages, on pictures and on time, each reported and none a crash
  const probe = await probeWordPress(SITE, { fetch: wpSite().fetcher });
  const saved = { ...IMPORT_LIMITS };
  try {
    IMPORT_LIMITS.pages = 2;
    IMPORT_LIMITS.media = 1;
    const capped = await fetchWordPress(SITE, probe, { fetch: wpSite().fetcher });
    assert.equal(capped.truncated, true);
    assert.ok(capped.pages.length <= 2);
    assert.match(capped.warnings.join(" "), /Grensen på 2 sider/);
    assert.match(capped.warnings.join(" "), /første 1 bildene/);
  } finally {
    Object.assign(IMPORT_LIMITS, saved);
  }
  // Paging: more than one page of results is followed to the end
  try {
    IMPORT_LIMITS.pageSize = 1;
    const many = wpSite({ pages: wpPages.slice(0, 2), posts: [], media: [] });
    const paged = await fetchWordPress(SITE, await probeWordPress(SITE, { fetch: many.fetcher }), { fetch: many.fetcher });
    assert.deepEqual(paged.pages.map((p) => p.id), ["page-1", "page-2"]);
    assert.equal(many.requests.filter((r) => r.includes("/wp/v2/pages") && r.includes("per_page=1&page=")).length, 2, "both pages of results were asked for");
  } finally {
    Object.assign(IMPORT_LIMITS, saved);
  }
  // Time: when the deadline has passed, it stops and says so
  const slowClock = { t: 0 };
  const slow = await fetchWordPress(SITE, probe, { fetch: wpSite().fetcher, now: () => (slowClock.t += 60_000) });
  assert.equal(slow.truncated, true);
  assert.equal(slow.pages.length, 0);
  assert.match(slow.warnings.join(" "), /tidsgrensen/);
  // No API, no import
  await assert.rejects(fetchWordPress(SITE, { ...probe, rest: false, restBase: null }, { fetch: wpSite().fetcher }), ImportFetchError);
  // A server that answers with something that is not JSON means "not there", not a crash
  const garbage = wpSite();
  const bad = async (u: string) => (new URL(u).pathname.includes("/wp/v2/") ? { ...(await garbage.fetcher("https://example.no/robots.txt")), json: () => JSON.parse("<html>") as unknown } : garbage.fetcher(u));
  const empty = await fetchWordPress(SITE, probe, { fetch: bad });
  assert.equal(empty.pages.length, 0);
}

// --- resized pictures
{
  const known = new Set(["https://x.no/u/a.jpg", "https://x.no/u/b.png"]);
  assert.equal(originalOf("https://x.no/u/a-300x200.jpg", known), "https://x.no/u/a.jpg");
  assert.equal(originalOf("https://x.no/u/a-scaled.jpg", known), "https://x.no/u/a.jpg");
  assert.equal(originalOf("https://x.no/u/a.jpg", known), "https://x.no/u/a.jpg");
  assert.equal(originalOf("https://x.no/u/c-300x200.jpg", known), "https://x.no/u/c-300x200.jpg", "an unknown file is left as it is");
  assert.equal(originalOf("https://x.no/u/b-1024x768.png?ver=2", known), "https://x.no/u/b-1024x768.png?ver=2", "with a query string it is left alone, not guessed at");
}

// --- the route and what is allowed through it
{
  const route = read("src/app/api/import/cms/route.ts");
  assert.match(route, /await limit\(step \? "importstep" : "import"\)/, "rate limit and the on/off switch come first");
  assert.ok(route.indexOf("content-length") < route.indexOf("request.json()"), "a large body is refused before it is read");
  assert.ok(route.indexOf("await limit(") < route.indexOf("await probeWordPress"), "and the allowance is counted before anything is fetched");
  assert.match(route, /confirmOwner: z\.literal\(true\)/, "the owner must say the site is theirs");
  assert.doesNotMatch(route, /\bfetch\(/, "the route fetches nothing itself");
  assert.doesNotMatch(route, /openAiGate|streamText|generateText/, "the import uses no AI");
  for (const file of ["src/lib/import/wordpress.ts", "src/lib/import/clean.ts", "src/lib/import/skeleton.ts", "src/lib/import/model.ts"]) {
    assert.doesNotMatch(read(file), /from "ai"|@ai-sdk|anthropic|openai/i, `${file} is plain code`);
  }
  assert.match(read("src/lib/import/wordpress.ts"), /safeFetch\(url, limits\)/, "pages are fetched through the safe fetcher");
  const safe = read("src/lib/import/safe-fetch.ts");
  assert.match(safe, /assertPublicUrl/, "it reuses the address check that already exists");
  assert.match(safe, /lookup: lookup as never/, "the connection is made with the checked lookup");
  assert.doesNotMatch(safe, /\bfetch\(/, "it does not use the global fetch, which would skip the check at connect time");
}

console.log("import: all ok");
