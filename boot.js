// boot.js - evaluate the built app payload with React and a stub DOM, render
// App once, and confirm the platform came up. Not a substitute for Playwright;
// it does prove the file loads, the platform registers, and App still renders.
// Phase 3 adds the Tool Tracker: this is the only place its screen is rendered
// against the real tokens, the real Modal and the real formatters.
const fs = require("fs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
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
  src + "\nreturn { App, TT: typeof TT !== 'undefined' ? TT : null," +
        " ExtensionsModal: typeof ExtensionsModal !== 'undefined' ? ExtensionsModal : null," +
        " ToolsScreen: typeof ToolsScreen !== 'undefined' ? ToolsScreen : null," +
        " ToolsCheckoutSheet: typeof ToolsCheckoutSheet !== 'undefined' ? ToolsCheckoutSheet : null," +
        " ToolsEditorSheet: typeof ToolsEditorSheet !== 'undefined' ? ToolsEditorSheet : null };");
const out = fn(React, win, localStorage, navigator, document, function Event(t){ return { type: t }; });

const ok = [];
const has = (hay, needle, label) => ok.push([label, hay.indexOf(needle) >= 0]);
const hasnt = (hay, needle, label) => ok.push([label, hay.indexOf(needle) < 0]);

ok.push(["module evaluates", typeof out.App === "function"]);
ok.push(["TT exists", !!out.TT]);
ok.push(["contract v1", out.TT && out.TT.version === 1]);
ok.push(["window.TT published", win.TT === out.TT]);

// ---- what ships in this build ----
const mods = out.TT.modules();
ok.push(["exactly one module ships", mods.length === 1]);
ok.push(["and it is Tool Tracker", mods[0] && mods[0].id === "tools"]);
ok.push(["off until the user says otherwise", out.TT.isEnabled("tools") === false]);
ok.push(["so the settings menu has no module row", out.TT.nav().length === 0]);
ok.push(["and Reports is unchanged", out.TT.reportSections({}).length === 0 && out.TT.reportText({}).length === 0]);

// ---- boot normalizers run for a module that is switched off ----
const ran = out.TT.boot();
ok.push(["the tools normalizer ran at boot", ran.indexOf("tools") >= 0]);
ok.push(["it laid down its empty shape", localStorage.getItem("tt_mod_tools_tools") === "[]"]);
ok.push(["stamped its schema", localStorage.getItem("tt_mod_tools_schema") === "1"]);
ok.push(["and wrote nothing outside its namespace",
  Array.from(store.keys()).every((k) => k.indexOf("tt_mod_tools_") === 0)]);

// ---- the Extensions screen sees it ----
try {
  const ext = renderToStaticMarkup(React.createElement(out.ExtensionsModal, { onClose(){}, onChange(){} }));
  has(ext, "Tool Tracker", "Extensions lists Tool Tracker");
  has(ext, "v1", "shows its version");
  has(ext, "Delete data", "offers to delete its data");
  ok.push(["and it reads as Off", /aria-checked="true"[^>]*>Off</.test(ext)]);
} catch (e) { ok.push(["Extensions renders", false]); console.log("   " + e.message); }

// ---- switch it on ----
out.TT.setEnabled("tools", true);
const nav = out.TT.nav();
ok.push(["the menu row appears", nav.length === 1 && nav[0].label === "Tools"]);
ok.push(["under the Modules group", nav[0] && nav[0].group === "Modules"]);
const Screen = out.TT.screen("tools", nav[0] ? nav[0].screen : "main");
ok.push(["nav.screen resolves to a component", typeof Screen === "function"]);

