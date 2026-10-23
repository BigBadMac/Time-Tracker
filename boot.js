// boot.js - evaluate the built app payload with React and a stub DOM, render
// App once, and confirm the platform came up.
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
        " DB: typeof ttDbUse !== 'undefined' ? { use: ttDbUse, db: ttDb, load: load, save: save } : null," +
        " ExtensionsModal: typeof ExtensionsModal !== 'undefined' ? ExtensionsModal : null," +
        " ToolsScreen: typeof ToolsScreen !== 'undefined' ? ToolsScreen : null," +
        " ToolsCheckoutSheet: typeof ToolsCheckoutSheet !== 'undefined' ? ToolsCheckoutSheet : null," +
        " ToolsEditorSheet: typeof ToolsEditorSheet !== 'undefined' ? ToolsEditorSheet : null," +
        " BRK: typeof BreakOverModal !== 'undefined' ? { Sheet: BreakModal, Over: BreakOverModal, Resume: BreakResumeModal, Missed: MissedBreakBanner," +
        "   OverBanner: BreakOverBanner, Ticker: HeaderTicker, Sched: UnpaidBreaksModal, Pay: PayWorkWeekModal, defaults: BREAK_DEFAULTS," +
        "   rules: BREAK_RULES_NOTE, personal: PERSONAL_NOTE, norm: normalizeSchedule, lines: breakTextLines, tally: breakTally } : null," +
        " HELP: typeof HELP_PICTURES !== 'undefined' ? { pictures: HELP_PICTURES, guides: HELP_GUIDES, index: HELP_INDEX, practice: HELP_PRACTICE, panels: HELP_PANELS," +
        "   search: typeof helpSearch !== 'undefined' ? helpSearch : null, all: typeof helpAll !== 'undefined' ? helpAll : null, stageEl: helpStageEl, Guides: GuidesModal, TryHold: HelpTryHold, seed: TEST_PROJECTS } : null };");
const out = fn(React, win, localStorage, navigator, document, function Event(t){ return { type: t }; });

const ok = [];
const has = (hay, needle, label) => ok.push([label, hay.indexOf(needle) >= 0]);
const hasnt = (hay, needle, label) => ok.push([label, hay.indexOf(needle) < 0]);

ok.push(["module evaluates", typeof out.App === "function"]);
ok.push(["TT exists", !!out.TT]);
ok.push(["contract v1", out.TT && out.TT.version === 1]);
ok.push(["window.TT published", win.TT === out.TT]);

const mods = out.TT.modules();
ok.push(["exactly one module ships", mods.length === 1]);
ok.push(["and it is Tool Tracker", mods[0] && mods[0].id === "tools"]);
ok.push(["off until the user says otherwise", out.TT.isEnabled("tools") === false]);
ok.push(["so the settings menu has no module row", out.TT.nav().length === 0]);
ok.push(["and Reports is unchanged", out.TT.reportSections({}).length === 0 && out.TT.reportText({}).length === 0]);

const ran = out.TT.boot();
ok.push(["the tools normalizer ran at boot", ran.indexOf("tools") >= 0]);
ok.push(["it laid down its empty shape", localStorage.getItem("tt_mod_tools_tools") === "[]"]);
ok.push(["stamped its schema", localStorage.getItem("tt_mod_tools_schema") === "1"]);
ok.push(["and wrote nothing outside its namespace",
  Array.from(store.keys()).every((k) => k.indexOf("tt_mod_tools_") === 0)]);

try {
  const ext = renderToStaticMarkup(React.createElement(out.ExtensionsModal, { onClose(){}, onChange(){} }));
  has(ext, "Tool Tracker", "Extensions lists Tool Tracker");
  has(ext, "v1", "shows its version");
  has(ext, "Delete data", "offers to delete its data");
  ok.push(["and it reads as Off", /aria-checked="true"[^>]*>Off</.test(ext)]);
} catch (e) { ok.push(["Extensions renders", false]); console.log("   " + e.message); }

