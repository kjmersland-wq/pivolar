/**
 * Stops the model from burning money in circles. Looks at the tool calls made so far in one
 * request and says when they have stopped getting anywhere: the same edit failing again and again,
 * a long run of failures, the same change written over and over, or a request that has used far
 * more than a request normally does.
 */

export type StepLike = {
  toolResults?: { toolName: string; input?: unknown; output?: unknown }[];
  usage?: { inputTokens?: number | undefined; outputTokens?: number | undefined };
};

export type LoopFinding = { kind: "repeat-failure" | "failure-streak" | "no-progress" | "token-cap"; message: string };

export const LIMITS = {
  /** The same tool on the same file has failed this many times. */
  sameFailure: 3,
  /** This many tool calls in a row have failed. */
  failureStreak: 4,
  /** The same change has been made this many times. */
  sameCall: 3,
  /** Input plus output tokens in one request. A normal request is well under a tenth of this. */
  tokens: 1_500_000,
};

/** Tools that change files. Only these count: a search that finds nothing is not a failure. */
const FILE_TOOLS = new Set(["writeFile", "editFile", "deleteFile"]);
const WRITE_OR_READ = new Set([...FILE_TOOLS, "readFile"]);

type Call = { tool: string; path: string; failed: boolean; key: string };

function calls(steps: StepLike[]): Call[] {
  const out: Call[] = [];
  for (const step of steps) {
    for (const result of step.toolResults ?? []) {
      if (!WRITE_OR_READ.has(result.toolName)) continue;
      const input = (result.input ?? {}) as { path?: unknown };
      const path = typeof input.path === "string" ? input.path : "";
      const failed = typeof result.output === "object" && result.output !== null && (result.output as { ok?: unknown }).ok === false;
      out.push({ tool: result.toolName, path, failed, key: `${result.toolName}:${JSON.stringify(result.input ?? {})}` });
    }
  }
  return out;
}

const STOP = "Si hva som skal skje videre, for eksempel «les filen først og prøv igjen», eller beskriv hva som er feil.";

export function detectLoop(steps: StepLike[]): LoopFinding | null {
  const all = calls(steps);

  const failures = new Map<string, number>();
  for (const call of all) {
    if (!call.failed) continue;
    const key = `${call.tool} ${call.path}`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }
  for (const [key, count] of failures) {
    if (count >= LIMITS.sameFailure) {
      const [tool, path] = key.split(" ");
      return { kind: "repeat-failure", message: `Jeg stoppet for å spare kreditten din: ${tool === "editFile" ? "endringen" : "operasjonen"} på ${path || "en fil"} har mislyktes ${count} ganger. ${STOP}` };
    }
  }

  const tail = all.filter((c) => FILE_TOOLS.has(c.tool) || c.tool === "readFile").slice(-LIMITS.failureStreak);
  if (tail.length === LIMITS.failureStreak && tail.every((c) => c.failed)) {
    return { kind: "failure-streak", message: `Jeg stoppet for å spare kreditten din: de siste ${LIMITS.failureStreak} filoperasjonene mislyktes på rad. ${STOP}` };
  }

  const same = new Map<string, number>();
  for (const call of all) {
    if (call.failed || !FILE_TOOLS.has(call.tool)) continue;
    same.set(call.key, (same.get(call.key) ?? 0) + 1);
  }
  for (const [key, count] of same) {
    if (count >= LIMITS.sameCall) {
      const path = (JSON.parse(key.slice(key.indexOf(":") + 1)) as { path?: string }).path ?? "en fil";
      return { kind: "no-progress", message: `Jeg stoppet for å spare kreditten din: den samme endringen i ${path} er gjort ${count} ganger uten at noe nytt skjer. ${STOP}` };
    }
  }

  const tokens = steps.reduce((sum, s) => sum + (s.usage?.inputTokens ?? 0) + (s.usage?.outputTokens ?? 0), 0);
  if (tokens > LIMITS.tokens) {
    return { kind: "token-cap", message: `Jeg stoppet for å spare kreditten din: denne meldingen har brukt uvanlig mye (over ${Math.round(LIMITS.tokens / 1000)} 000 tokens). ${STOP}` };
  }
  return null;
}

type Chunk = { type: string; [key: string]: unknown };

/**
 * Adds a note to the end of a UI message stream, as a step of its own just before the final
 * "finish" chunk, so the user sees why the request stopped. `note` is read when the stream ends,
 * so it can be set while the request runs.
 */
export function withNoteBeforeFinish(stream: ReadableStream<Chunk>, note: () => string | null): ReadableStream<Chunk> {
  const noteChunks = (text: string): Chunk[] => {
    const id = `loop-guard-${Date.now()}`;
    return [{ type: "start-step" }, { type: "text-start", id }, { type: "text-delta", id, delta: text }, { type: "text-end", id }, { type: "finish-step" }];
  };
  return stream.pipeThrough(
    new TransformStream<Chunk, Chunk>({
      transform(chunk, controller) {
        if (chunk.type === "finish") {
          const text = note();
          if (text) for (const c of noteChunks(`\n\n⚠️ ${text}`)) controller.enqueue(c);
        }
        controller.enqueue(chunk);
      },
    }),
  );
}