// ---- the Tools screen, for real ----
const HOUR = 3600000, T0 = Date.now() - 5 * HOUR;
const st = out.TT.storage("tools");
st.set("tools", [
  { id: "t1", name: "Torque Wrench", tag: "TW-04", category: "Hand tools", notes: "", createdAt: T0 },
  { id: "t2", name: "Digital Caliper", tag: "", category: "", notes: "", createdAt: T0 }
]);
st.set("checkouts", [
  { id: "c1", toolId: "t1", toolName: "Torque Wrench", holder: "Brent", projectId: 2,
    projectName: "Laminating", note: "line 3", out: T0 + HOUR, in: null },
  { id: "c2", toolId: "t2", toolName: "Digital Caliper", holder: "", projectId: null,
    projectName: "", note: "", out: T0, in: T0 + HOUR }
]);
const projects = [
  { id: 1, name: "Label Printing", lane: "Daily Activity", parentId: null, order: 0, stages: [] },
  { id: 2, name: "Laminating", lane: "Daily Activity", parentId: null, order: 1, stages: [] },
  { id: 3, name: "Trim pass", lane: "Daily Activity", parentId: 2, order: 0, stages: [] }
];
const hostCtx = { projects, logs: [], laneMeta: null, laneOrder: ["Daily Activity"],
  testMode: false, schedule: null, activeId: 2, activeName: "Laminating", onClose(){} };

let screen = "";
try {
  screen = renderToStaticMarkup(React.createElement(Screen, out.TT.context("tools", hostCtx)));
} catch (e) { screen = "ERR:" + e.message; }
ok.push(["the Tools screen renders", screen.indexOf("ERR:") !== 0]);
if (screen.indexOf("ERR:") === 0) console.log("   " + screen);
has(screen, ">Tools<", "titled Tools");
has(screen, "1 tool out", "the summary counts what is out");
has(screen, "2 tools tracked", "and how many are tracked");
has(screen, "Torque Wrench", "the open checkout is listed");
has(screen, "Laminating", "against its job");
has(screen, "Brent", "and who has it");
has(screen, "line 3", "with the note");
has(screen, "Check in", "offering to check it back in");
hasnt(screen, "Digital Caliper", "a returned tool is not on the Out tab");
has(screen, "History", "the History tab is offered");
ok.push(["it mounts one modal, not two", (screen.match(/data-surface="modal"/g) || []).length === 1]);
ok.push(["and invents no layer above the core modal", !/z-index:9[1-9][0-9]/.test(screen)]);

// The sheets, rendered directly, since their open state lives inside the screen.
let sheet = "";
try {
  sheet = renderToStaticMarkup(React.createElement(out.ToolsCheckoutSheet, {
    ctx: out.TT.context("tools", hostCtx), projects,
    draft: { tool: { id: "t2", name: "Digital Caliper" }, holder: "Brent", projectId: 2, note: "" },
    onChange(){}, onCancel(){}, onSave(){} }));
} catch (e) { sheet = "ERR:" + e.message; }
ok.push(["the checkout sheet renders", sheet.indexOf("ERR:") !== 0]);
if (sheet.indexOf("ERR:") === 0) console.log("   " + sheet);
has(sheet, "Digital Caliper", "named for the tool being taken");
has(sheet, "No job", "a checkout may have no job");
has(sheet, "Label Printing", "every project is offered");
has(sheet, "Trim pass", "sub-tasks included");
has(sheet, "Check Out", "and the primary action says so");

let editor = "";
try {
  editor = renderToStaticMarkup(React.createElement(out.ToolsEditorSheet, {
    ctx: out.TT.context("tools", hostCtx),
    draft: { id: "t1", name: "Torque Wrench", tag: "TW-04", category: "Hand tools", notes: "" },
    onChange(){}, onCancel(){}, onSave(){}, onDelete(){} }));
} catch (e) { editor = "ERR:" + e.message; }
ok.push(["the editor sheet renders", editor.indexOf("ERR:") !== 0]);
has(editor, "Edit Tool", "titled for editing an existing tool");
has(editor, "Remove this tool", "with a way out");

