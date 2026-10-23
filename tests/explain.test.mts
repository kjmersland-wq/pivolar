import assert from "node:assert/strict";
import { explainError } from "../src/lib/explain/errors.ts";

const id = (raw: string) => explainError(raw)?.id ?? null;

// --- code errors a model can fix
assert.equal(id("ReferenceError: Hero is not defined"), "not-defined");
assert.match(explainError("ReferenceError: Hero is not defined")!.summary, /«Hero» brukes i koden/);
assert.equal(id("TypeError: Cannot read properties of undefined (reading 'map')"), "read-undefined");
assert.match(explainError("TypeError: Cannot read properties of undefined (reading 'map')")!.summary, /«map»/);
assert.equal(id("Cannot read properties of null (reading 'name')"), "read-undefined");
assert.equal(id("Error: Element type is invalid: expected a string (for built-in components) or a class/function but got: undefined."), "element-type");
assert.equal(id("TypeError: items.map is not a function"), "not-a-function");
assert.match(explainError("TypeError: items.map is not a function")!.summary, /«items\.map»/);
assert.equal(id("Error: Objects are not valid as a React child (found: object with keys {a, b})"), "react-child");
assert.equal(id("Error: Too many re-renders. React limits the number of renders to prevent an infinite loop."), "rerender-loop");
assert.equal(id("Warning: Maximum update depth exceeded."), "rerender-loop");
assert.equal(id("Error: Invalid hook call. Hooks can only be called inside of the body of a function component."), "invalid-hook");
assert.equal(id("Warning: Each child in a list should have a unique \"key\" prop."), "list-key");
assert.equal(id("/App.tsx: Unexpected token (12:4)\n\n  10 | return ("), "syntax");
assert.equal(id("SyntaxError: Unterminated string constant"), "syntax");
assert.equal(id("/components/Hero.tsx: Adjacent JSX elements must be wrapped in an enclosing tag (30:5)"), "syntax");
assert.equal(id("TS2322: Type 'string' is not assignable to type 'number'."), "types");
assert.equal(id("TypeError: Failed to fetch"), "network");
for (const fixable of ["not-defined", "read-undefined", "syntax", "network"]) {
  const sample = { "not-defined": "Foo is not defined", "read-undefined": "Cannot read properties of undefined (reading 'x')", syntax: "Unexpected token", network: "Failed to fetch" }[fixable]!;
  assert.equal(explainError(sample)!.aiFixable, true, fixable);
}

// --- missing modules: files, allowed packages and packages the preview cannot use
{
  const file = explainError("Could not find module './components/Hero' in '/App.tsx'");
  assert.equal(file?.id, "package-missing");
  assert.match(file!.summary, /Filen «\.\/components\/Hero» finnes ikke/);
  const pkg = explainError("Could not find module 'axios'");
  assert.match(pkg!.summary, /Pakken «axios» er ikke tilgjengelig/);
  assert.match(pkg!.cause, /react, react-dom, lucide-react, framer-motion/, "lists what is allowed");
  assert.match(pkg!.hint, /bare tillatte pakker/);
  const typo = explainError("Failed to resolve import 'lucide-react/icons/nonexistent'");
  assert.match(typo!.cause, /skrevet feil/, "a sub-path of an allowed package is a typo, not a missing package");
  assert.equal(explainError("Cannot find module \"recharts\"")!.id, "package-missing");
}

// --- problems the code cannot fix say so, and what to do instead
{
  const cors = explainError("Access to fetch at 'https://api.x.com' from origin 'https://abc.codesandbox.io' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header");
  assert.equal(cors?.id, "cors");
  assert.equal(cors!.aiFixable, false);
  assert.match(cors!.cause, /ikke løses ved å endre appens/);
  assert.match(cors!.hint, /Ikke prøv å omgå/);
  const rls = explainError("new row violates row-level security policy for table \"projects\"");
  assert.equal(rls?.id, "rls");
  assert.equal(rls!.aiFixable, false);
  assert.match(rls!.steps.join(" "), /owner_id = auth\.uid\(\)/);
  assert.match(rls!.steps.join(" "), /Ikke gjør tabellen åpen/);
  assert.equal(id("PostgrestError: permission denied for table users (code 42501)"), "rls");
  assert.equal(id("AuthApiError: Invalid login credentials"), "auth-key");
  assert.equal(id("Invalid API key"), "auth-key");
  assert.equal(explainError("JWT expired")!.aiFixable, false);
}

// --- where it happened
assert.equal(explainError("/components/Hero.tsx: Unexpected token (31:12)")!.where, "/components/Hero.tsx, linje 31");
assert.equal(explainError("ReferenceError: x is not defined")!.where, undefined);

// --- unknown and empty messages are left alone
assert.equal(explainError("Something completely unexpected happened"), null);
assert.equal(explainError("   "), null);
assert.equal(explainError(""), null);

// --- every explanation is complete
for (const sample of [
  "Foo is not defined", "Cannot read properties of undefined (reading 'a')", "Element type is invalid: got: undefined", "x.y is not a function",
  "Objects are not valid as a React child", "Too many re-renders", "Invalid hook call", "Unexpected token", "CORS", "row-level security", "Invalid API key",
  "Failed to fetch", "TS2345: bad", "Could not find module 'x'", "unique \"key\" prop",
]) {
  const e = explainError(sample)!;
  assert.ok(e.summary && e.cause && e.hint && e.steps.length > 0, sample);
  assert.ok(e.summary.endsWith(".") || e.summary.endsWith(")."), `${sample}: summary is a sentence`);
}

console.log("explain: all ok");
