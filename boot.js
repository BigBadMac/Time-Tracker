// boot.js - evaluate the built app payload with React and a stub DOM, render
// App once, and confirm the platform came up. Not a substitute for Playwright;
// it does prove the file loads, the platform registers, and App still renders.
const fs = require("fs");
const React = require("react");
const win = { addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; } };
const store = new Map();
const localStorage = {
  get length(){ return store.size; },
  key: (i) => Array.from(store.keys())[i],
  getItem: (k) => (store.has(String(k)) ? store.get(String(k)) : null),
  setItem: (k, v) => store.set(String(k), String(v)),
  removeItem: (k) => store.delete(String(k)),
};
const navigator = { vibrate(){}, clipboard: { writeText: () => Promise.resolve() } };
const document = { addEventListener(){}, removeEventListener(){}, getElementById: () => null };
const src = fs.readFileSync(process.argv[2] || "/tmp/app_only.js", "utf8");
const fn = new Function("React", "window", "localStorage", "navigator", "document", "Event",
  src + "\nreturn { App, TT };");
const out = fn(React, win, localStorage, navigator, document, function Event(t){ return { type: t }; });

const ok = [];
ok.push(["module evaluates", typeof out.App === "function"]);
ok.push(["TT exists", !!out.TT]);
ok.push(["contract v1", out.TT && out.TT.version === 1]);
ok.push(["window.TT published", win.TT === out.TT]);
ok.push(["no modules registered", out.TT.modules().length === 0]);
ok.push(["nav empty", out.TT.nav().length === 0]);
ok.push(["boot is a no-op with no modules", out.TT.boot().length === 0]);
ok.push(["report hooks empty", out.TT.reportSections({}).length === 0 && out.TT.reportText({}).length === 0]);

// Render App once through the test renderer path react provides in-tree.
let rendered = null;
try {
  const { renderToStaticMarkup } = require("react-dom/server");
  rendered = renderToStaticMarkup(React.createElement(out.App));
} catch (e) { rendered = "ERR:" + e.message; }
ok.push(["App renders", typeof rendered === "string" && rendered.indexOf("ERR:") !== 0]);
ok.push(["board painted", typeof rendered === "string" && rendered.length > 2000]);
// The settings menu is closed on first paint, so assert on the board itself.
ok.push(["lanes painted", typeof rendered === "string" && rendered.indexOf("Daily Activities") >= 0]);
ok.push(["no module group header leaked onto the board", typeof rendered === "string" && rendered.indexOf(">Modules<") < 0]);
ok.push(["no module overlay mounted", typeof rendered === "string" && rendered.indexOf("data-surface=\"modal\"") < 0]);

let bad = 0;
ok.forEach(([label, pass]) => { if (!pass) { bad++; console.log("   x " + label); } });
console.log("boot       : " + (ok.length - bad) + "/" + ok.length + " passed" + (bad ? "  FAILED" : ""));
if (typeof rendered === "string" && rendered.indexOf("ERR:") === 0) console.log("   " + rendered);
process.exit(bad ? 1 : 0);