// ---- Reports contribution ----
const range = { start: T0 - HOUR, end: Date.now() };
const lines = out.TT.reportText({ kind: "day", range, now: Date.now() });
ok.push(["Reports gains tool lines", lines.length === 3 && /^Tool checkouts: 2$/.test(lines[0])]);
ok.push(["including what is still out", /^Still out: 1 \(Torque Wrench\)$/.test(lines[2])]);
const secs = out.TT.reportSections({ kind: "day", range, now: Date.now() });
ok.push(["and a section element", secs.length === 1 && secs[0].id === "tools"]);
let secHtml = "";
try { secHtml = renderToStaticMarkup(secs[0].el); } catch (e) { secHtml = "ERR:" + e.message; }
has(secHtml, "2 checkouts", "the section counts them");
has(secHtml, "1 still out", "and flags the one outstanding");

// Back off again for the App render: the board must look exactly as it did.
out.TT.setEnabled("tools", false);

// ---- App still renders, unchanged ----
let rendered = null;
try { rendered = renderToStaticMarkup(React.createElement(out.App)); }
catch (e) { rendered = "ERR:" + e.message; }
ok.push(["App renders", typeof rendered === "string" && rendered.indexOf("ERR:") !== 0]);
ok.push(["board painted", typeof rendered === "string" && rendered.length > 2000]);
ok.push(["lanes painted", typeof rendered === "string" && rendered.indexOf("Daily Activities") >= 0]);
ok.push(["no module group header leaked onto the board", typeof rendered === "string" && rendered.indexOf(">Modules<") < 0]);
ok.push(["no module overlay mounted", typeof rendered === "string" && rendered.indexOf("data-surface=\"modal\"") < 0]);

// ---- the board, with real logs and disruptions behind it ----
// The badge arithmetic is unit-tested; this proves the wiring reaches the card.
// Anchored to the start of today rather than to "an hour ago": run this at
// 00:18 and an hour ago is yesterday, which used to fail the fixture rather
// than the code.
const DAY = 86400000, NOW = Date.now();
const T = new Date(); T.setHours(0, 1, 0, 0);
const TODAY0 = T.getTime();
const dayOf = (t) => new Date(t).toDateString();
store.clear();
localStorage.setItem("tt_projects", JSON.stringify([
  { id: 1, name: "Label Printing", lane: "Daily Activity", notes: "", order: 0, parentId: null, stages: [] },
  { id: 2, name: "Trim pass", lane: "Daily Activity", notes: "", order: 0, parentId: 1, stages: [] },
  { id: 3, name: "Laminating", lane: "Daily Activity", notes: "", order: 1, parentId: null, stages: [] }
]));
localStorage.setItem("tt_lane_order", JSON.stringify(["Daily Activity"]));
localStorage.setItem("tt_logs", JSON.stringify([
  { id: "l1", projectId: 1, projectName: "Label Printing", lane: "Daily Activity",
    type: "project", startTime: TODAY0, endTime: TODAY0 + 3600000, duration: 3600000,
    parentId: null, parentName: null }
]));
// Two today (10m + 5m on the parent, 4m on the sub-task) and two from days ago.
localStorage.setItem("tt_disruptions", JSON.stringify([
  { id: "d1", projectId: 1, projectName: "Label Printing", startTime: TODAY0 + 60000,  endTime: TODAY0 + 660000,  duration: 600000 },
  { id: "d2", projectId: 1, projectName: "Label Printing", startTime: TODAY0 + 120000, endTime: TODAY0 + 420000,  duration: 300000 },
  { id: "d3", projectId: 2, projectName: "Trim pass",      startTime: TODAY0 + 180000, endTime: TODAY0 + 420000,  duration: 240000 },
  { id: "d4", projectId: 1, projectName: "Label Printing", startTime: NOW - 3 * DAY, endTime: NOW - 3 * DAY + 900000, duration: 900000 },
  { id: "d5", projectId: 2, projectName: "Trim pass",      startTime: NOW - 5 * DAY, endTime: NOW - 5 * DAY + 600000, duration: 600000 },
  { id: "d6", projectId: 3, projectName: "Laminating",     startTime: NOW - 9 * DAY, endTime: NOW - 9 * DAY + 60000, duration: 60000 }
]));
ok.push(["fixture disruptions really do straddle the day boundary",
  [TODAY0 + 60000, TODAY0 + 120000, TODAY0 + 180000].every((t) => dayOf(t) === dayOf(NOW)) &&
  [NOW - 3 * DAY, NOW - 5 * DAY, NOW - 9 * DAY].every((t) => dayOf(t) !== dayOf(NOW))]);

