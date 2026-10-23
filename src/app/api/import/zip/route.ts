import { analyze } from "@/lib/zip/analyze";
import { ImportError, LIMITS, readZip } from "@/lib/zip/read";

/**
 * Reads a ZIP sent as the raw request body, checks it and returns the text files with a report.
 * The archive stays in memory: it is never written to disk, extracted to a folder or executed.
 */
export async function POST(request: Request) {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > LIMITS.archiveBytes) {
    return Response.json({ error: `Arkivet er for stort (maks ${LIMITS.archiveBytes / 1_000_000} MB).` }, { status: 413 });
  }
  try {
    const data = new Uint8Array(await request.arrayBuffer());
    const result = readZip(data);
    return Response.json({ ...result, report: analyze(result.files) });
  } catch (error) {
    if (error instanceof ImportError) return Response.json({ error: error.message }, { status: 400 });
    return Response.json({ error: "Importen feilet uventet." }, { status: 500 });
  }
}
