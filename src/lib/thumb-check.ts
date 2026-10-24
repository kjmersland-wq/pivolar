/**
 * A project's thumbnail is a small JPEG the preview draws of itself and sends up as text. That text
 * comes from code the AI wrote, so it is checked before it is ever used as a picture address.
 */
export const THUMB_MAX_CHARS = 160_000;

export function validThumb(value: unknown): value is string {
  return typeof value === "string" && value.length >= 200 && value.length <= THUMB_MAX_CHARS && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
}
