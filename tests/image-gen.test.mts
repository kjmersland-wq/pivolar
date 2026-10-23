import assert from "node:assert/strict";
import { buildPrompt, createImageTool, friendly, MAX_IMAGES_PER_REQUEST, type Deps } from "../src/lib/image-gen.ts";
import { bundleStorageImages } from "../src/lib/publish/storage-images.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function deps(overrides: Partial<Deps> = {}) {
  const calls: { generate: Parameters<Deps["generate"]>[0][]; upload: Parameters<Deps["upload"]>[0][] } = { generate: [], upload: [] };
  let n = 0;
  const d: Deps = {
    model: "google/imagen-4.0-generate-001",
    userId: "user-1",
    newId: () => `id-${++n}`,
    generate: async (args) => (calls.generate.push(args), { bytes: PNG, mediaType: "image/png" }),
    upload: async (args) => (calls.upload.push(args), `https://x.supabase.co/storage/v1/object/public/pivolar-images/${args.path}`),
    ...overrides,
  };
  return { d, calls };
}

// --- a normal request: prompt is wrapped, file goes under the user's folder, defaults follow the kind
{
  const { d, calls } = deps();
  const result = await createImageTool(d)({ prompt: "  a blues   guitarist under a spotlight ", kind: "emblem", alt: "Emblem" });
  assert.equal(result.ok, true);
  assert.equal(result.url, "https://x.supabase.co/storage/v1/object/public/pivolar-images/user-1/id-1.png");
  assert.equal(result.width, 1024);
  assert.equal(result.alt, "Emblem");
  assert.equal(calls.generate[0]!.aspectRatio, "1:1", "emblem defaults to square");
  assert.match(calls.generate[0]!.prompt, /^a blues guitarist under a spotlight\n\nStyle requirements: .*emblem/s);
  assert.equal(calls.upload[0]!.contentType === undefined, true);
  assert.equal(calls.upload[0]!.mediaType, "image/png");
}
{
  const { d, calls } = deps();
  const result = await createImageTool(d)({ prompt: "dark club", kind: "hero" });
  assert.equal(calls.generate[0]!.aspectRatio, "16:9");
  assert.equal(calls.generate[0]!.size, "1536x1024", "pixel size for models that take one");
  assert.equal(result.height, 864);
}

// --- limits and bad input
{
  const { d, calls } = deps();
  const tool = createImageTool(d);
  for (let i = 0; i < MAX_IMAGES_PER_REQUEST; i++) assert.equal((await tool({ prompt: `p${i}`, kind: "hero" })).ok, true);
  const over = await tool({ prompt: "one more", kind: "hero" });
  assert.equal(over.ok, false);
  assert.match(over.message, /Grensen/);
  assert.equal(calls.generate.length, MAX_IMAGES_PER_REQUEST, "no model call past the limit");
  assert.equal((await createImageTool(deps().d)({ prompt: "   ", kind: "hero" })).ok, false);
}
{
  const gif = await createImageTool(deps({ generate: async () => ({ bytes: PNG, mediaType: "image/gif" }) }).d)({ prompt: "x", kind: "hero" });
  assert.equal(gif.ok, false);
  const big = await createImageTool(deps({ generate: async () => ({ bytes: new Uint8Array(9 * 1024 * 1024), mediaType: "image/png" }) }).d)({ prompt: "x", kind: "hero" });
  assert.match(big.message, /for stort/);
}

// --- failures become messages the user can act on, and a failed upload is not reported as success
assert.match(friendly(new Error("AI Gateway requires a valid credit card on file")), /betalingskort/);
assert.match(friendly(new Error("new row violates row-level security policy")), /20261023160000_pivolar_images\.sql/);
assert.match(friendly(new Error("429 rate limit")), /For mange/);
assert.match(friendly(new Error("something odd with internal detail abc123")), /Kunne ikke lage bildet/);
assert.doesNotMatch(friendly(new Error("secret key sk-123 leaked")), /sk-123/);
{
  const failed = await createImageTool(deps({ upload: async () => { throw new Error("Bucket not found"); } }).d)({ prompt: "x", kind: "hero" });
  assert.equal(failed.ok, false);
  assert.equal(failed.url, undefined);
  assert.match(failed.message, /migrasjonen/);
}
assert.ok(buildPrompt({ prompt: "x".repeat(2000), kind: "hero" }).length < 1300, "very long prompts are cut");

// --- publishing: pictures from the project's own bucket are bundled and rewritten
const ORIGIN = "https://abc.supabase.co";
const URL1 = `${ORIGIN}/storage/v1/object/public/pivolar-images/user-1/id-1.png`;
const URL2 = `${ORIGIN}/storage/v1/object/public/pivolar-images/user-1/id-2.jpg`;
{
  const asked: string[] = [];
  const fetcher = async (url: string) => (asked.push(url), new Response(PNG, { status: 200 }));
  const files = {
    "/App.tsx": `<img src="${URL1}" /><div style={{backgroundImage:"url(${URL1})"}} />`,
    "/components/Hero.tsx": `const hero = "${URL2}"; const other = "https://evil.example/storage/v1/object/public/pivolar-images/user-1/x.png";`,
  };
  const out = await bundleStorageImages(files, ORIGIN, fetcher);
  assert.deepEqual(asked.sort(), [URL1, URL2].sort(), "each address is fetched once, and only ones in this project's bucket");
  assert.equal(Object.keys(out.images).length, 2);
  for (const path of Object.keys(out.images)) assert.match(path, /^public\/images\/[0-9a-f]{10}\.(png|jpg)$/);
  assert.doesNotMatch(out.files["/App.tsx"]!, /supabase\.co/);
  assert.equal(out.files["/App.tsx"]!.match(/\/images\/[0-9a-f]{10}\.png/g)!.length, 2, "every occurrence is rewritten");
  assert.match(out.files["/components/Hero.tsx"]!, /evil\.example/, "foreign addresses are left alone");
  assert.equal(out.images[Object.keys(out.images)[0]!]!.base64, Buffer.from(PNG).toString("base64"));
  assert.equal(out.failed.length, 0);
  assert.ok(files["/App.tsx"]!.includes(URL1), "the input is not modified");
}
{
  // a picture that cannot be fetched stays as it was and is reported
  const out = await bundleStorageImages({ "/App.tsx": `<img src="${URL1}" />` }, ORIGIN, async () => new Response("no", { status: 404 }));
  assert.deepEqual(out.failed, [URL1]);
  assert.equal(Object.keys(out.images).length, 0);
  assert.ok(out.files["/App.tsx"]!.includes(URL1));
  // no Supabase address configured: nothing happens
  const none = await bundleStorageImages({ "/App.tsx": `<img src="${URL1}" />` }, undefined, async () => { throw new Error("must not fetch"); });
  assert.equal(none.failed.length, 0);
}

console.log("image-gen: all ok");
