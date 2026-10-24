import { BrowserUnavailableError, launchBrowser } from "../browser.ts";
import { assertPublicUrl, AnalyzeError, isPublicHost } from "./guard.ts";
import { MEASURE_SOURCE } from "./measure-script.ts";
import type { Spec } from "./condense.ts";

/**
 * Opens a public page in a real headless browser at desktop size, lets it render and scroll
 * through it (so lazy images and reveal animations finish), measures the layout and takes
 * screenshots in slices. Needs a browser: the bundled Chromium on Vercel, or a local Chrome.
 */

const VIEWPORT = { width: 1280, height: 800 };
const NAV_TIMEOUT_MS = 45_000;
const TOTAL_TIMEOUT_MS = 110_000;
const MAX_SHOTS = 12;
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

export type Analysis = { spec: Spec; shots: Uint8Array[]; finalUrl: string };

async function launch() {
  try {
    return await launchBrowser(VIEWPORT);
  } catch (error) {
    throw error instanceof BrowserUnavailableError ? new AnalyzeError(error.message) : error;
  }
}

export async function analyzeSite(input: string, options: { maxBlocks?: number } = {}): Promise<Analysis> {
  const url = await assertPublicUrl(input);
  const browser = await launch();
  const timer = setTimeout(() => void browser.close().catch(() => undefined), TOTAL_TIMEOUT_MS);
  try {
    const page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport(VIEWPORT);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      void (async () => {
        try {
          const target = new URL(request.url());
          if (target.protocol === "data:" || target.protocol === "blob:") return void request.continue();
          if ((target.protocol !== "http:" && target.protocol !== "https:") || !(await isPublicHost(target.hostname))) return void request.abort("blockedbyclient");
          // Video and audio are large and say nothing about layout.
          if (request.resourceType() === "media") return void request.abort("blockedbyclient");
          await request.continue();
        } catch {
          await request.abort("failed").catch(() => undefined);
        }
      })();
    });

    try {
      await page.goto(url.toString(), { waitUntil: "networkidle2", timeout: NAV_TIMEOUT_MS });
    } catch (error) {
      // A page that never goes quiet (live feeds, video) is still usable once it has loaded.
      if (!(error instanceof Error) || !/timeout/i.test(error.message)) throw new AnalyzeError("Kunne ikke åpne siden. Sjekk adressen og at den er offentlig.");
    }
    await new Promise((r) => setTimeout(r, 1200));

    // Scroll through the page so lazy content and reveal animations are done, then return to the top.
    await page.evaluate(`(async () => {
      // Smooth scrolling would make the positions below depend on timing, so it is switched off.
      const css = document.createElement('style'); css.textContent = 'html,body{scroll-behavior:auto !important}'; document.head.appendChild(css);
      const step = 500; const total = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
      for (let y = 0; y < Math.min(total, 30000); y += step) { window.scrollTo({ top: y, behavior: 'instant' }); await new Promise(r => setTimeout(r, 140)); }
      window.scrollTo({ top: 0, behavior: 'instant' }); await new Promise(r => setTimeout(r, 700));
    })()`);

    const spec = (await page.evaluate(`(${MEASURE_SOURCE})(${JSON.stringify({ maxBlocks: options.maxBlocks ?? 90 })})`)) as Spec;
    spec.url = page.url();
    if (!spec.sections?.length) throw new AnalyzeError("Fant ingen innhold å måle på siden. Den kan kreve innlogging.");

    const shots: Uint8Array[] = [];
    const total = Math.min(spec.docH, VIEWPORT.height * 60);
    const stride = Math.max(VIEWPORT.height, Math.ceil(total / MAX_SHOTS / 100) * 100);
    for (let y = 0; y < total && shots.length < MAX_SHOTS; y += stride) {
      const height = Math.min(VIEWPORT.height, total - y);
      if (height < 120 && shots.length > 0) break;
      const image = await page.screenshot({ type: "jpeg", quality: 62, clip: { x: 0, y, width: VIEWPORT.width, height }, captureBeyondViewport: true });
      shots.push(image as Uint8Array);
    }
    return { spec, shots, finalUrl: page.url() };
  } finally {
    clearTimeout(timer);
    await browser.close().catch(() => undefined);
  }
}