out.TT.setEnabled("tools", true);
const nav = out.TT.nav();
ok.push(["the menu row appears", nav.length === 1 && nav[0].label === "Tools"]);
ok.push(["under the Modules group", nav[0] && nav[0].group === "Modules"]);
const Screen = out.TT.screen("tools", nav[0] ? nav[0].screen : "main");
ok.push(["nav.screen resolves to a component", typeof Screen === "function"]);

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

out.TT.setEnabled("tools", false);

let rendered = null;
try { rendered = renderToStaticMarkup(React.createElement(out.App)); }
catch (e) { rendered = "ERR:" + e.message; }
ok.push(["App renders", typeof rendered === "string" && rendered.indexOf("ERR:") !== 0]);
ok.push(["board painted", typeof rendered === "string" && rendered.length > 2000]);
ok.push(["lanes painted", typeof rendered === "string" && rendered.indexOf("First Lane") >= 0]);
ok.push(["no module group header leaked onto the board", typeof rendered === "string" && rendered.indexOf(">Modules<") < 0]);
ok.push(["no module overlay mounted", typeof rendered === "string" && rendered.indexOf("data-surface=\"modal\"") < 0]);

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
has(board, ">3 19m 00s<", "today's lost time on the parent, rolled up");
has(board, ">5 44m 00s<", "and the lifetime total beside it");
has(board, ">1 4m 00s<", "the sub-task's own figure for today");
has(board, ">2 14m 00s<", "and its own lifetime total");
ok.push(["the running total is never smaller than today's figure",
  badges.every((b) => {
    const m = b.match(/(\d+) today, (\d+) in total/);
    return m && Number(m[1]) <= Number(m[2]);
  })]);

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
  ok.push(["a nested project survives collapsing " + label, out2.indexOf(">Nested Proj<") >= 0]);
});