let board = "";
try { board = renderToStaticMarkup(React.createElement(out.App)); }
catch (e) { board = "ERR:" + e.message; }
ok.push(["the seeded board renders", board.indexOf("ERR:") !== 0]);
if (board.indexOf("ERR:") === 0) console.log("   " + board);
const badges = board.match(/aria-label="Disruptions: [^"]*"/g) || [];
ok.push(["every disrupted project carries a badge", badges.length === 3]);
has(board, 'aria-label="Disruptions: 3 today, 5 in total"', "the parent rolls up its sub-task, today and lifetime");
has(board, 'aria-label="Disruptions: 1 today, 2 in total"', "the sub-task reports only its own");
has(board, 'aria-label="Disruptions: 0 today, 1 in total"',
  "a project disrupted only in the past still shows its history on a clean day");
// Parent = its own 10m + 5m plus the sub-task's 4m, so 19m today; lifetime adds
// the 15m from three days ago and the sub-task's 10m from five days ago.
has(board, ">3 19m 00s<", "today's lost time on the parent, rolled up");
has(board, ">5 44m 00s<", "and the lifetime total beside it");
has(board, ">1 4m 00s<", "the sub-task's own figure for today");
has(board, ">2 14m 00s<", "and its own lifetime total");
ok.push(["the running total is never smaller than today's figure",
  badges.every((b) => {
    const m = b.match(/(\d+) today, (\d+) in total/);
    return m && Number(m[1]) <= Number(m[2]);
  })]);

// ---- collapsing a card, at every level ----
// The collapsed pill is an early return that reads variables declared further
// down the component. `var` hoists the name and not the value, so from up there
// they were undefined and minimising a nested card threw.
const P = (id, n, pid, o, role) => ({ id: id, name: n, lane: "Projects", notes: "",
  order: o || 0, parentId: pid, role: role || "project", kind: "finite", stages: [] });
[["nothing", {}], ["the parent", { 1: true }], ["the nested card", { 2: true }],
 ["both", { 1: true, 2: true }]].forEach(([label, collapsed]) => {
  store.clear();
  localStorage.setItem("tt_projects", JSON.stringify([
    P(1, "Top", null), P(2, "Nested Proj", 1, 0), P(3, "A Task", 1, 1, "task")]));
  localStorage.setItem("tt_lane_order", JSON.stringify(["Projects"]));
  localStorage.setItem("tt_cardcollapse", JSON.stringify(collapsed));
  let out2 = "";
  try { out2 = renderToStaticMarkup(React.createElement(out.App)); }
  catch (e) { out2 = "ERR:" + e.message; }
  ok.push(["collapsing " + label + " does not throw", out2.indexOf("ERR:") !== 0]);
  if (out2.indexOf("ERR:") === 0) console.log("   " + out2);
  // Collapsing hides a card's own steps; it must never hide a nested project.
  ok.push(["a nested project survives collapsing " + label, out2.indexOf(">Nested Proj<") >= 0]);
});

let bad = 0;
ok.forEach(([label, pass]) => { if (!pass) { bad++; console.log("   x " + label); } });
console.log("boot       : " + (ok.length - bad) + "/" + ok.length + " passed" + (bad ? "  FAILED" : ""));
if (typeof rendered === "string" && rendered.indexOf("ERR:") === 0) console.log("   " + rendered);
process.exit(bad ? 1 : 0);
