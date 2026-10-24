import { existsSync } from "node:fs";

/**
 * Starts a headless browser on the server: the bundled Chromium on Vercel, or a Chrome found on this
 * machine. Used for reading pages that only exist once their scripts have run.
 */

const LOCAL_CHROME = [
  process.env.CHROME_PATH,
  "C:\Program Files\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
  "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean) as string[];

export class BrowserUnavailableError extends Error {}

export async function launchBrowser(viewport: { width: number; height: number }) {
  const puppeteer = (await import("puppeteer-core")).default;
  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: viewport });
  }
  const executablePath = LOCAL_CHROME.find((p) => existsSync(p));
  if (!executablePath) throw new BrowserUnavailableError("Fant ingen nettleser lokalt. Sett CHROME_PATH til chrome.exe.");
  return puppeteer.launch({ executablePath, headless: true, defaultViewport: viewport, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
}
