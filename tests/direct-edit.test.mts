import assert from "node:assert/strict";
import { applyClasses, applyText, locate, readStyle, setUtility, stepSize } from "../src/lib/direct-edit.ts";

const app = `import { useState } from "react";
export default function App() {
  const [n, setN] = useState<number>(0);
  return (
    <main className="min-h-screen bg-slate-900">
      <h1 className="text-4xl font-bold text-white">
        Bønna
      </h1>
      <p className="text-slate-400">Beste kaffe i byen</p>
      <button onClick={() => setN(n + 1)} className={"rounded-full px-5 py-2 bg-rose-500"}>Bestill</button>
      <span>Hei</span>
      <div className={clsx("a", n > 1 && "b")}>x</div>
      <ul>
        <li className="p-2">Én</li>
        <li className="p-2">To</li>
      </ul>
    </main>
  );
}
`;
const files = { "/App.tsx": app };

// finds a heading by classes and reads its style
let r = locate(files, { tag: "h1", text: "BØNNA", className: "text-4xl font-bold text-white" });
assert.ok(r.ok);
if (!r.ok) throw 0;
assert.deepEqual(readStyle(r.target.className), { size: "text-4xl", weight: "font-bold", color: "text-white" });
assert.equal(r.target.text, "Bønna");

// text edit keeps indentation
let next = applyText(files, r.target, "Kaffestua");
assert.match(next["/App.tsx"]!, /<h1 className="text-4xl font-bold text-white">\n        Kaffestua\n      <\/h1>/);

// color swap in place
next = applyClasses(files, r.target, setUtility(r.target.className, "color", "text-[#ff8800]"));
assert.match(next["/App.tsx"]!, /className="text-4xl font-bold text-\[#ff8800\]"/);
assert.equal(stepSize("text-4xl font-bold", 1), "text-5xl font-bold");
assert.equal(stepSize("p-2", -1), "p-2 text-sm");

// className in braces
r = locate(files, { tag: "button", text: "Bestill", className: "rounded-full px-5 py-2 bg-rose-500" });
assert.ok(r.ok);
if (r.ok) {
  next = applyClasses(files, r.target, setUtility(r.target.className, "background", "bg-emerald-500"));
  assert.match(next["/App.tsx"]!, /className=\{"rounded-full px-5 py-2 bg-emerald-500"\}/);
}

// element without className gets one
r = locate(files, { tag: "span", text: "Hei", className: "" });
assert.ok(r.ok);
if (r.ok) {
  next = applyClasses(files, r.target, "text-rose-500");
  assert.match(next["/App.tsx"]!, /<span className="text-rose-500">Hei<\/span>/);
  next = applyText(files, r.target, "a {b}");
  assert.match(next["/App.tsx"]!, /<span>\{"a \{b\}"\}<\/span>/);
}

// dynamic className and identical siblings are refused, not guessed
assert.equal(locate(files, { tag: "div", text: "x", className: "a" }).ok, false);
const two = locate(files, { tag: "li", text: "Én", className: "p-2" });
assert.ok(two.ok, "text disambiguates siblings");
if (two.ok) assert.equal(two.target.text, "Én");
assert.equal(locate(files, { tag: "li", text: "Tre", className: "p-2" }).ok, false);
assert.equal(locate({ "/A.tsx": `<p className="x">a</p><p className="x">a</p>` }, { tag: "p", text: "a", className: "x" }).ok, false);

// generics are not tags
assert.equal(locate(files, { tag: "number", text: "", className: "" }).ok, false);
console.log("direct-edit: all ok");
