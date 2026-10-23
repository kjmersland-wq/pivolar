import { ImageResponse } from "next/og";
import { mix, readableOn, rgba, type Brand } from "./brand.ts";
import { loadOgFonts } from "./fonts.ts";

const W = 1200;
const H = 630;

type Props = { brand: Brand; logo: string | null };

/** Logo mark, or a plain rounded block when the project has none. */
function Mark({ logo, size, color }: { logo: string | null; size: number; color: string }) {
  return logo ? (
    // eslint-disable-next-line @next/next/no-img-element -- rendered to a PNG by satori, not shown in a page
    <img src={logo} alt="" width={size} height={size} style={{ objectFit: "contain" }} />
  ) : (
    <div style={{ width: size, height: size, borderRadius: size / 4, background: color, display: "flex" }} />
  );
}

/** Dark, deep and quiet: tinted near-black, two soft colour glows, a hairline frame and a glass logo tile. */
function Aurora({ brand, logo }: Props) {
  const base = mix("#08080d", brand.primary, 0.07);
  const size = brand.name.length > 22 ? 84 : brand.name.length > 14 ? 100 : 116;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        backgroundColor: base,
        backgroundImage: [
          `radial-gradient(circle at 14% 8%, ${rgba(brand.primary, 0.6)} 0%, ${rgba(brand.primary, 0)} 46%)`,
          `radial-gradient(circle at 96% 100%, ${rgba(brand.secondary, 0.5)} 0%, ${rgba(brand.secondary, 0)} 52%)`,
          `radial-gradient(circle at 78% 18%, ${rgba(brand.secondary, 0.14)} 0%, ${rgba(brand.secondary, 0)} 34%)`,
        ].join(", "),
      }}
    >
      <div style={{ position: "absolute", left: 28, top: 28, right: 28, bottom: 28, borderRadius: 34, border: "1px solid rgba(255,255,255,0.14)", display: "flex" }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "84px 92px" }}>
        <div style={{ display: "flex", width: 112, height: 112, alignItems: "center", justifyContent: "center", borderRadius: 30, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.18)" }}>
          <Mark logo={logo} size={68} color="rgba(255,255,255,0.9)" />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ width: 72, height: 5, borderRadius: 3, backgroundImage: `linear-gradient(90deg, ${brand.primary}, ${brand.secondary})`, display: "flex" }} />
          <div style={{ marginTop: 34, fontFamily: "Heading", fontSize: size, lineHeight: 1.02, letterSpacing: -size * 0.03, color: "#ffffff", display: "flex" }}>{brand.name}</div>
          {brand.tagline && (
            <div style={{ marginTop: 26, fontFamily: "Body", fontSize: 36, lineHeight: 1.3, color: "rgba(255,255,255,0.68)", display: "flex", maxWidth: 900 }}>{brand.tagline}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Light and editorial: warm paper, a huge serif or grotesk name, one accent bar. */
function Editorial({ brand, logo }: Props) {
  const paper = mix("#f6f2ea", brand.primary, 0.05);
  const size = brand.name.length > 22 ? 92 : brand.name.length > 14 ? 112 : 132;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        backgroundColor: paper,
        backgroundImage: `radial-gradient(circle at 100% 0%, ${rgba(brand.secondary, 0.16)} 0%, ${rgba(brand.secondary, 0)} 42%)`,
      }}
    >
      <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 18, backgroundColor: brand.primary, display: "flex" }} />
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: "76px 92px 76px 110px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Mark logo={logo} size={72} color={brand.primary} />
          <div style={{ display: "flex", width: 160, height: 2, backgroundColor: rgba("#14110f", 0.18) }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "Heading", fontSize: size, lineHeight: 1, letterSpacing: -size * 0.035, color: "#14110f", display: "flex" }}>{brand.name}</div>
          <div style={{ marginTop: 34, width: 120, height: 6, backgroundColor: brand.primary, display: "flex" }} />
          {brand.tagline && (
            <div style={{ marginTop: 30, fontFamily: "Body", fontSize: 36, lineHeight: 1.3, color: "#5b554d", display: "flex", maxWidth: 900 }}>{brand.tagline}</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Vivid: the brand gradient with a soft highlight, for brands that should feel loud. */
function Vivid({ brand, logo }: Props) {
  const ink = readableOn(mix(brand.primary, brand.secondary, 0.5));
  const size = brand.name.length > 22 ? 84 : brand.name.length > 14 ? 100 : 120;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        position: "relative",
        color: ink,
        backgroundImage: [
          `radial-gradient(circle at 12% 6%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 40%)`,
          `linear-gradient(135deg, ${brand.primary} 0%, ${brand.secondary} 100%)`,
        ].join(", "),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", width: "100%", height: "100%", padding: 84 }}>
        <div style={{ display: "flex", width: 104, height: 104, alignItems: "center", justifyContent: "center", borderRadius: 28, background: "rgba(255,255,255,0.22)", border: "1px solid rgba(255,255,255,0.4)" }}>
          <Mark logo={logo} size={64} color={ink} />
        </div>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontFamily: "Heading", fontSize: size, lineHeight: 1.02, letterSpacing: -size * 0.03, display: "flex" }}>{brand.name}</div>
          {brand.tagline && <div style={{ marginTop: 24, fontFamily: "Body", fontSize: 38, lineHeight: 1.28, opacity: 0.86, display: "flex", maxWidth: 900 }}>{brand.tagline}</div>}
        </div>
      </div>
    </div>
  );
}

const STYLES = { aurora: Aurora, editorial: Editorial, vivid: Vivid } as const;

/** 1200x630 share image (Open Graph / Twitter card) drawn from the project's brand. Returns PNG bytes. */
export async function renderOgImage(brand: Brand): Promise<Uint8Array> {
  const logo = brand.logoSvg ? `data:image/svg+xml;base64,${Buffer.from(brand.logoSvg, "utf8").toString("base64")}` : null;
  const { fonts } = await loadOgFonts(brand.headingFont);
  const Layout = STYLES[brand.ogStyle];
  const response = new ImageResponse(<Layout brand={brand} logo={logo} />, { width: W, height: H, fonts });
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Square app icon for the home screen, drawn from the brand: the logo on the brand gradient, or the
 * first letter of the name when there is no logo. A maskable icon keeps the mark inside the centre
 * 60 %, because phones crop it to a circle or squircle.
 */
export async function renderIcon(brand: Brand, size: number, maskable = false): Promise<Uint8Array> {
  const logo = brand.logoSvg ? `data:image/svg+xml;base64,${Buffer.from(brand.logoSvg, "utf8").toString("base64")}` : null;
  const { fonts } = await loadOgFonts(brand.headingFont);
  const ink = readableOn(mix(brand.primary, brand.secondary, 0.5));
  const mark = Math.round(size * (maskable ? 0.4 : 0.56));
  const letter = (brand.name.trim()[0] ?? "P").toUpperCase();
  const response = new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: ink,
          borderRadius: maskable ? 0 : size * 0.22,
          backgroundImage: `linear-gradient(135deg, ${brand.primary} 0%, ${brand.secondary} 100%)`,
        }}
      >
        {logo ? <Mark logo={logo} size={mark} color={ink} /> : <div style={{ fontFamily: "Heading", fontSize: mark, lineHeight: 1, display: "flex" }}>{letter}</div>}
      </div>
    ),
    { width: size, height: size, fonts },
  );
  return new Uint8Array(await response.arrayBuffer());
}
