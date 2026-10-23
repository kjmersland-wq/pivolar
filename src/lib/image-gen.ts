/**
 * The AI's generateImage tool: writes a rich prompt around the request, asks an image model for
 * the picture and stores it in Supabase Storage. The model call and the upload are passed in, so
 * the rules here (limits, prompt, sizes) can be tested without a model or a database.
 */

export type ImageKind = "hero" | "emblem" | "illustration" | "texture" | "portrait";
export type Aspect = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

export type GenerateInput = { prompt: string; kind: ImageKind; aspectRatio?: Aspect; alt?: string };
export type GenerateResult = { ok: boolean; message: string; url?: string; width?: number; height?: number; alt?: string };

export type Deps = {
  /** Calls the image model. `model` is the gateway id, for example "google/imagen-4.0-generate-001". */
  generate: (args: { model: string; prompt: string; aspectRatio: Aspect; size: string }) => Promise<{ bytes: Uint8Array; mediaType: string }>;
  /** Stores the file and returns its public address. */
  upload: (args: { path: string; bytes: Uint8Array; mediaType: string }) => Promise<string>;
  model: string;
  userId: string;
  newId: () => string;
};

/** Pictures one request may make. They cost money and take 10-30 seconds each. */
export const MAX_IMAGES_PER_REQUEST = 3;
const MAX_BYTES = 8 * 1024 * 1024;
const EXTENSION: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** The shape of the picture to ask for, per use. Pixel sizes are for models that take a size, not a ratio. */
const DIMENSIONS: Record<Aspect, { width: number; height: number; openai: string }> = {
  "1:1": { width: 1024, height: 1024, openai: "1024x1024" },
  "16:9": { width: 1536, height: 864, openai: "1536x1024" },
  "9:16": { width: 864, height: 1536, openai: "1024x1536" },
  "4:3": { width: 1365, height: 1024, openai: "1536x1024" },
  "3:4": { width: 1024, height: 1365, openai: "1024x1536" },
};

const DEFAULT_ASPECT: Record<ImageKind, Aspect> = { hero: "16:9", emblem: "1:1", illustration: "4:3", texture: "1:1", portrait: "3:4" };

/** What each kind of picture needs on top of the AI's own description. */
const STYLE: Record<ImageKind, string> = {
  hero: "Cinematic wide photograph or painterly scene, atmospheric lighting, shallow depth of field, strong composition with calm negative space where a headline can sit, no text, no watermark, no logos.",
  emblem:
    "A single centered emblem or logo badge, crisp detailed illustration with clean edges, limited harmonious colour palette, symmetrical composition, isolated on a plain flat solid background with generous margin, no mockup, no photograph of a surface, no watermark.",
  illustration: "Polished editorial illustration, cohesive limited palette, clear shapes, subtle texture, uncluttered, no text, no watermark.",
  texture: "Seamless-looking abstract background texture, subtle and low contrast so text stays readable on top, no objects, no text, no watermark.",
  portrait: "Natural, respectful portrait, soft directional light, realistic skin and fabric detail, neutral uncluttered background, no text, no watermark.",
};

export function buildPrompt(input: GenerateInput): string {
  return `${input.prompt.replace(/\s+/g, " ").trim().slice(0, 900)}\n\nStyle requirements: ${STYLE[input.kind]}`;
}

export function createImageTool(deps: Deps) {
  let made = 0;
  return async function generateImageTool(input: GenerateInput): Promise<GenerateResult> {
    if (!input.prompt?.trim()) return { ok: false, message: "Mangler beskrivelse av bildet." };
    if (made >= MAX_IMAGES_PER_REQUEST) {
      return { ok: false, message: `Grensen på ${MAX_IMAGES_PER_REQUEST} genererte bilder per melding er nådd. Bruk bildene du har, eller be brukeren om flere i neste melding.` };
    }
    made++;
    const aspectRatio = input.aspectRatio ?? DEFAULT_ASPECT[input.kind];
    const dims = DIMENSIONS[aspectRatio];
    try {
      const { bytes, mediaType } = await deps.generate({ model: deps.model, prompt: buildPrompt(input), aspectRatio, size: dims.openai });
      const extension = EXTENSION[mediaType];
      if (!extension) return { ok: false, message: `Modellen ga et uventet filformat (${mediaType}).` };
      if (bytes.byteLength > MAX_BYTES) return { ok: false, message: "Bildet ble for stort til å lagres (over 8 MB). Prøv igjen med en enklere beskrivelse." };
      const url = await deps.upload({ path: `${deps.userId}/${deps.newId()}.${extension}`, bytes, mediaType });
      return {
        ok: true,
        message: "Bildet er laget og lagret. Bruk adressen i <img src>.",
        url,
        width: dims.width,
        height: dims.height,
        alt: input.alt?.slice(0, 200) || input.prompt.slice(0, 120),
      };
    } catch (error) {
      return { ok: false, message: friendly(error) };
    }
  };
}

/** Provider errors turned into something the user can act on, without leaking internals. */
export function friendly(error: unknown): string {
  const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}` : String(error);
  if (/credit card|customer_verification_required/i.test(text)) {
    return "AI Gateway trenger et betalingskort på Vercel-teamet for å lage bilder. Legg det inn under AI på vercel.com, og prøv igjen.";
  }
  if (/bucket not found|row-level security|violates.*polic|not allowed/i.test(text)) {
    return "Bildet ble laget, men kunne ikke lagres. Kjør migrasjonen for bildelagring (20261023160000_pivolar_images.sql) i Supabase.";
  }
  if (/safety|content.?policy|blocked|moderation/i.test(text)) return "Modellen avviste beskrivelsen av sikkerhetshensyn. Prøv en annen formulering.";
  if (/rate.?limit|429/i.test(text)) return "For mange forespørsler akkurat nå. Vent litt og prøv igjen.";
  if (/model.*(not found|unavailable)|unknown model|no such model/i.test(text)) return "Bildemodellen finnes ikke. Sjekk IMAGE_MODEL i miljøvariablene.";
  return "Kunne ikke lage bildet akkurat nå. Prøv igjen om litt.";
}
