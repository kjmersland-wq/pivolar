import { isPublicHost } from "../analyze/guard.ts";
import { launchBrowser } from "../browser.ts";
import type { Renderer } from "./rendered.ts";
import { USER_AGENT } from "./safe-fetch.ts";

/**
 * The browser behind the rendered import. It draws one page at a time and hands back the finished
 * HTML. What it may do is cut down on purpose: every request it makes goes to a public address,
 * pictures, fonts and media are never downloaded, a page of the site cannot send it to another
 * domain, it opens no pop-ups and downloads nothing, and it is closed after a fixed time whatever happens.
 */

const VIEWPORT = { width: 1280, height: 900 };
const PAGE_TIMEOUT_MS = 20_000;
/** The browser is closed this long after it was started, even if the import is still going. */
const LIFETIME_MS = 110_000;
const BLOCKED_TYPES = new Set(["image", "media", "font", "websocket", "eventsource", "other"]);

const bare = (host: string) => host.replace(/^www\./, "").toLowerCase();

export async function openRenderer(): Promise<Renderer> {
  const browser = await launchBrowser(VIEWPORT);
  const watchdog = setTimeout(() => void browser.close().catch(() => undefined), LIFETIME_MS);
  watchdog.unref?.();
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setViewport(VIEWPORT);
  // Nothing is saved to disk, and a page that tries to open a dialog is answered at once.
  const session = await page.createCDPSession();
  await session.send("Browser.setDownloadBehavior", { behavior: "deny" }).catch(() => undefined);
  page.on("dialog", (dialog) => void dialog.dismiss().catch(() => undefined));
  page.on("popup", (popup) => void popup?.close().catch(() => undefined));

  let site: string | null = null;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    void (async () => {
      try {
        const target = new URL(request.url());
        if (target.protocol === "data:" || target.protocol === "blob:") return void request.continue();
        if ((target.protocol !== "http:" && target.protocol !== "https:") || !(await isPublicHost(target.hostname))) return void request.abort("blockedbyclient");
        if (BLOCKED_TYPES.has(request.resourceType())) return void request.abort("blockedbyclient");
        // The page itself stays on the site: a link or a redirect to another domain is not followed.
        if (request.isNavigationRequest() && site && bare(target.hostname) !== site) return void request.abort("blockedbyclient");
        await request.continue();
      } catch {
        await request.abort("failed").catch(() => undefined);
      }
    })();
  });

  return {
    async render(url) {
      if (!site) site = bare(new URL(url).hostname);
      let status = 0;
      try {
        const response = await page.goto(url, { waitUntil: "networkidle2", timeout: PAGE_TIMEOUT_MS });
        status = response?.status() ?? 0;
      } catch (error) {
        // A page that never goes quiet is still usable once it has loaded; anything else is a page that could not be opened.
        if (!(error instanceof Error) || !/timeout/i.test(error.message)) return null;
        status = 200;
      }
      // A short scroll lets lazy content appear.
      await page
        .evaluate(`(async () => { for (let y = 0; y < 3000; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); } window.scrollTo(0, 0); })()`)
        .catch(() => undefined);
      const html = await page.content().catch(() => "");
      return { url: page.url(), status, html };
    },
    async close() {
      clearTimeout(watchdog);
      await browser.close().catch(() => undefined);
    },
  };
}
