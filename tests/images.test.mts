import assert from "node:assert/strict";
import { searchImages, shorten } from "../src/lib/images.ts";

/** A fetcher that answers by URL prefix and records what was asked. */
function fake(routes: Record<string, unknown | null>) {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
    if (!hit || hit[1] === null) return new Response("{}", { status: 500 });
    return new Response(JSON.stringify(hit[1]), { status: 200 });
  };
  return { fetcher, calls };
}

const unsplashBody = {
  results: [
    { width: 4000, height: 3000, alt_description: "a quiet cafe", urls: { raw: "https://images.unsplash.com/photo-1?ixid=abc" }, user: { name: "Ola N", links: { html: "https://unsplash.com/@ola" } } },
  ],
};
const pexelsBody = {
  photos: [{ width: 3000, height: 2000, alt: "coffee", photographer: "Kari", photographer_url: "https://www.pexels.com/@kari", src: { large2x: "https://images.pexels.com/photos/1/large2x.jpeg" } }],
};
const pixabayBody = {
  hits: [{ imageWidth: 2000, imageHeight: 1500, tags: "coffee, cup", largeImageURL: "https://pixabay.com/get/x_1280.jpg", user: "Per", pageURL: "https://pixabay.com/illustrations/x-1/" }],
};

// Unsplash is tried first and its address gets the size parameters appended to the existing query string.
{
  const { fetcher, calls } = fake({ "https://api.unsplash.com/": unsplashBody });
  const result = await searchImages({ query: "  cozy   cafe ", count: 3 }, { UNSPLASH_ACCESS_KEY: "k1", PEXELS_API_KEY: "k2" }, fetcher);
  assert.equal(result.ok, true);
  assert.equal(result.images[0]!.source, "unsplash");
  assert.equal(result.images[0]!.url, "https://images.unsplash.com/photo-1?ixid=abc&w=1600&q=80&auto=format&fit=crop");
  assert.equal(result.images[0]!.credit, "Ola N / Unsplash");
  assert.match(result.images[0]!.creditUrl, /utm_source=pivolar/);
  assert.equal(calls.length, 1, "stops at the first source with results");
  assert.match(calls[0]!.url, /query=cozy%20cafe&per_page=3&orientation=landscape/);
  assert.equal(calls[0]!.headers.Authorization, "Client-ID k1");
}

// Falls through to Pexels, then Pixabay, when the earlier ones fail or return nothing.
{
  const { fetcher } = fake({ "https://api.unsplash.com/": { results: [] }, "https://api.pexels.com/": pexelsBody });
  const result = await searchImages({ query: "coffee" }, { UNSPLASH_ACCESS_KEY: "k1", PEXELS_API_KEY: "k2" }, fetcher);
  assert.equal(result.images[0]!.source, "pexels");
  assert.match(result.message, /Pexels/);
}
{
  const { fetcher } = fake({ "https://api.unsplash.com/": null, "https://pixabay.com/api/": pixabayBody });
  const result = await searchImages({ query: "coffee", orientation: "portrait" }, { UNSPLASH_ACCESS_KEY: "k1", PIXABAY_API_KEY: "k3" }, fetcher);
  assert.equal(result.images[0]!.source, "pixabay");
}

// No key at all: clearly labelled placeholders, never a failure.
{
  const { fetcher, calls } = fake({});
  const result = await searchImages({ query: "Kaffebar i Oslo!", count: 3 }, {}, fetcher);
  assert.equal(result.ok, true);
  assert.equal(result.images.length, 3);
  assert.equal(result.images[0]!.source, "picsum");
  assert.match(result.message, /plassholder/);
  assert.match(result.message, /UNSPLASH_ACCESS_KEY/);
  assert.equal(calls.length, 0, "no network call without a key");
  assert.match(result.images[0]!.url, /^https:\/\/picsum\.photos\/seed\/[a-z0-9-]+-1\/1600\/1000$/);
}

// Keys exist but nothing matched: the message names who was asked, and placeholders still come back.
{
  const { fetcher } = fake({ "https://api.unsplash.com/": { results: [] } });
  const result = await searchImages({ query: "zzzz" }, { UNSPLASH_ACCESS_KEY: "k1" }, fetcher);
  assert.match(result.message, /Ingen treff hos Unsplash/);
  assert.equal(result.images[0]!.source, "picsum");
}

// Illustrations only come from Pixabay; without a key the AI is told to draw SVG itself.
{
  const { fetcher, calls } = fake({ "https://pixabay.com/api/": pixabayBody });
  const result = await searchImages({ query: "team working", kind: "illustration" }, { PIXABAY_API_KEY: "k3" }, fetcher);
  assert.equal(result.images[0]!.source, "pixabay");
  assert.match(calls[0]!.url, /image_type=illustration/);
  const none = await searchImages({ query: "team", kind: "illustration" }, {}, fetcher);
  assert.equal(none.ok, false);
  assert.match(none.message, /SVG/);
}

// Input limits: empty query is refused, count is clamped, long queries are cut.
{
  const { fetcher, calls } = fake({ "https://api.pexels.com/": pexelsBody });
  assert.equal((await searchImages({ query: "   " }, {}, fetcher)).ok, false);
  await searchImages({ query: "x".repeat(300), count: 99 }, { PEXELS_API_KEY: "k" }, fetcher);
  assert.match(calls[0]!.url, /per_page=12/);
  assert.ok(decodeURIComponent(calls[0]!.url.split("query=")[1]!.split("&")[0]!).length === 100);
}

// --- shorten: long descriptive searches are cut down, short ones are left alone
assert.equal(shorten("dimly lit blues club stage, warm light"), "dimly lit blues club");
assert.equal(shorten("a cozy coffee shop interior with plants"), "cozy coffee shop interior");
assert.equal(shorten("blues club"), null, "already short");
assert.equal(shorten("coffee shop"), null);
assert.equal(shorten("sunset, beach"), "sunset beach", "punctuation alone is worth a retry");
assert.equal(shorten("!!!"), null);

// --- a long search that finds nothing is retried shorter at the same provider before falling through
{
  const asked: string[] = [];
  const fetcher = async (url: string) => {
    const q = decodeURIComponent(new URL(url).searchParams.get("query") ?? "");
    asked.push(q);
    return new Response(JSON.stringify(q === "dimly lit blues club" ? unsplashBody : { results: [] }), { status: 200 });
  };
  const result = await searchImages({ query: "dimly lit blues club stage, warm light" }, { UNSPLASH_ACCESS_KEY: "k1", PEXELS_API_KEY: "k2" }, fetcher);
  assert.equal(result.images[0]!.source, "unsplash", "found by the shorter search, so Pexels is never asked");
  assert.deepEqual(asked, ["dimly lit blues club stage, warm light", "dimly lit blues club"]);
  assert.match(result.message, /Unsplash/);
}
{
  // nothing found at either length: falls through to the next provider
  const asked: string[] = [];
  const fetcher = async (url: string) => (asked.push(new URL(url).hostname), new Response(JSON.stringify(url.includes("pexels") ? pexelsBody : { results: [] }), { status: 200 }));
  const result = await searchImages({ query: "very long and detailed description of a misty forest at dawn" }, { UNSPLASH_ACCESS_KEY: "k1", PEXELS_API_KEY: "k2" }, fetcher);
  assert.equal(result.images[0]!.source, "pexels");
  assert.deepEqual(asked, ["api.unsplash.com", "api.unsplash.com", "api.pexels.com"]);
}

console.log("images: all ok");