// ---- the User Manual: freshness checks against the BUILT file ----
// tt-tests reads source; these evaluate it. A renamed or removed control, a
// record dropped from the practice seed, or a figure typed into the prose turns
// this red and names the guide that went stale.
const H = out.HELP;
ok.push(["the manual's registries are in the build", !!H]);
if (H) {
  // Modules bring their own help, so the manual is checked with Tool Tracker
  // ON: its topic is read through helpAll() and held to every rule below.
  ok.push(["the manual reads core and modules through one accessor", typeof H.all === "function"]);
  const offIdx = H.all().index;
  ok.push(["with Tool Tracker off, its topic is not in the manual", !offIdx.some((t) => t.id === "module-tools")]);
  out.TT.setEnabled("tools", true);
  const A = H.all();
  const modTopic = A.index.filter((t) => t.id === "module-tools")[0];
  ok.push(["switched on, Tool Tracker's topic appears", !!modTopic && modTopic.topic === "Tool Tracker"]);
  ok.push(["after the core topics and before Practise", !!modTopic && A.index.indexOf(modTopic) === A.index.length - 2 && A.index[A.index.length - 1].flat === true]);
  ok.push(["holding its pictures and guides", !!modTopic && ["picture:tools:screen", "picture:tools:checkout", "guide:tools:out", "guide:tools:back"]
    .every((k) => modTopic.items.some((it) => it[0] + ":" + it[1] === k))]);
  ok.push(["its stages are tagged with the module", !!A.pictures["tools:screen"] && A.pictures["tools:screen"].stage.module === "tools" &&
    A.guides["tools:out"].steps.every((st) => st.stage.module === "tools")]);
  ok.push(["and the core's are not", Object.keys(A.pictures).filter((k) => k.indexOf(":") < 0).every((k) => !A.pictures[k].stage || A.pictures[k].stage.module === undefined)]);
  const sel = (q) => { const m = /^\[([a-z-]+)(?:="([^"]+)")?\]$/.exec(q); return m; };
  const stageHtml = {};
  const render = (st) => { const k = JSON.stringify(st);
    if (!(k in stageHtml)) { try { stageHtml[k] = renderToStaticMarkup(H.stageEl(st)); } catch (e) { stageHtml[k] = "ERR:" + e.message; } }
    return stageHtml[k]; };
  const hasAnchor = (html, q) => { const m = sel(q); if (!m) return false;
    return m[2] ? html.indexOf(m[1] + '="' + m[2] + '"') >= 0 : new RegExp(" " + m[1] + "=").test(html); };
  const stages = [];
  Object.keys(A.pictures).forEach((id) => { const p = A.pictures[id];
    stages.push([ "picture " + id, p.stage, p.parts.map((pt) => pt.anchor) ]); });
  Object.keys(A.guides).forEach((id) => A.guides[id].steps.forEach((st, i) => {
    // A practice-only step has no picture; it must then carry a Try it.
    if (!st.stage) { ok.push(["guide " + id + " step " + (i + 1) + ": a step with no picture is a Try it", !!A.panels[st.tryit]]); return; }
    stages.push([ "guide " + id + " step " + (i + 1), st.stage, [st.ring] ]); }));
  const before = JSON.stringify(Array.from(store.entries()));
  stages.forEach(([where, st, anchors]) => {
    if (st.id != null) ok.push([where + ": its practice record ships in the seed", H.seed.some((p) => p.id === st.id)]);
    const html = render(st);
    ok.push([where + ": its stage renders", html.indexOf("ERR:") !== 0]);
    if (html.indexOf("ERR:") === 0) console.log("   " + html);
    anchors.forEach((q) => ok.push([where + ": " + q + " is really there to point at", hasAnchor(html, q)]));
  });
  ok.push(["every part's How > leads to a guide that exists",
    Object.keys(A.pictures).every((id) => A.pictures[id].parts.every((pt) => !pt.guide || !!A.guides[pt.guide]))]);
  const items = A.index.reduce((a, t) => a.concat(t.items), []);
  const reg = (k) => k === "picture" ? A.pictures : k === "practice" ? A.practice : A.guides;
  ok.push(["every index row leads somewhere real", items.every((it) => !!reg(it[0])[it[1]])]);
  ok.push(["every topic has a name and something in it", A.index.every((t) => t.id && t.topic && t.items.length > 0)]);
  ok.push(["every practice page names panels that exist",
    Object.keys(A.practice).every((id) => A.practice[id].panels.every((k) => typeof A.panels[k] === "function"))]);
  ok.push(["and every guide and picture is reachable from the index",
    ["picture", "guide", "practice"].every((k) => Object.keys(reg(k)).every((id) => items.some((it) => it[0] === k && it[1] === id)))]);
  const prose = [];
  Object.keys(A.pictures).forEach((id) => { const p = A.pictures[id]; prose.push(p.title, p.blurb);
    p.parts.forEach((pt) => prose.push(pt.label, pt.text)); });
  Object.keys(A.practice).forEach((id) => prose.push(A.practice[id].title, A.practice[id].blurb));
  Object.keys(A.guides).forEach((id) => { const g = A.guides[id]; prose.push(g.title);
    g.steps.forEach((st) => prose.push(st.title, st.text)); });
  const figures = prose.filter((t) => /\d/.test(String(t)));
  ok.push(["no guide quotes a figure - the practice board's numbers move daily", figures.length === 0]);
  if (figures.length) console.log("   " + figures.join(" | "));
  let idx = "";
  try { idx = renderToStaticMarkup(React.createElement(H.Guides, { onClose(){} })); } catch (e) { idx = "ERR:" + e.message; }
  ok.push(["the Guides index renders", idx.indexOf("ERR:") !== 0]);
  ok.push(["one heading per topic, closed until tapped", (idx.match(/data-helptopic=/g) || []).length === A.index.filter((t) => !t.flat).length &&
    (idx.match(/aria-expanded="false"/g) || []).length === A.index.filter((t) => !t.flat).length]);
  ok.push(["the search field sits at the top", idx.indexOf("data-helpsearch") >= 0 && idx.indexOf("data-helpsearch") < idx.indexOf("data-helptopic")]);
  ok.push(["a flat topic's rows show straight away", A.index.filter((t) => t.flat).every((t) => t.items.every((it) => idx.indexOf('data-helprow="' + it[0] + ":" + it[1] + '"') >= 0))]);
  let tryit = "";
  try { tryit = renderToStaticMarkup(React.createElement(H.TryHold)); } catch (e) { tryit = "ERR:" + e.message; }
  has(tryit, "data-tryhold", "Try it here draws the real hold control");
  has(tryit, "data-holdfill", "with its charging fill");
  Object.keys(A.panels).forEach((k) => { let h = "";
    try { h = renderToStaticMarkup(React.createElement(A.panels[k])); } catch (e) { h = "ERR:" + e.message; }
    ok.push(["the " + k + " practice panel renders", h.indexOf("ERR:") !== 0 && h.indexOf('data-tryit="' + k + '"') >= 0]); });
  ok.push(["staging every picture and the practice panel wrote nothing to storage",
    JSON.stringify(Array.from(store.entries())) === before]);
  ok.push(["including Tool Tracker's: no tt_mod_tools_ key was written", Array.from(store.keys()).every((k) => k.indexOf("tt_mod_tools_") !== 0)]);
  ok.push(["search finds Tool Tracker's pages while it is on", H.search("check in").some((d) => d.id === "tools:back")]);
  has(idx, 'data-helptopic="module-tools"', "the Guides index lists Tool Tracker while it is on");
  out.TT.setEnabled("tools", false);
  let idxOff = "";
  try { idxOff = renderToStaticMarkup(React.createElement(H.Guides, { onClose(){} })); } catch (e) { idxOff = "ERR:" + e.message; }
  hasnt(idxOff, 'data-helptopic="module-tools"', "and drops it the moment it is switched off");
  ok.push(["and search stops finding its pages", !H.search("check in").some((d) => String(d.id).indexOf("tools:") === 0)]);
}

// ---- the store's doorway: swap the backend, and the REAL board follows ----
// The seam the shared board will sit on. Seed a second store, point the
// doorway at it, and the board must paint from it - while the browser's own
// localStorage is never read or written.
ok.push(["the store's doorway is in the build", !!out.DB]);
if (out.DB) {
  const other = new Map(), touched = [];
  const backend = { get length(){ return other.size; }, key: (i) => Array.from(other.keys())[i],
    getItem: (k) => (other.has(String(k)) ? other.get(String(k)) : null),
    setItem: (k, v) => { other.set(String(k), String(v)); }, removeItem: (k) => { other.delete(String(k)); } };
  store.clear();
  const spy = { getItem: localStorage.getItem, setItem: localStorage.setItem, removeItem: localStorage.removeItem };
  localStorage.getItem = (k) => { touched.push("get " + k); return spy.getItem(k); };
  localStorage.setItem = (k, v) => { touched.push("set " + k); return spy.setItem(k, v); };
  localStorage.removeItem = (k) => { touched.push("remove " + k); return spy.removeItem(k); };
  ok.push(["ttDbUse hands back the backend it was given", out.DB.use(backend) === backend]);
  backend.setItem("tt_projects", JSON.stringify([
    { id: 1, name: "Seam Check Job", lane: "Doorway Lane", notes: "", order: 0, parentId: null, stages: [] }]));
  backend.setItem("tt_laneorder", JSON.stringify(["Doorway Lane"]));
  let seam = "";
  try { seam = renderToStaticMarkup(React.createElement(out.App)); } catch (e) { seam = "ERR:" + e.message; }
  ok.push(["the board renders from the swapped store", seam.indexOf("ERR:") !== 0]);
  if (seam.indexOf("ERR:") === 0) console.log("   " + seam);
  has(seam, "Seam Check Job", "its project comes from the new backend");
  has(seam, "Doorway Lane", "and so does its lane");
  out.DB.save("tt_seamcheck", { a: 1 });
  ok.push(["save() writes into the swapped store", backend.getItem("tt_seamcheck") === '{"a":1}']);
  ok.push(["load() reads back from it", (out.DB.load("tt_seamcheck", null) || {}).a === 1]);
  ok.push(["a corrupt value reads as the default, as before", (backend.setItem("tt_bad", "{nope"), out.DB.load("tt_bad", "dflt")) === "dflt"]);
  ok.push(["module storage follows the doorway too", (out.TT.storage("tools").set("probe", 7), backend.getItem("tt_mod_tools_probe") === "7")]);
  ok.push(["the browser's localStorage was never read or written", touched.length === 0]);
  if (touched.length) console.log("   reached localStorage: " + touched.slice(0, 6).join(", "));
  Object.assign(localStorage, spy);
  ok.push(["ttDbUse(null) goes back to the browser's own", out.DB.use(null) === localStorage]);
}

// ---- Breaks (10-22): the sheet, the overage question, resume, banners,
// the header tag, settings, and the copy-out lines. Rendered on their own.
ok.push(["the break screens are reachable", !!out.BRK]);
if (out.BRK) {
  const B = out.BRK, nop = () => {};
  const r = (C, p) => { try { return renderToStaticMarkup(React.createElement(C, p)); } catch (e) { return "ERR:" + e.message; } };
  let h = r(B.Sheet, { options: B.defaults, leftMs: null, onStart: nop, onCancel: nop });
  has(h, 'data-breakgo="paid"', "the sheet offers Paid break in one tap");
  has(h, 'data-breakgo="unpaid"', "and Unpaid break");
  has(h, "I need a break!", "under I need a break!");
  ok.push(["the usual three, each tagged", (h.match(/data-breakpreset/g) || []).length === 3 && (h.match(/data-breakpaid/g) || []).length >= 3]);
  hasnt(h, "End of Day", "End of Day is gone");
  has(h, "data-customgo", "and a name of your own is offered");
  h = r(B.Over, { label: "Morning Break", overMs: 7 * 60000, totalMs: 30 * 60000, onPick: nop });
  ok.push(["the overage asks three ways", ["unpaid", "today", "change"].every((k) => h.indexOf('data-overact="' + k + '"') >= 0)]);
  has(h, "data-breakrules", "and shows the rules note beside the choice");
  hasnt(h, "ERR:", "the overage sheet renders");
  h = r(B.Resume, { label: "Lunch", jobName: "Weld Frame", onResume: nop, onClose: nop });
  has(h, 'data-resume="job"', "ending a break offers the job back");
  has(h, "Weld Frame", "by name");
  has(h, 'data-resume="none"', "or Not yet");
  h = r(B.Missed, { due: { key: "k", at: Date.now(), name: "Lunch", paid: false, mins: 30 }, place: { top: 120 }, jobName: null, onAct: nop });
  ok.push(["the missed-break banner offers start, later, skip", ["start", "snooze", "skip"].every((k) => h.indexOf('data-missedact="' + k + '"') >= 0)]);
  has(h, "Lunch", "and names the break");
  h = r(B.OverBanner, { overMs: 4 * 60000, place: { top: 120 } });
  has(h, "data-breakover", "the live overage banner renders");
  const tk = (p) => r(B.Ticker, Object.assign({ interrupting: false, activeProj: null, intElapsed: 0, wsActive: null, elapsed: 0, onBreak: false,
    breakLabel: "", breakElapsed: 0, clocked: true, atWorkElapsed: 3600000, nowTick: Date.now(), bottom: false }, p));
  has(tk({ statusTag: "Break", onStatusTap: nop }), "data-breaktag", "clocked in, the header carries the Break tag");
  has(tk({ statusTag: "Break", onStatusTap: nop }), "data-statustap", "and the status line is the tap target");
  hasnt(tk({}), "data-breaktag", "with no tag, the header is as it was");
  hasnt(tk({}), "data-statustap", "and nothing is tappable");
  has(tk({ onBreak: true, breakLabel: "Lunch", breakElapsed: 60000, statusTag: "End", onStatusTap: nop }), "End \u203a", "on a break the tag reads End");
  has(tk({ onBreak: true, breakLabel: "Lunch", breakElapsed: 60000, statusTag: "End", onStatusTap: nop, overNote: "+4m over" }), "data-breakovernote", "the header can carry the overage");
  const sch = B.norm({ wed: { on: true, start: "06:00", end: "14:30" }, unpaidBreaks: { enabled: true, weekly: [{ id: "m", name: "Morning Break", start: "09:00", mins: 15, paid: true }] } });
  h = r(B.Sched, { value: sch.unpaidBreaks, schedule: sch, onDone: nop, onClose: nop });
  has(h, "Scheduled Breaks", "the breaks editor is Scheduled Breaks now");
  has(h, 'data-breakpaidtoggle="paid"', "each break says paid or unpaid");
  has(h, 'data-anchor="ub-allow"', "with the paid break time section");
  has(h, 'data-carryover="off"', "carry-over, off by default");
  ok.push(["the rules note sits at setup and beside carry-over and overage", (h.match(/data-breakrules/g) || []).length === 2]);
  h = r(B.Pay, { value: Object.assign({}, sch.payroll, { paidBreaksOt: false }), onDone: nop, onClose: nop });
  has(h, 'data-anchor="pay-breaksot"', "Pay & Work Week has the paid breaks setting");
  has(h, "data-pbotwarn", "switched off, it warns");
  has(h, B.personal, "and says it is a personal record");
  hasnt(r(B.Pay, { value: sch.payroll, onDone: nop, onClose: nop }), "data-pbotwarn", "left on, no warning");
  const t = B.tally([{ id: "a", paid: true, startTime: 0, endTime: 1, duration: 20 * 60000, overMs: 5 * 60000, overUnpaid: true, personal: true },
                     { id: "b", paid: false, startTime: 0, endTime: 1, duration: 30 * 60000 },
                     { id: "c", missed: true, startTime: 0, endTime: 0, duration: 0 }]);
  const L = B.lines(t, false).join("\n");
  ok.push(["the copy-out splits paid and unpaid (the overage made unpaid joins unpaid)", /Paid: 15m/.test(L) && /Unpaid: 35m/.test(L)]);
  ok.push(["notes the overage made unpaid", /made unpaid \*/.test(L)]);
  ok.push(["counts the missed break", /Missed breaks: 1/.test(L)]);
  ok.push(["and footnotes the personal record", L.indexOf("* Personal:") >= 0 && L.indexOf(B.personal) >= 0]);
  const L2 = B.lines(B.tally([{ id: "p", paid: true, startTime: 0, endTime: 1, duration: 10 * 60000 }]), true).join("\n");
  ok.push(["paid breaks kept out of overtime are starred", /Paid: 10m[^\n]* \*/.test(L2)]);
  ok.push(["and footnoted as personal", /\* Personal: paid breaks set not to count toward overtime/.test(L2)]);
  ok.push(["a plain day has no footnote", B.lines(B.tally([{ id: "x", paid: false, startTime: 0, endTime: 1, duration: 60000 }]), false).join().indexOf("Personal") < 0]);
}

let bad = 0;
ok.forEach(([label, pass]) => { if (!pass) { bad++; console.log("   x " + label); } });
console.log("boot       : " + (ok.length - bad) + "/" + ok.length + " passed" + (bad ? "  FAILED" : ""));
if (typeof rendered === "string" && rendered.indexOf("ERR:") === 0) console.log("   " + rendered);
process.exit(bad ? 1 : 0);
