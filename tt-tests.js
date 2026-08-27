// tt-tests.js - the whole static test estate for the Time Tracker in one file.
//   node tt-tests.js [path/to/time-tracker.jsx]
// Five suites: the module contract, a reference module's full lifecycle, the
// host wiring plus the architectural invariants, the Extensions screen, and
// the Tool Tracker module itself.
// The syntax gate runs first when the TypeScript parser is available.
const fs = require("fs");
const SRC_PATH = process.argv[2] || process.env.TT_SRC || "time-tracker.jsx";

// ---- assertions ----
// the smallest thing that can report a green suite honestly.
let current = null;
const suites = [];
let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  current = { name, checks: 0 };
  suites.push(current);
  try { fn(); }
  catch (e) { fail++; failures.push(name + " -> threw: " + (e && e.message)); }
  current = null;
}
function record(ok, label) {
  if (current) current.checks++;
  if (ok) pass++;
  else { fail++; failures.push((current ? current.name + " -> " : "") + label); }
}
const eq = (a, b, label) => record(a === b, label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
const same = (a, b, label) => record(JSON.stringify(a) === JSON.stringify(b),
  label + "  (got " + JSON.stringify(a) + ", want " + JSON.stringify(b) + ")");
const ok = (v, label) => record(!!v, label);
function throws(fn, label) {
  let threw = false;
  try { fn(); } catch (e) { threw = true; }
  record(threw, label + "  (expected a throw)");
}
function doesNotThrow(fn, label) {
  let msg = null;
  try { fn(); } catch (e) { msg = (e && e.message) || "threw"; }
  record(msg === null, label + (msg ? "  (threw: " + msg + ")" : ""));
}
function report(title) {
  const total = pass + fail;
  if (fail) {
    console.log("\n" + title + ": " + pass + "/" + total + " passed, " + fail + " FAILED");
    failures.forEach((f) => console.log("   x " + f));
  } else {
    console.log(title + ": " + pass + "/" + total + " passed  (" + suites.length + " cases)");
  }
  return { pass, fail, total, cases: suites.length };
}

// ---- syntax gate ------------------------------------------------------------
function syntaxCheck() {
  let ts;
  try { ts = require("typescript"); }
  catch (e) { console.log("syntax     : skipped (typescript not installed)"); return 0; }
  const src = fs.readFileSync(SRC_PATH, "utf8");
  const sf = ts.createSourceFile(SRC_PATH, src, ts.ScriptTarget.ES2019, true, ts.ScriptKind.JSX);
  const diags = sf.parseDiagnostics || [];
  if (!diags.length) {
    console.log("syntax     : OK  (" + src.split("\n").length + " lines)");
    return 0;
  }
  diags.forEach((d) => {
    const p = sf.getLineAndCharacterOfPosition(d.start);
    console.log("   x " + (p.line + 1) + ":" + (p.character + 1) + "  " +
      ts.flattenDiagnosticMessageText(d.messageText, " "));
  });
  console.log("syntax     : " + diags.length + " error(s)");
  return 1;
}

// ---- harness ----
// lift the TT platform block out of the source and run it in
// Node against stubs, so the contract can be tested without a browser.


const BEGIN = "// ==== TT PLATFORM BEGIN ====";
const END   = "// ==== TT PLATFORM END ====";

function source() { return fs.readFileSync(SRC_PATH, "utf8"); }

function platformBlock() {
  const s = source();
  const a = s.indexOf(BEGIN), b = s.indexOf(END);
  if (a < 0 || b < 0) throw new Error("platform markers missing from " + SRC_PATH);
  return s.slice(a + BEGIN.length, b);
}

// A localStorage that behaves like the real one: string values, indexable,
// and able to throw on write when a test wants to see quota failure handled.
function memStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  const st = {
    failWrites: false,
    get length() { return map.size; },
    key(i) { return Array.from(map.keys())[i]; },
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) {
      if (st.failWrites) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
      map.set(String(k), String(v));
    },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
    snapshot() { return Object.fromEntries(map); }
  };
  return st;
}

// Names the platform block reaches for from the rest of the file. Kept as one
// list so a test can also assert every one of them really exists in the source.
const CORE_NAMES = [
  "S", "rgba", "haptic", "Modal", "ModalActions", "Mono", "Toggle", "Carousel",
  "MODAL_SAVE", "MODAL_CANCEL", "TIME_FIELD_STYLE", "INPUT_STYLE", "LABEL_STYLE",
  "fmtDur", "fmtTime", "fmtDate", "fmtHours", "fmtMoney", "pad",
  "DAY_KEYS", "DAY_LABELS", "dayKeyOf", "isoDate", "toMin",
  "startOfDay", "addDays", "startOfWeek", "startOfMonth", "startOfQuarter", "startOfYear",
  "periodRange", "periodLabel", "payCycleRange",
  "scheduledMinutes", "scheduledToDate", "schNetMinutes",
  "uid", "findProj", "getChildren", "getDescendantIds", "getMeta"
];

// Fresh platform per test: the registry is module-level state, so suites that
// register modules must not leak into each other.
// A counting uid: the constant one made every id-less record collide, which
// is exactly the case a normalizer has to get right.
let uidN = 0;
function uidStub() { return "id" + (++uidN); }

function loadPlatform(opts) {
  opts = opts || {};
  const storage = opts.storage || memStorage();
  const events = [];
  const stubs = {
    S: { bg1: "#000", border: "#111", text: "#fff", radius: "10px", fontBody: "x" },
    rgba: (hex, a) => "rgba(" + hex + "," + a + ")",
    haptic: () => { events.push("haptic"); },
    Modal: function Modal() {}, ModalActions: function ModalActions() {},
    Mono: function Mono() {}, Toggle: function Toggle() {}, Carousel: function Carousel() {},
    MODAL_SAVE: () => ({ tag: "save" }), MODAL_CANCEL: () => ({ tag: "cancel" }),
    TIME_FIELD_STYLE: () => ({ tag: "time" }),
    INPUT_STYLE: { tag: "input" }, LABEL_STYLE: { tag: "label" },
    fmtDur: () => "", fmtTime: () => "", fmtDate: () => "",
    fmtHours: () => "", fmtMoney: () => "", pad: (n) => String(n),
    DAY_KEYS: ["mon"], DAY_LABELS: { mon: "Monday" }, dayKeyOf: () => "mon",
    isoDate: () => "", toMin: () => 0,
    startOfDay: (d) => d, addDays: (d) => d, startOfWeek: (d) => d,
    startOfMonth: (d) => d, startOfQuarter: (d) => d, startOfYear: (d) => d,
    periodRange: () => ({}), periodLabel: () => "", payCycleRange: () => ({}),
    scheduledMinutes: () => 0, scheduledToDate: () => 0, schNetMinutes: () => 0,
    uid: uidStub, findProj: () => null, getChildren: () => [], getDescendantIds: () => [],
    getMeta: (meta, lane) => ({ label: lane, accent: "#888", bg: "#111", dim: "#333" }),
    window: { dispatchEvent: (e) => { events.push(e && e.type); return true; } },
    Event: function (type) { return { type: type }; },
    localStorage: storage
  };

  const names = Object.keys(stubs);
  const body = platformBlock() + "\nreturn { TT, ttModKey, ttModStorage, ttValidateModule, ttDefineModule," +
    " ttModules, ttModule, ttEnabledMap, ttModuleEnabled, ttSetModuleEnabled, ttEnabledModules," +
    " ttBootModules, ttModuleNav, ttModuleScreen, ttModuleContext, ttSettingsPanels," +
    " ttReportSections, ttReportText, TT_REGISTRY, TT_BOOTED, TT_ENABLED_KEY, TT_MOD_PREFIX };";
  const fn = new Function(...names, body);
  const api = fn(...names.map((n) => stubs[n]));
  api.storage = storage;
  api.events = events;
  api.stubs = stubs;
  return api;
}



// ============================================================
// contract: the module contract
// ============================================================
(function(){
// t_platform.js - conformance suite for the module contract (TT platform v1).

// A minimal module that satisfies the contract, used as the baseline everywhere.
function base(over) {
  return Object.assign({ id: "tools", title: "Tool Tracker", version: 1 }, over || {});
}

// ---- API surface -------------------------------------------------------------
test("API exposes every documented entry point", () => {
  const { TT } = loadPlatform();
  ["define", "validate", "modules", "module", "enabled", "isEnabled", "setEnabled",
    "boot", "context", "storage", "key", "nav", "screen", "settingsPanels",
    "reportSections", "reportText", "tokens", "rgba", "haptic", "closeMenus"
  ].forEach((k) => eq(typeof TT[k], "function", "TT." + k + " is a function"));
  eq(TT.version, 1, "contract version is 1");
  eq(TT.prefix, "tt_mod_", "storage prefix is exposed");
});

test("ui, fmt, time and data services are all wired, none undefined", () => {
  const { TT } = loadPlatform();
  const groups = {
    ui: ["Modal", "ModalActions", "Mono", "Toggle", "Carousel", "saveStyle", "cancelStyle",
      "timeFieldStyle", "inputStyle", "labelStyle"],
    fmt: ["dur", "time", "date", "hours", "money", "pad"],
    time: ["dayKeyOf", "isoDate", "toMin", "startOfDay", "addDays", "startOfWeek",
      "startOfMonth", "startOfQuarter", "startOfYear", "periodRange", "periodLabel",
      "payCycleRange", "scheduledMinutes", "scheduledToDate", "schNetMinutes"],
    data: ["uid", "findProj", "getChildren", "getDescendantIds"]
  };
  Object.keys(groups).forEach((g) => groups[g].forEach((k) =>
    eq(typeof TT[g][k], "function", "TT." + g + "." + k)));
  ok(Array.isArray(TT.time.DAY_KEYS), "TT.time.DAY_KEYS is an array");
  ok(TT.time.DAY_LABELS && typeof TT.time.DAY_LABELS === "object", "TT.time.DAY_LABELS is an object");
});

test("every core name the platform borrows really exists in the source", () => {
  const s = source();
  CORE_NAMES.forEach((n) => {
    const declared = new RegExp("(function\\s+" + n + "\\s*\\(|var\\s+" + n + "\\s*=)").test(s);
    ok(declared, n + " is declared in the source");
  });
});

// ---- live tokens -------------------------------------------------------------
test("tokens() is live, not a load-time snapshot", () => {
  const p = loadPlatform();
  eq(p.TT.tokens().text, "#fff", "reads the current palette");
  p.stubs.S.text = "#000";
  eq(p.TT.tokens().text, "#000", "sees a theme change made after load");
});

test("style getters are functions returning fresh objects", () => {
  const p = loadPlatform();
  const a = p.TT.ui.inputStyle(), b = p.TT.ui.inputStyle();
  ok(a !== b, "inputStyle() does not hand out the shared object");
  a.tag = "mutated";
  eq(p.TT.ui.inputStyle().tag, "input", "mutating a copy cannot corrupt the core style");
  p.stubs.INPUT_STYLE.tag = "retheme";
  eq(p.TT.ui.inputStyle().tag, "retheme", "inputStyle() reflects applyTokens changes");
  eq(typeof p.TT.ui.cancelStyle, "function", "cancelStyle stays a function of live tokens");
  eq(typeof p.TT.ui.saveStyle, "function", "saveStyle stays a function of live tokens");
});

test("closeMenus broadcasts ttCloseMenus", () => {
  const p = loadPlatform();
  p.TT.closeMenus();
  ok(p.events.indexOf("ttCloseMenus") >= 0, "the menu bus event fires");
});

// ---- keys and storage --------------------------------------------------------
test("module keys are namespaced under tt_mod_<id>_", () => {
  const p = loadPlatform();
  eq(p.ttModKey("tools", "items"), "tt_mod_tools_items", "key shape");
  ok(p.ttModKey("tools", "items").indexOf("tt_") === 0, "still inside the backup prefix");
});

test("malformed ids and keys are rejected at the key boundary", () => {
  const p = loadPlatform();
  ["Tools", "1tools", "t", "tools_x", "tools ", "", null].forEach((bad) =>
    throws(() => p.ttModKey(bad, "items"), "id rejected: " + String(bad)));
  ["Items", "tt_mod_tools_items", "items/1", "", null].forEach((bad) =>
    throws(() => p.ttModKey("tools", bad), "key rejected: " + String(bad)));
});

test("two modules cannot collide, and neither can touch core keys", () => {
  const st = memStorage({ tt_logs: "[]", tt_settings: "{}" });
  const p = loadPlatform({ storage: st });
  const tools = p.ttModStorage("tools"), mats = p.ttModStorage("materials");
  tools.set("items", [1, 2, 3]);
  mats.set("items", ["a"]);
  same(tools.get("items"), [1, 2, 3], "tools keeps its own value");
  same(mats.get("items"), ["a"], "materials keeps its own value");
  same(tools.keys(), ["items"], "keys() lists only this module's keys, unprefixed");
  tools.clear();
  eq(tools.get("items", null), null, "clear() empties this module");
  same(mats.get("items"), ["a"], "clear() left the other module alone");
  eq(st.getItem("tt_logs"), "[]", "core data untouched");
  eq(st.getItem("tt_settings"), "{}", "core settings untouched");
});

test("reads survive missing and corrupt values; writes survive a full disk", () => {
  const st = memStorage();
  const p = loadPlatform({ storage: st });
  const s = p.ttModStorage("tools");
  same(s.get("nope", { d: 1 }), { d: 1 }, "missing key returns the default");
  st.setItem("tt_mod_tools_bad", "{not json");
  same(s.get("bad", "fallback"), "fallback", "corrupt JSON returns the default");
  st.failWrites = true;
  eq(s.set("items", [1]), false, "a failed write reports false");
  doesNotThrow(() => s.remove("items"), "remove never throws");
});

// ---- validation --------------------------------------------------------------
test("a minimal module validates", () => {
  const p = loadPlatform();
  same(p.ttValidateModule(base()), [], "id + title + version is enough");
});

test("required fields are enforced", () => {
  const p = loadPlatform();
  const cases = [
    [{ title: "x", version: 1 }, "id"],
    [base({ id: "Tools" }), "id"],
    [base({ id: "x" }), "id"],
    [base({ title: "" }), "title"],
    [base({ version: 0 }), "version"],
    [base({ version: 1.5 }), "version"],
    [base({ version: "1" }), "version"]
  ];
  cases.forEach(([spec, field]) => {
    const errs = p.ttValidateModule(spec);
    ok(errs.some((e) => e.indexOf(field) >= 0), field + " error for " + JSON.stringify(spec.version ?? spec.id));
  });
});

test("an unknown field is a typo, not a feature", () => {
  const p = loadPlatform();
  const errs = p.ttValidateModule(base({ navigation: {} }));
  ok(errs.some((e) => /unknown field: navigation/.test(e)), "unknown field rejected");
});

test("nav must point at a screen that exists", () => {
  const p = loadPlatform();
  ok(p.ttValidateModule(base({ nav: { label: "Tools", screen: "main" } }))
    .some((e) => /names no screen/.test(e)), "dangling nav.screen rejected");
  same(p.ttValidateModule(base({
    nav: { label: "Tools", screen: "main" }, screens: { main: function () {} }
  })), [], "nav plus its screen validates");
  ok(p.ttValidateModule(base({ nav: { screen: "main" }, screens: { main: function () {} } }))
    .some((e) => /nav.label/.test(e)), "nav.label required");
});

test("storage keys must be bare slugs, normalize must be a function", () => {
  const p = loadPlatform();
  ok(p.ttValidateModule(base({ storage: { keys: ["tt_mod_tools_items"] } }))
    .some((e) => /bare slug/.test(e)), "a fully-qualified key is rejected");
  ok(p.ttValidateModule(base({ storage: { keys: ["Items"] } }))
    .some((e) => /bare slug/.test(e)), "an uppercase key is rejected");
  ok(p.ttValidateModule(base({ storage: { keys: [], normalize: "yes" } }))
    .some((e) => /normalize/.test(e)), "a non-function normalizer is rejected");
  same(p.ttValidateModule(base({ storage: { keys: ["items"], normalize: function () {} } })), [], "valid storage block");
});

test("hooks must be functions", () => {
  const p = loadPlatform();
  ok(p.ttValidateModule(base({ settingsPanel: {} })).some((e) => /settingsPanel/.test(e)), "settingsPanel");
  ok(p.ttValidateModule(base({ reports: { section: 1 } })).some((e) => /reports.section/.test(e)), "reports.section");
  ok(p.ttValidateModule(base({ reports: { text: 1 } })).some((e) => /reports.text/.test(e)), "reports.text");
  ok(p.ttValidateModule(base({ screens: { main: 1 } })).some((e) => /component function/.test(e)), "screens");
});

test("define registers, and refuses duplicates and junk loudly", () => {
  const p = loadPlatform();
  const m = p.TT.define(base());
  eq(m.id, "tools", "returns the frozen-shape record");
  eq(p.TT.modules().length, 1, "registry holds it");
  eq(p.TT.module("tools").title, "Tool Tracker", "lookup by id");
  throws(() => p.TT.define(base()), "duplicate id throws");
  throws(() => p.TT.define(base({ id: "materials", version: 0 })), "invalid module throws");
  eq(p.TT.modules().length, 1, "nothing invalid reached the registry");
  ok(p.TT.modules() !== p.TT_REGISTRY, "modules() hands back a copy");
});

test("defaults are filled in so hosts never branch on undefined", () => {
  const p = loadPlatform();
  const m = p.TT.define(base());
  eq(m.summary, "", "summary defaults to empty");
  eq(m.defaultEnabled, false, "a la carte means off by default");
  eq(m.nav, null, "nav defaults to null");
  same(m.screens, {}, "screens defaults to an empty map");
  eq(m.storage, null, "storage defaults to null");
  eq(m.reports, null, "reports defaults to null");
});

// ---- enablement --------------------------------------------------------------
test("enablement falls back to the module's own default", () => {
  const p = loadPlatform();
  p.TT.define(base());
  p.TT.define(base({ id: "materials", title: "Materials", defaultEnabled: true }));
  eq(p.TT.isEnabled("tools"), false, "off unless stated");
  eq(p.TT.isEnabled("materials"), true, "defaultEnabled honoured");
  eq(p.TT.isEnabled("ghost"), false, "an unregistered id is never enabled");
  same(p.TT.enabled().map((m) => m.id), ["materials"], "enabled() filters");
});

test("a deliberate choice persists and overrides the default", () => {
  const st = memStorage();
  const p = loadPlatform({ storage: st });
  p.TT.define(base({ defaultEnabled: true }));
  eq(p.TT.setEnabled("tools", false), true, "setEnabled reports success");
  eq(p.TT.isEnabled("tools"), false, "the choice wins over the default");
  same(JSON.parse(st.getItem("tt_modules")), { tools: false }, "written under a tt_ key");
  p.TT.setEnabled("tools", true);
  eq(p.TT.isEnabled("tools"), true, "and can be reversed");
  eq(p.TT.setEnabled("ghost", true), false, "unknown ids are refused");
});

test("a corrupt enablement map degrades to defaults instead of crashing", () => {
  const st = memStorage({ tt_modules: "{oops" });
  const p = loadPlatform({ storage: st });
  p.TT.define(base({ defaultEnabled: true }));
  eq(p.TT.isEnabled("tools"), true, "falls back to the default");
  const st2 = memStorage({ tt_modules: "[1,2]" });
  const p2 = loadPlatform({ storage: st2 });
  p2.TT.define(base());
  eq(p2.TT.isEnabled("tools"), false, "a non-object map is ignored");
});

// ---- boot --------------------------------------------------------------------
test("boot runs each normalizer once, enabled or not", () => {
  const p = loadPlatform();
  let a = 0, b = 0;
  p.TT.define(base({ storage: { keys: ["items"], normalize: () => { a++; } } }));
  p.TT.define(base({ id: "materials", title: "Materials", defaultEnabled: true,
    storage: { keys: ["items"], normalize: () => { b++; } } }));
  same(p.TT.boot().sort(), ["materials", "tools"], "both ran, including the disabled one");
  eq(p.TT.boot().length, 0, "a second boot in the same session is a no-op");
  eq(a, 1, "disabled module normalized once");
  eq(b, 1, "enabled module normalized once");
});

test("the normalizer gets a namespaced store and the api", () => {
  const st = memStorage();
  const p = loadPlatform({ storage: st });
  let seen = null;
  p.TT.define(base({ storage: { keys: ["items"], normalize: (store, api) => {
    seen = api;
    store.set("items", store.get("items", []));
  } } }));
  p.TT.boot();
  eq(seen, p.TT, "the second argument is the platform api");
  eq(st.getItem("tt_mod_tools_items"), "[]", "back-filled under its own namespace");
});

test("normalizers are idempotent - a second run changes nothing", () => {
  const st = memStorage({ tt_mod_tools_items: '[{"name":"caliper"}]' });
  const p = loadPlatform({ storage: st });
  const normalize = (store) => {
    const items = store.get("items", []);
    store.set("items", (Array.isArray(items) ? items : []).map((it) =>
      Object.assign({ id: "x", name: "", qty: 1 }, it)));
  };
  p.TT.define(base({ storage: { keys: ["items"], normalize } }));
  p.TT.boot();
  const first = st.snapshot();
  normalize(p.ttModStorage("tools"));
  same(st.snapshot(), first, "running it again is a fixed point");
});

test("a module that throws at boot cannot take the app down", () => {
  const p = loadPlatform();
  let later = false;
  p.TT.define(base({ storage: { keys: [], normalize: () => { throw new Error("bad save"); } } }));
  p.TT.define(base({ id: "materials", title: "Materials",
    storage: { keys: [], normalize: () => { later = true; } } }));
  doesNotThrow(() => p.TT.boot(), "boot swallows the failure");
  ok(later, "the module registered after it still normalized");
});

test("a normalizer only ever writes inside its own namespace", () => {
  const st = memStorage({ tt_logs: "[]" });
  const p = loadPlatform({ storage: st });
  p.TT.define(base({ storage: { keys: ["items"], normalize: (store) => { store.set("items", []); } } }));
  p.TT.boot();
  Object.keys(st.snapshot()).forEach((k) => {
    ok(k === "tt_logs" || k.indexOf("tt_mod_tools_") === 0, "no stray key written: " + k);
  });
});

// ---- host hooks --------------------------------------------------------------
test("nav lists only enabled modules that declare an entry", () => {
  const p = loadPlatform();
  const screens = { main: function () {} };
  p.TT.define(base({ defaultEnabled: true, nav: { label: "Tools", screen: "main" }, screens }));
  p.TT.define(base({ id: "materials", title: "Materials", defaultEnabled: true,
    nav: { label: "Materials", screen: "main", group: "Shop" }, screens }));
  p.TT.define(base({ id: "hidden", title: "Hidden", nav: { label: "Hidden", screen: "main" }, screens }));
  p.TT.define(base({ id: "quiet", title: "Quiet", defaultEnabled: true }));
  const nav = p.TT.nav();
  same(nav.map((n) => n.id), ["tools", "materials"], "disabled and nav-less modules are absent");
  eq(nav[0].group, "Modules", "group defaults to Modules");
  eq(nav[1].group, "Shop", "a declared group is kept");
  eq(typeof p.TT.screen("tools", "main"), "function", "screen resolves");
  eq(p.TT.screen("tools", "nope"), null, "an unknown screen resolves to null");
  eq(p.TT.screen("ghost", "main"), null, "an unknown module resolves to null");
});

test("context binds storage to the module and cannot be spoofed by the host", () => {
  const p = loadPlatform();
  p.TT.define(base());
  const ctx = p.TT.context("tools", { settings: { a: 1 }, moduleId: "materials", onClose: () => {} });
  eq(ctx.moduleId, "tools", "the host cannot override moduleId");
  eq(ctx.storage.id, "tools", "storage is bound to this module");
  eq(ctx.api, p.TT, "the api comes along");
  same(ctx.settings, { a: 1 }, "host fields are passed through");
});

test("reports hooks collect from enabled modules and survive a bad one", () => {
  const p = loadPlatform();
  p.TT.define(base({ defaultEnabled: true, reports: {
    section: (ctx) => ({ el: "tools:" + ctx.kind }),
    text: () => ["Tools checked out: 3"] } }));
  p.TT.define(base({ id: "broken", title: "Broken", defaultEnabled: true, reports: {
    section: () => { throw new Error("nope"); },
    text: () => { throw new Error("nope"); } } }));
  p.TT.define(base({ id: "materials", title: "Materials", defaultEnabled: true, reports: {
    text: () => "Materials used: 2" } }));
  p.TT.define(base({ id: "off", title: "Off", reports: { text: () => "never" } }));

  const secs = p.TT.reportSections({ kind: "week" });
  eq(secs.length, 1, "only the section that worked is returned");
  eq(secs[0].id, "tools", "tagged with the module id");
  same(secs[0].el, { el: "tools:week" }, "the context reached the hook");

  const lines = p.TT.reportText({ kind: "week" });
  same(lines, ["Tools checked out: 3", "Materials used: 2"], "strings and arrays both accepted, disabled skipped");
});

test("reportText discards anything that is not a string", () => {
  const p = loadPlatform();
  p.TT.define(base({ defaultEnabled: true, reports: { text: () => ["ok", 42, null, { a: 1 }] } }));
  same(p.TT.reportText({}), ["ok"], "non-strings filtered out");
  const p2 = loadPlatform();
  p2.TT.define(base({ defaultEnabled: true, reports: { text: () => 42 } }));
  same(p2.TT.reportText({}), [], "a non-string return yields nothing");
});

test("settings panels come only from enabled modules that declare one", () => {
  const p = loadPlatform();
  p.TT.define(base({ defaultEnabled: true, settingsPanel: function () {} }));
  p.TT.define(base({ id: "materials", title: "Materials", settingsPanel: function () {} }));
  p.TT.define(base({ id: "quiet", title: "Quiet", defaultEnabled: true }));
  same(p.TT.settingsPanels().map((m) => m.id), ["tools"], "one panel");
});

// ---- backup and isolation ----------------------------------------------------
test("everything the platform writes lives under the backup prefix", () => {
  const p = loadPlatform();
  ok(p.TT_MOD_PREFIX.indexOf("tt_") === 0, "module keys are tt_-prefixed");
  ok(p.TT_ENABLED_KEY.indexOf("tt_") === 0, "the enablement map is tt_-prefixed");
});

test("the platform itself reaches localStorage in exactly one place", () => {
  const block = platformBlock().replace(/\/\/.*$/gm, "");   // prose does not count
  const hits = (block.match(/localStorage/g) || []).length;
  eq(hits, 1, "only ttStore() knows about localStorage");
  ok(/function ttStore/.test(block), "and that place is ttStore");
});


})();

// ============================================================
// reference: a full module, end to end
// ============================================================
(function(){
// t_reference.js - a throwaway Tool Tracker built only in the test, to prove
// the contract is actually sufficient for the module Phase 3 will ship. If a
// real module would need something this one cannot express, it fails here
// rather than halfway through building it.

function refModule(seenCtx) {
  return {
    id: "tools",
    title: "Tool Tracker",
    version: 2,
    summary: "Check tools in and out against a job.",
    defaultEnabled: false,
    nav: { label: "Tools", screen: "main", group: "Modules" },
    screens: {
      main: function ToolScreen(ctx) { if (seenCtx) seenCtx.push(ctx); return { screen: "main" }; }
    },
    storage: {
      keys: ["items", "checkouts"],
      // v1 stored a bare name list; v2 stores records. The normalizer has to
      // carry a v1 save forward without the module ever seeing the old shape.
      normalize: function (store) {
        var items = store.get("items", []);
        if (!Array.isArray(items)) items = [];
        store.set("items", items.map(function (it) {
          return typeof it === "string" ? { id: it, name: it, qty: 1 } :
            Object.assign({ id: "?", name: "", qty: 1 }, it);
        }));
        var outs = store.get("checkouts", []);
        store.set("checkouts", Array.isArray(outs) ? outs : []);
        store.set("schema", 2);
      }
    },
    settingsPanel: function ToolSettings(ctx) { return { panel: ctx.moduleId }; },
    reports: {
      section: function (ctx) { return { tools: ctx.kind }; },
      text: function (ctx) { return ["Tools out this " + ctx.kind + ": 2"]; }
    }
  };
}

test("a fully-featured module registers without complaint", () => {
  const p = loadPlatform();
  same(p.TT.validate(refModule()), [], "the reference module is conformant");
  const m = p.TT.define(refModule());
  eq(m.version, 2, "its own schema version is kept");
  eq(m.summary, "Check tools in and out against a job.", "summary survives registration");
});

test("boot migrates a v1 save forward, and only once", () => {
  const st = memStorage({ tt_mod_tools_items: '["caliper","torque wrench"]' });
  const p = loadPlatform({ storage: st });
  p.TT.define(refModule());
  p.TT.boot();
  const items = JSON.parse(st.getItem("tt_mod_tools_items"));
  same(items[0], { id: "caliper", name: "caliper", qty: 1 }, "strings became records");
  eq(items.length, 2, "nothing was lost");
  same(JSON.parse(st.getItem("tt_mod_tools_checkouts")), [], "the missing key was back-filled");
  eq(st.getItem("tt_mod_tools_schema"), "2", "schema stamped");
  const after = st.snapshot();
  p.TT.boot();
  same(st.snapshot(), after, "a second boot is inert");
});

test("a module is invisible until it is switched on", () => {
  const p = loadPlatform();
  p.TT.define(refModule());
  same(p.TT.nav(), [], "no menu row");
  same(p.TT.settingsPanels(), [], "no settings panel");
  same(p.TT.reportSections({ kind: "week" }), [], "no report section");
  same(p.TT.reportText({ kind: "week" }), [], "no report lines");
});

test("switching it on lights up every surface at once", () => {
  const p = loadPlatform();
  p.TT.define(refModule());
  p.TT.setEnabled("tools", true);
  const nav = p.TT.nav();
  eq(nav.length, 1, "one menu row");
  same(nav[0], { id: "tools", label: "Tools", group: "Modules", screen: "main" }, "row shape");
  eq(p.TT.settingsPanels().length, 1, "settings panel appears");
  same(p.TT.reportSections({ kind: "week" })[0].el, { tools: "week" }, "report section appears");
  same(p.TT.reportText({ kind: "month" }), ["Tools out this month: 2"], "report lines appear");
});

test("the host can open the screen it was told about", () => {
  const seen = [];
  const p = loadPlatform();
  p.TT.define(refModule(seen));
  p.TT.setEnabled("tools", true);
  const entry = p.TT.nav()[0];
  const Screen = p.TT.screen(entry.id, entry.screen);
  eq(typeof Screen, "function", "the nav row resolves to a component");
  const out = Screen(p.TT.context(entry.id, { projects: [{ id: 1 }], onClose: function () {} }));
  same(out, { screen: "main" }, "it renders");
  eq(seen[0].storage.id, "tools", "with storage bound to itself");
  same(seen[0].projects, [{ id: 1 }], "and the core data it was handed");
  eq(typeof seen[0].onClose, "function", "and a way to close");
});

test("switching it off hides it but keeps its data", () => {
  const st = memStorage();
  const p = loadPlatform({ storage: st });
  p.TT.define(refModule());
  p.TT.setEnabled("tools", true);
  p.ttModStorage("tools").set("items", [{ id: "a", name: "caliper", qty: 1 }]);
  p.TT.setEnabled("tools", false);
  same(p.TT.nav(), [], "the row is gone");
  eq(p.TT.reportText({ kind: "day" }).length, 0, "the report is quiet again");
  same(JSON.parse(st.getItem("tt_mod_tools_items")).length, 1, "the tools are still there");
  p.TT.setEnabled("tools", true);
  eq(p.TT.nav().length, 1, "and come straight back on");
});

test("two modules coexist without knowing about each other", () => {
  const st = memStorage();
  const p = loadPlatform({ storage: st });
  p.TT.define(refModule());
  const mats = refModule();
  mats.id = "materials"; mats.title = "Materials"; mats.nav = { label: "Materials", screen: "main" };
  p.TT.define(mats);
  p.TT.setEnabled("tools", true);
  p.TT.setEnabled("materials", true);
  p.TT.boot();
  same(p.TT.nav().map((n) => n.id), ["tools", "materials"], "both rows, in registration order");
  eq(p.TT.reportText({ kind: "week" }).length, 2, "both contribute to the report");
  ok(st.getItem("tt_mod_tools_schema") === "2" && st.getItem("tt_mod_materials_schema") === "2",
    "both normalized into their own namespaces");
  p.ttModStorage("tools").clear();
  eq(st.getItem("tt_mod_materials_schema"), "2", "clearing one leaves the other whole");
});


})();

// ============================================================
// wiring: the host actually mounts the platform
// ============================================================
(function(){
// t_wiring.js - the platform is only real if the app actually mounts it.
// Static assertions against the source, plus a live round-trip of the core
// backup functions over module-owned keys.
const s = source();

function has(re, label) { ok(re.test(s), label); }
function count(re) { return (s.match(re) || []).length; }
function order(a, b, label) {
  const i = s.indexOf(a), j = s.indexOf(b);
  ok(i >= 0 && j >= 0 && i < j, label);
}

// ---- the block is present, once ---------------------------------------------
test("the platform block is delimited exactly once", () => {
  eq(count(/==== TT PLATFORM BEGIN ====/g), 1, "one BEGIN marker");
  eq(count(/==== TT PLATFORM END ====/g), 1, "one END marker");
  order("TT PLATFORM BEGIN", "TT PLATFORM END", "BEGIN precedes END");
  order("TT PLATFORM END", "---- MAIN APP", "the platform is declared before the app");
});

// ---- boot --------------------------------------------------------------------
test("module normalizers run at boot, before the first paint", () => {
  has(/useState\(function\(\)\{ return ttBootModules\(\); \}\)/, "boot runs in a lazy state initializer");
  // The build strips `export default`, so anchor on a form both files share.
  const appDecl = /(export default )?function App\(\)\{/.exec(s);
  ok(appDecl, "App is declared");
  ok(appDecl.index < s.indexOf("ttBootModules()"), "boot is inside App");
  const appBody = s.slice(appDecl.index);
  const bootAt = appBody.indexOf("ttBootModules()");
  const firstLoad = appBody.indexOf('load("tt_');
  ok(bootAt < firstLoad, "boot happens before the first core load()");
});

// ---- menu nav ----------------------------------------------------------------
test("enabled module nav entries render as menu rows", () => {
  has(/var modNav=ttModuleNav\(\);/, "nav list computed per render");
  has(/modGroups\.map\(function\(g\)\{/, "grouped rows rendered in the menu");
  has(/function openModule\(entry\)\{ closeAllPopups\(\);/, "opening a module closes every other popup first");
  order("Backup & Restore", "modGroups.map", "module rows sit below the core rows");
  order("modGroups.map", "// Arrange", "and above Arrange");
});

test("opening a module screen goes through the menu bus", () => {
  // closeAllPopups is the one place that broadcasts; openModule delegating to
  // it is what keeps the every-open-site-broadcasts invariant true.
  const fn = s.slice(s.indexOf("function closeAllPopups(){"));
  const body = fn.slice(0, fn.indexOf("\n  }"));
  ok(/ttCloseMenus/.test(body), "closeAllPopups still broadcasts ttCloseMenus");
  ok(/setModScreen\(null\)/.test(body), "and closes any open module screen");
});

// ---- screens are siblings, never nested -------------------------------------
test("module screens mount as sibling overlays", () => {
  has(/modScreen && ttModuleScreen\(modScreen\.id, modScreen\.screen\)/, "screen resolved before render");
  has(/ttModuleContext\(modScreen\.id, \{/, "screen receives a module context");
  order("React.createElement(BackupModal", "ttModuleContext(modScreen.id", "mounted alongside BackupModal");
  order("ttModuleContext(modScreen.id", "React.createElement(ReportsModal", "and before ReportsModal");
  const tail = s.slice(s.indexOf("ttModuleContext(modScreen.id"));
  ok(tail.indexOf("onClose:function(){ setModScreen(null); }") < 800, "the screen can close itself");
  ok(/activeId:activeId/.test(tail.slice(0, 800)), "and is told what is running right now");
});

// ---- reports and settings ----------------------------------------------------
test("Reports collects module sections and report lines", () => {
  has(/function modReportCtx\(\)\{/, "a shared context is built once");
  has(/var modLines=ttReportText\(modReportCtx\(\)\);/, "text hook feeds the copied report");
  has(/var modSections=ttReportSections\(modReportCtx\(\)\)/, "section hook feeds the modal");
  has(/seg, nav, summary, payCard, stats, body, modSections,/, "sections render after the core rollup");
  order("out.push(\"Days with time: \"", "var modLines=ttReportText", "module lines come after the core lines");
});

test("module settings panels mount inside Themes and Layout", () => {
  has(/ttSettingsPanels\(\)\.map\(function\(m\)\{/, "panels are enumerated");
  has(/React\.createElement\(m\.settingsPanel, ttModuleContext\(m\.id,/, "each gets a module context");
  order("ttSettingsPanels()", '}, "Close")', "panels sit above the Close button");
});

// ---- Phase 1 changes nothing visible ----------------------------------------
test("exactly one module ships, and it goes through the front door", () => {
  eq(count(/TT\.define\(\{/g), 1, "one module is registered in the app source");
  eq(count(/ttDefineModule\(\{/g), 0, "and nothing bypasses TT.define");
  eq(count(/TT_REGISTRY\.push/g), 1, "the only push is inside ttDefineModule");
  eq(count(/setShowExtensions\(true\)/g), 1, "exactly one way into Extensions");
  ok(s.indexOf("// ==== TT MODULE tools BEGIN ====") > s.indexOf(END),
    "the module sits outside the platform block, after it");
  ok(s.indexOf("// ==== TT MODULE tools END ====") < s.indexOf("export default function App(){"),
    "and before App");
});

// ---- invariants the refactor must not have broken ---------------------------
test("the stacking chain is intact", () => {
  // The chain as it actually stands in this build: lifted rows and cards 70,
  // a lane with an open add-menu 90, header dropdowns 200, below-header 300,
  // the test frame 399/400, modals 900, the notification toast 950.
  has(/zIndex:70/, "lifted rows and cards at 70");
  has(/zIndex:addOpen\?90:"auto"/, "lane lift at 90");
  has(/zIndex:200/, "header dropdowns at 200");
  has(/zIndex:300/, "below-header at 300");
  has(/zIndex:900/, "modals at 900");
  has(/zIndex:950/, "toast above modals at 950");
  const modal = s.slice(s.indexOf("function Modal(props){"));
  ok(/zIndex:900/.test(modal.slice(0, 800)), "the core Modal still owns 900");
  // Module screens use the core Modal, so they inherit 900 rather than
  // inventing a layer of their own.
  eq(count(/zIndex:9[0-9][0-9]/g), 2, "nothing new was added above the modal layer");
});

test("time increment and backup rules still hold", () => {
  has(/if\(TIME_INC==="tenths"\)/, "fmtDur still consults TIME_INC per call");
  has(/var TT_KEY_PREFIX="tt_";/, "backup prefix unchanged");
  has(/var TT_MOD_PREFIX   = "tt_mod_";/, "module keys nest inside it");
});

// ---- the work day is one rule in one place ----------------------------------
// Three separate surfaces had each rolled their own idea of "today", and two of
// them had been handed the wrong list entirely. These assertions are about the
// class of bug - a day-scoped surface being passed the all-time collection.
test("every day-scoped surface reads the same work day", () => {
  has(/function workDayOf\(ts\)\{/, "there is one work-day function");
  has(/function sameWorkDay\(ts, dayKey\)\{/, "and one comparison built on it");
  has(/function todayStr\(\)\{ return workDayOf\(Date\.now\(\)\); \}/, "today goes through it too");
  // Exactly one toDateString in the file, and it is inside workDayOf.
  eq(count(/toDateString\(\)/g), 2, "no surface does its own date maths");
  const decl = s.slice(s.indexOf("function workDayOf(ts){"));
  ok(decl.indexOf("toDateString()") < 60, "the only live one is workDayOf's own");
});

test("the board and the day summary are scoped to the day, not to all time", () => {
  has(/var todayStr2=workDay\|\|todayStr\(\);/,
    "the day-scoped surfaces key off the shift being worked, not the calendar");
  has(/var todayLogs=logs\.filter\(function\(l\)\{ return recordDay\(l\)===todayStr2; \}\);/,
    "today's logs are derived once, through the stamp");
  has(/var todayDist=disruptions\.filter\(function\(d\)\{ return d\.endTime&&recordDay\(d\)===todayStr2; \}\);/,
    "and today's disruptions beside them");
  has(/var todayBreaks=breaks\.filter\(function\(b\)\{ return recordDay\(b\)===todayStr2; \}\);/,
    "and breaks on the same rule");
  has(/todayLogs:todayLogs, todayDist:todayDist,/, "the board gets the day-scoped list");
  ok(!/todayDist:disruptions/.test(s), "and never the all-time one");
  has(/React\.createElement\(DaySummary, \{ logs:todayLogs, disruptions:todayDist, breaks:todayBreaks, dayKey:todayStr2,/,
    "Day Summary is day-scoped on all three collections, and headed with the shift it is summarising");
  has(/new Date\(props\.dayKey\|\|Date\.now\(\)\)\.toLocaleDateString/,
    "its heading follows the work day, not the wall clock");
  ok(!/DaySummary, \{ logs:todayLogs, disruptions:disruptions/.test(s),
    "it no longer totals every disruption ever logged");
});

test("a session survives midnight but not a week", () => {
  has(/if\(s\.savedAt && Date\.now\(\)-s\.savedAt > 20\*3600000\) return \{\};/,
    "staleness is an elapsed-time rule, not a calendar one");
  ok(!/new Date\(s\.savedAt\)\.toDateString\(\)!==todayStr\(\)/.test(s),
    "so a shift crossing midnight is no longer thrown away at 00:00");
  has(/workDay:workDay, workDayOt:workDayOt \}\);/,
    "and the session remembers which shift it is on, and how it is paid");
  has(/typeof boot\.workDay==="string" && boot\.workDay/, "restoring brings that back");
});

test("nothing starts until the shift question is answered", () => {
  has(/if\(auto===null\)\{ askWorkDay\(now, function\(day, ot\)\{ commitClockIn\(now, day, ot\); \}\); return false; \}/,
    "an unresolved clock-in defers instead of guessing");
  has(/if\(!atWorkStart && !clockIn\(\)\) return;/,
    "and starting a project on a deferred clock-in stops too");
  // Every record that carries time must carry the day it was filed under.
  eq(count(/day:curDay\(\)/g), 3, "project logs, disruptions and breaks are all stamped");
  has(/\{id:uid\(\),day:day,projectId:null,projectName:"At Work"/, "and so is the clock-in itself");
});

test("an off-roster day raises the pay question, and only then", () => {
  has(/if\(!c\.unscheduled\)\{ then\(c\.day, null\); return; \}/,
    "a rostered answer resolves straight through with no pay question");
  has(/setDayAsk\(\{ when:now, stage:"ot", choices:OT_CHOICES, title:"Regular or Overtime\?"/,
    "an off-roster answer opens the second stage");
  has(/then:function\(_,ot\)\{ then\(c\.day, ot\); \}/,
    "which carries the chosen day through with the pay answer");
  has(/resolve\(choices\.length \? choices\[0\] : \{ day:workDayOf\(now\), unscheduled:false \}\);/,
    "a lone answer still gets classified rather than skipping the question");
  has(/if\(r\) r\(c\); else f\(c\.day, typeof c\.ot==="boolean" \? c\.ot : null\);/,
    "the first stage routes through resolve, the second answers directly");
  // The flag must reach the records, or none of the above is worth anything.
  has(/\{id:uid\(\),day:curDay\(\),ot:curOt\(\),projectId:proj\.id/, "project logs carry it");
  has(/function logIsOt\(l, otSet\)\{/, "and one rule reads it back");
  has(/if\(!logIsOt\(l, otSet\)\) return;/, "the weekly overtime split uses it");
  has(/if\(logIsOt\(l, otSet\)\) otMs\+=dur;/, "and so does the rollup");
  ok(!/otSet\[dayKeyOf\(new Date\(l\.startTime\)\)\]/.test(s),
    "nothing classifies pay off the raw timestamp any more");
});

test("the ticker states rather than flashes", () => {
  ok(!/ttBlink/.test(s), "the blink keyframe and every use of it are gone");
  ok(!/"DISRUPTED"/.test(s), "and so are the flashing flags");
  has(/@keyframes ttGlow \{ 0%,100% \{ text-shadow:0 0 6px var\(--glow-s1\); \} 50% \{ text-shadow:0 0 22px var\(--glow-s2\), 0 0 10px var\(--glow-s2\), 0 0 3px var\(--glow-s2\); \} \}/,
    "a disrupted project glows behind its text instead");
  ok(!/--glow-a|--glow-b/.test(s), "the text colour itself no longer animates");
  has(/\[data-glow='1'\]\{ animation: ttGlow 2\.4s ease-in-out infinite; \}/,
    "on the same 2.4s cycle as the running-project border");
  has(/animation: ttPulse 2\.4s ease-in-out infinite/, "which is still 2.4s, so the two match");
  has(/function glowVars\(col\)\{/, "the colours come from one helper");
  has(/return \{ "--glow-s1":tint\+"55", "--glow-s2":tint\+"E6", color:col \};/,
    "a faint halo at rest, a brighter one at the peak");
  has(/var tint = S\.mode==="light" \? hexDarken\(col,0\.35\) : hexBrighten\(col,0\.45\);/,
    "the halo goes away from the page: lighter on dark themes, darker on light ones");
  has(/function hexDarken\(hex, amt\)\{/, "which needs a darkener as well as a brightener");
  eq(count(/"data-glow":"1"/g), 2, "the name and the timer both carry the cue");
  has(/hexBrighten\(col,0\.55\),\n {11}"--pulse-s1"/, "pulseVars is unchanged");
  has(/glowVars\(S\.dangerText\)/, "and the disrupted cue is red");
});

test("a project can be nested inside another, and moved back out", () => {
  has(/var eligibleParents = nestTargets\(parents, project\|\|null, lane\);/,
    "the picker is the whole tree, not just the top level");
  ok(!/p\.lane===lane && p\.parentId===null && p\.id!==\(project&&project\.id\)/.test(s),
    "the old top-level-only filter is gone");
  has(/"-- Nothing, top level --"/, "moving out is picking nothing");
  has(/"Nested under \(optional\)"/, "and the label says what it does");
  has(/function canNestUnder\(projects, self, targetId\)\{/, "one rule guards the moves");
  has(/if\(getDescendantIds\(projects\|\|\[\], self\.id\)\.indexOf\(targetId\)>=0\) return false;/,
    "including nesting inside your own descendant");
  has(/var carried = self \? subtreeDepth\(projects, self\.id\) : 0;/,
    "and the subtree that travels with the move counts against the cap");
});

test("nesting a project does not demote it to a task", () => {
  has(/function projRole\(p\)\{/, "role is a fact of its own");
  has(/if\(p && \(p\.role==="project" \|\| p\.role==="task"\)\) return p\.role;/,
    "read from the record when it is there");
  has(/return \(p && p\.parentId!=null\) \? "task" : "project";/,
    "and falling back to the old rule for records written before it existed");
  // The edit form must not re-derive it, or moving a project under another
  // would flip it back to a task on save.
  has(/return project \? projRole\(project\) : \(\(defaultParentId\|\|null\)!=null \? "task" : "project"\);/,
    "an existing project keeps what it already is");
  has(/role: pid==null \? "project" : role/, "and only a top-level save forces project");
  has(/keys:\["task","project"\], value:role/, "with a toggle to choose when nested");
});

test("a nested project draws as a card tucked under its parent", () => {
  has(/var childTasks=subTasks\.filter\(isTaskRole\);/, "tasks and nested projects are separated");
  has(/var childProjects=subTasks\.filter\(isProjectRole\)/, "and drawn differently");
  has(/React\.createElement\(ProjectCard, \{\n\s*key:child\.id, proj:child, nestDepth:nestDepth\+1,/,
    "a nested project gets the full card, recursively");
  // The tuck: indented, pulled up over the parent's edge, top corner squared.
  has(/marginTop:isNestedCard\?"-12px":0/, "pulled up so it slides behind the parent's edge");
  // The pull must not be cancelled by a padding on the same element, which is
  // how the first attempt ended up with no overlap at all.
  ok(!/marginTop:isNestedCard[^}]*paddingTop:isNestedCard/.test(s),
    "and nothing pushes it back down again");
  has(/zIndex:\(menu\|\|stagesMenu\)\?80:stackZ\(stackOrder, proj\.id\)/,
    "the parent paints over the nested card that follows it");
  // Two cards that share a z-index fall back to DOM order, and the lower one
  // comes later - which is how first a parent, then a sibling, got covered.
  ok(!/zIndex:\(menu\|\|stagesMenu\)\?80:1,/.test(s), "not a flat value shared by every card");
  ok(!/zIndex:\(menu\|\|stagesMenu\)\?80:\(20-nestDepth\)/.test(s),
    "and not keyed on depth, which siblings share");
  has(/var stackOrder=props\.stackOrder \|\| projectStackOrder\(props\.allProjects, props\.proj\.id\);/,
    "the top card ranks the whole tree once");
  has(/stackOrder:stackOrder,/, "and hands the same ranking down");
  // A stacking context on the nesting wrapper would trap the nested card's own
  // menu under its parent, so there must not be one.
  ok(!/marginTop:isNestedCard\?"-15px":0 \}, zIndex/.test(s),
    "with no stacking context on the wrapper to trap the nested menu");
  has(/marginLeft:"0\.9rem"/, "indented from the parent");
  has(/borderTopLeftRadius:isNestedCard\?"4px":S\.radius2/, "and the top corner squared at the join");
  has(/marginBottom:isNestedCard\?0:"0\.45rem"/, "no gap below it either");
  // Tasks still roll up under the card the way they always did.
  has(/renderKids\(childTasks, 1\)/, "tasks stay as rows inside the card");
});

test("the collapsed card can see everything it reads", () => {
  const src = source();
  const card = src.slice(src.indexOf("function ProjectCard(props){"));
  const decl = card.indexOf("var childTasks=subTasks.filter(isTaskRole);");
  const early = card.indexOf("if(cardCollapsed){");
  ok(decl >= 0 && early >= 0, "both the declaration and the early return exist");
  ok(decl < early,
    "childTasks is declared above the collapsed early return that reads it");
  // var hoists the name but not the value, so this reads as fine and is not.
  ok(card.indexOf("countLabel = nested") < early, "and so is countLabel");
  ok(card.indexOf("var stackOrder=props.stackOrder") < early, "and the stack rank it paints with");
  has(/zIndex:stackZ\(stackOrder, proj\.id\)\}, pulseVars\(cardBdr\)\)/,
    "the collapsed pill takes its place in the stack too");
  has(/marginTop:isNestedCard\?"-12px":0 \} \},\n\s*React\.createElement\("div", \{\n\s*"data-pulse"/,
    "and tucks under its parent by the height it grew");
});

test("a collapsed nested pill clears its parent and hides what is under it", () => {
  // 12px taller, all of it above the text, and pulled up by exactly that much:
  // what goes under the parent is empty space, not the title.
  has(/height:isNestedCard\?"36px":"24px"/, "12px taller when nested");
  has(/padding:isNestedCard\?"12px 0\.35rem 0 0\.75rem":"0 0\.35rem 0 0\.75rem"/,
    "with the extra spent above the text");
  has(/boxSizing:"border-box"/, "border-box, so the padding comes out of the height");
  // Squaring the top corners is what turned this into a bucket last time.
  has(/borderRadius:"999px",/, "one radius for every corner");
  const pill = s.slice(s.indexOf('height:isNestedCard?"36px":"24px"'));
  ok(pill.slice(0, 900).indexOf("borderTopLeftRadius") < 0,
    "never squared against its own curve");
  // The expanded card is a rectangle, so squaring its join is right there.
  has(/borderTopLeftRadius:isNestedCard\?"4px":S\.radius2/, "the expanded card still squares its join");
  ok(!/height:isNestedCard\?"36px":"24px",\s*\n?\s*paddingTop/.test(s),
    "and no shorthand fighting a longhand");
  // Specifying paddingTop and a padding shorthand on the same element means the
  // shorthand silently wins - one source of truth only.
  ok(!/paddingTop:isNestedCard\?"12px":0/.test(s), "and no shorthand fighting a longhand");
  // The pill overlaps the card beneath it, so it cannot be see-through.
  has(/backgroundColor:isNestedCard\?S\.bg0:cardBg/, "an opaque base when nested");
  has(/backgroundImage:isNestedCard\?\("linear-gradient\("\+cardBg\+","\+cardBg\+"\)"\):"none"/,
    "with the themed tint painted over it, so the colour survives");
  has(/opacity:isNestedCard\?1:0\.92/, "and fully opaque, since 0.92 leaked too");
  // Both the expanded card and the collapsed pill tuck by the same 12px.
  eq(count(/marginTop:isNestedCard\?"-12px":0/g), 2,
    "expanded card and collapsed pill are pulled up alike");
});

test("a select hands back a string, and project ids are numbers", () => {
  // Every child lookup is a strict ===, so an unresolved "3" would file a
  // project under a parent nothing can match and drop it off the board.
  has(/function resolveParentId\(v\)\{/, "the picked value is resolved to a real id");
  has(/return hit \? hit\.id : null;/, "by matching it against the actual projects");
  has(/var pid=resolveParentId\(parentId\);/, "and save goes through it");
  has(/parentId:pid, kind:kind,/, "handing the resolved id on");
  ok(!/parentId:parentId\|\|null, kind:kind/.test(s), "never the raw select value");
});

test("nesting renders recursively rather than one level deep", () => {
  has(/function renderKids\(list, depth\)\{/, "one renderer for every level");
  has(/kids:subKids, depth:depth, renderKids:renderKids/, "handed back to each row");
  has(/kidsOpen && props\.renderKids && props\.renderKids\(kids, depth\+1\)/,
    "so a row draws its own children");
  has(/var isNest=kids\.length>0;/, "a row with children is a project, by structure not by a flag");
  has(/var canNest=depth < MAX_NEST_DEPTH-1;/, "and stops offering to nest at the cap");
  // Counting: "3 tasks" is wrong the moment one of them has work under it.
  has(/var nested = deepCount > childTasks\.length;/, "the card notices when it is deeper than one level");
  has(/countLabel = nested \? \(deepCount\+" nested"\)/, "and says so");
});

test("closing out is not deleting, and the board knows the difference", () => {
  has(/var liveProjects=openProjects\(projects\);/, "one filtered list feeds the board");
  has(/allProjects:liveProjects/, "the lanes get it");
  has(/parents:liveProjects/, "and so do the parent pickers, twice over");
  eq(count(/parents:liveProjects/g), 2, "add and edit both");
  // Reports and the archive must keep everything, or closing out loses history.
  has(/ReportsModal, \{ logs:logs, projects:projects,/, "Reports still sees every project");
  has(/ArchiveModal, \{ projects:projects, logs:logs/, "and so does the Archive");
  has(/DeleteProjectModal, \{ proj:confirmDelete, allProjects:projects/,
    "delete still resolves against the full tree, so a closed child is not orphaned");
});

test("a close stamps the record and touches nothing else", () => {
  has(/return p\.id===proj\.id \? Object\.assign\(\{\},p,\{ closedAt:at, closedNote:note\|\|"" \}\) : p;/,
    "only the one project changes");
  has(/if\(activeId!==null&&ids\.indexOf\(activeId\)>=0\)\{ finalizeProject\(Date\.now\(\)\); \}/,
    "and a running timer is banked first rather than lost");
  ok(!/closedAt[\s\S]{0,80}setLogs/.test(s), "no log is rewritten by closing");
});

test("reopening a task brings its parent back with it", () => {
  has(/for\(var i=0;i<8 && cur && cur\.parentId!=null;i\+\+\)\{/,
    "the chain of closed parents is walked, with a bound on it");
  has(/if\(cur && isClosed\(cur\)\) ids\[cur\.id\]=1; else break;/,
    "stopping at the first parent that is already open");
});

test("the last stage offers to close, and only for a finite project", () => {
  has(/if\(next && readyToClose\(next\) && closeBlockers\(projects, next\)\.length===0\)\{/,
    "the offer needs a finite project, every stage done, and nothing blocking");
  has(/setCloseOut\(\{ proj:next, blockers:\[\] \}\);/, "and it opens the modal rather than closing outright");
  // Two menus, two ready badges: the project card and the task row.
  eq(count(/readyToClose\(proj\)/g), 3, "the project menu shows the state");
  eq(count(/readyToClose\(sub\)/g), 3, "and so does the task menu");
});

test("a task takes its type from its project, but is not locked to it", () => {
  has(/return project \? projKind\(project\) : inheritedKind\(parents, defaultParentId\|\|null\);/,
    "a new task starts as whatever its project is");
  has(/if\(!project && !kindTouched\.current\) setKind\(inheritedKind\(parents, id\)\);/,
    "and follows the parent picker until the toggle is touched");
  has(/function resolveParentId\(v\)\{/, "with the picked id resolved back to a real one first");
  has(/onChange:function\(v\)\{ kindTouched\.current=true; setKind\(v\); \}/,
    "touching it stops the tracking, so an override sticks");
  // Editing an existing project must never re-derive its type from its parent.
  has(/var kindTouched=useRef\(false\);/, "the override flag is a ref, not state that resets on render");
  ok(!/setKind\(inheritedKind\(parents, v\)\);[\s\S]{0,40}project\?/.test(s),
    "and inheritance never applies to an edit");
});

test("changing a project's type asks about its tasks rather than rewriting them", () => {
  has(/if\(projKind\(data\)!==projKind\(target\)\)\{/, "only a real change raises the question");
  has(/var stale=mismatchedTasks\(next, findProj\(next, target\.id\)\);/,
    "against the saved list, not the stale one");
  has(/if\(stale\.length\) setMatchAsk\(/, "and only when something actually disagrees");
  has(/return ids\[p\.id\] \? Object\.assign\(\{\},p,\{ kind:want \}\) : p;/,
    "matching touches only the tasks that were ticked");
  has(/onMatch:function\(chosen\)\{ doMatchTasks\(matchAsk\.proj, chosen\); \}/,
    "the modal decides which tasks follow, not the caller");
  has(/if\(!tasks \|\| !tasks\.length\)\{ setMatchAsk\(null\); return; \}/,
    "and ticking nothing is a real answer: leave them all alone");
  const mm = s.slice(s.indexOf("function MatchTasksModal(props){"));
  ok(/tasks\.forEach\(function\(t\)\{ m\[t\.id\]=true; \}\)/.test(mm),
    "every task starts ticked, which is the usual intent");
  ok(/n>1 \? row\("__all"/.test(mm), "a select-all row appears only when there is more than one task");
  ok(/allOn \? "Deselect all" : "Select all"|allOn\?"Deselect all":"Select all"/.test(mm),
    "and it flips label with its state");
  ok(/noneOn \? "Leave All As Is"/.test(mm), "the confirm button says what it will do");
  ok(/onClick:function\(\)\{ onMatch\(chosen\); \}/.test(mm),
    "and hands back what was ticked");
  ok(!/onMatch\(tasks\)/.test(mm), "never the whole list regardless of the ticks");
  ok(/var chosen=tasks\.filter\(function\(t\)\{ return sel\[t\.id\]; \}\);/.test(mm),
    "which is derived from the selection, not tracked separately");
  has(/React\.createElement\(MatchTasksModal, \{/, "the prompt is mounted");
  const modal = s.slice(s.indexOf("function MatchTasksModal(props){"));
  ok(modal.indexOf("onLeave") > 0, "and can be declined");
});

test("every lifecycle fact is read through a function", () => {
  const src = source();
  const body = src.slice(src.indexOf("function projKind"));
  ok(!/\.kind==="ongoing"/.test(src), "nothing tests for ongoing directly");
  ok(!/p\.closedAt\s*[!=]==?\s*null/.test(src), "and nothing compares closedAt by hand");
  has(/function projKind\(p\)\{ return \(p && p\.kind==="finite"\) \? "finite" : "ongoing"; \}/,
    "the default is ongoing, so an existing project behaves as it always has");
  ok(body.indexOf("isClosed") > 0, "and closed is a function too");
});

// ---- iOS zoom on focus -------------------------------------------------------
// Safari zooms the page when a field with text under 16px takes focus, and does
// not zoom back out when it goes away. Closing a modal therefore left the whole
// app larger than it started. Every focusable field is pinned at 16px.
test("no focusable field is small enough to make iOS zoom", () => {
  has(/"input,select,textarea\{ font-size:16px !important; \} "/,
    "a stylesheet rule that outranks inline styles");
  has(/fontFamily:S\.fontBody,fontSize:"16px",outline:"none"/, "the shared input style is 16px");
  has(/fontSize:"16px", boxSizing:"border-box"/, "and so is the time field");
  ok(!/fontSize:"0\.9[0-9]rem",outline/.test(s), "the old sub-16px input size is gone");
  // The viewport must keep allowing zoom: preventing it would mask this rather
  // than fix it, and would take pinch-to-zoom away everywhere else.
  ok(!/maximum-scale/.test(s), "and zoom is not disabled to paper over it");
  ok(!/user-scalable/.test(s), "nor scaling locked");
});

test("Add New asks what, and the dead accordion is gone", () => {
  has(/"Add New\\u2026"/, "the row is labelled Add New with an ellipsis");
  ok(!/"Add New Item"/.test(s), "the old label is gone");
  ok(!/addMenuOpen/.test(s), "and so is the accordion state, not left write-only");
  ok(!/addMenuRef/.test(s), "including its outside-click ref");
  has(/setAddNew\(\{stage:"what"\}\)/, "the row opens the prompt");
  has(/if\(pick\.what==="chooseLane"\)\{ setAddNew\(\{stage:"lane"\}\); return; \}/, "project leads to a lane pick");
  has(/if\(pick\.what==="chooseProject"\)\{ setAddNew\(\{stage:"project"\}\); return; \}/, "task leads to a project pick");
  has(/setShowAdd\(\{ lane:pick\.lane, parentId:pick\.parentId\|\|null \}\);/,
    "and both end in the same add form");
  has(/projects:liveProjects/, "only open projects can be picked as a parent");
  // Edit Lanes was buried in the accordion; it is not an add, so it stands alone.
  has(/onClick:function\(\)\{ closeAllPopups\(\); setShowEditLanes\(true\); \},\n\s*style:\{display:"flex",alignItems:"center",gap:"0\.5rem",width:"100%"/,
    "Edit Lanes has its own settings row now the accordion is gone");
  eq(count(/"Edit Lanes"/g), 3, "the modal title and the lane's own menu keep theirs");
});

test("the project form calls a task a task", () => {
  has(/var noun = \(parentId!=null && role==="task"\) \? "Task" : "Project";/,
    "the noun follows the live parent selection and the chosen role");
  has(/project\?"Save Changes":\("Add "\+noun\)/, "the primary button uses it");
  has(/\}, "Delete "\+noun\)/, "and so does the destructive one");
  ok(!/"Add Project"/.test(s), "nothing hard-codes Add Project any more");
  ok(!/\}, "Delete Project"\)/.test(s), "nor a hard-coded Delete Project on a form button");
  // The delete-confirmation modal already branched correctly and keeps its own
  // wording, including the count of tasks that go down with a parent.
  has(/title:isSub\?"Delete Task":"Delete Project"/, "the confirmation modal is unaffected");
  // The modal title already branched on this; the buttons inside it did not.
  has(/title:showAdd\.parentId\?"Add Task":"Add to "/, "the title still agrees with them");
});

test("hexDarken is the mirror of hexBrighten", () => {
  const src = source();
  const grab = (n) => src.slice(src.indexOf("function " + n + "("), src.indexOf("\n}", src.indexOf("function " + n + "(")) + 2);
  const F = new Function(grab("hexBrighten") + grab("hexDarken") + "return {hexBrighten,hexDarken};")();
  eq(F.hexDarken("#ffffff", 0), "#ffffff", "zero changes nothing");
  eq(F.hexDarken("#ffffff", 1), "#000000", "one goes all the way");
  eq(F.hexDarken("#808080", 0.5), "#404040", "and halves in between");
  eq(F.hexBrighten("#000000", 0.5), "#808080", "the brightener still meets it coming the other way");
  eq(F.hexDarken("nonsense", 0.5), "nonsense", "a non-colour passes through untouched");
  eq(F.hexDarken(null, 0.5), null, "and so does nothing at all");
  eq(F.hexDarken("#E87070", 0.35).length, 7, "output stays a six-digit hex");
  ok(/^#[0-9a-f]{6}$/.test(F.hexDarken("#0a0b0c", 0.2)), "with leading zeroes intact");
});

test("Mono passes through what it is given", () => {
  const src = source();
  const grab = (n) => src.slice(src.indexOf("function " + n + "("), src.indexOf("\n}", src.indexOf("function " + n + "(")) + 2);
  const made = [];
  const R = { createElement: (t, p, c) => { made.push({ t: t, p: p, c: c }); return p; } };
  const F = new Function("React", "S", grab("Mono") + "return Mono;")(R, { fontMono: "M" });
  F({ "data-glow": "1", "aria-label": "x", style: { color: "red" }, children: "12:00" });
  const p = made[0].p;
  eq(p["data-glow"], "1", "a data attribute survives");
  eq(p["aria-label"], "x", "and so does an aria label");
  eq(p.style.color, "red", "the caller's style wins");
  eq(p.style.fontFamily, "M", "over the mono default it is merged into");
  eq(made[0].c, "12:00", "children still land as children");
  ok(!("children" in p), "and are not also passed as a prop");
});

test("an idle ticker says so", () => {
  eq(count(/"No Activity"/g), 2, "clocked in with nothing running, and not clocked in at all");
  ok(!/"Day Started"/.test(s), "the old label is gone");
  // The day clock keeps running and keeps its colour; only the label changed.
  has(/React\.createElement\(Mono, \{ style:\{color:S\.successDim,fontWeight:500,fontSize:"0\.8rem",whiteSpace:"nowrap"\} \}, fmtDur\(atWorkElapsed,true\)\)/,
    "the clocked-in state still shows the day timer");
});

test("the ticker is static", () => {
  ok(!/ttScroll/.test(s), "no scroll keyframe");
  ok(!/minWidth:"100vw"/.test(s), "no viewport-wide repeat units");
  ok(!/tickerUnit/.test(s), "and no duplicated copies to make a loop seamless");
  has(/tickerDate, tickerTime,/, "date and time sit fixed at the left");
});

test("the pay classification is visible where the day is", () => {
  has(/workDayOt\?"OT":"REG"/, "the menu row says which way an off-roster day went");
  has(/typeof workDayOt==="boolean" && React\.createElement/,
    "and stays out of the way on a normal rostered day");
});

test("the shift being worked is visible and correctable", () => {
  has(/"Logging to"/, "the menu says which shift time is going to");
  has(/askWorkDay\(Date\.now\(\), function\(day,ot\)\{ setWorkDay\(day,ot\); \}/,
    "and re-asks the same question to fix a mis-tap");
  has(/React\.createElement\(ClockDayModal, \{/, "the prompt is mounted");
  const modal = s.slice(s.indexOf("function ClockDayModal(props){"));
  ok(modal.indexOf("props.onCancel") > 0 && modal.indexOf("onClose:onCancel") > 0,
    "it can be backed out of without starting anything");
  ok(!/defaultChoice|preselect/.test(modal), "and it offers no default answer");
});

// ---- which shift does this moment belong to ---------------------------------
// The engine behind the clock-in prompt, lifted out and run against a real
// schedule. Everything here is pure: a schedule, a timestamp, an answer.
function loadShiftEngine() {
  const src = source();
  const grab = (name) => {
    const i = src.indexOf("function " + name + "(");
    if (i < 0) throw new Error("missing " + name);
    return src.slice(i, src.indexOf("\n}", i) + 2);
  };
  const names = ["startOfDay", "addDays", "dayKeyOf", "toMin", "workDayOf",
    "shiftSpan", "schWraps", "schMinutes", "breakOverlapMins",
    "shiftWindow", "adjacentShiftDay", "shiftContext", "shiftChoices",
    "autoWorkDay", "recordDay"];
  const body = "var DAY_KEYS=['mon','tue','wed','thu','fri','sat','sun'];" +
    names.map(grab).join("") +
    "return {" + names.join(",") + "};";
  return new Function(body)();
}

// Mon-Fri 06:00-14:30, weekends off. Chosen so the shift is nowhere near
// midnight: every boundary case below is unambiguous by hand.
const SCH = (() => {
  const d = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1 };
  const out = {};
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].forEach((k) => {
    out[k] = { on: !!d[k], start: "06:00", end: "14:30" };
  });
  return out;
})();
// A known Wednesday, so weekday maths is checkable by eye.
const WED = new Date(2026, 7, 19);
const at = (dayOffset, h, m) => new Date(2026, 7, 19 + dayOffset, h, m || 0).getTime();

test("a shift window is read off the schedule for the right weekday", () => {
  const E = loadShiftEngine();
  eq(E.dayKeyOf(WED), "wed", "the fixture really is a Wednesday");
  const w = E.shiftWindow(SCH, WED);
  ok(w, "Wednesday is worked");
  eq(new Date(w.start).getHours(), 6, "starting at 06:00");
  eq(new Date(w.end).getHours(), 14, "ending at 14:30");
  eq(new Date(w.end).getMinutes(), 30, "to the minute");
  eq(E.shiftWindow(SCH, new Date(2026, 7, 22)), null, "Saturday is not worked");
  eq(E.shiftWindow(null, WED), null, "no schedule, no window");
  const wrap = Object.assign({}, SCH, { wed: { on: true, start: "14:00", end: "06:00" } });
  const ww = E.shiftWindow(wrap, WED);
  ok(ww && ww.wraps, "an end before its start is a shift that runs past midnight");
  eq(ww.end - ww.start, 16 * 3600000, "sixteen hours, not a negative eight");
  eq(new Date(ww.end).getDate(), 20, "and it finishes on the following date");
  const zero = Object.assign({}, SCH, { wed: { on: true, start: "06:00", end: "06:00" } });
  eq(E.shiftWindow(zero, WED), null, "an end equal to its start is still nothing");
});

// ---- shifts that run past midnight ------------------------------------------
// 21:00 to 05:30, Monday through Friday. The shift is eight and a half hours
// long and belongs to the day it started on.
const NIGHTS = (() => {
  const on = { mon: 1, tue: 1, wed: 1, thu: 1, fri: 1 };
  const out = {};
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].forEach((k) => {
    out[k] = { on: !!on[k], start: "21:00", end: "05:30" };
  });
  return out;
})();

test("a wrapping shift measures its real length", () => {
  const E = loadShiftEngine();
  const sp = E.shiftSpan(NIGHTS.wed);
  eq(sp.len, 510, "eight and a half hours");
  eq(sp.start, 1260, "starting at 21:00");
  ok(sp.wraps, "flagged as wrapping");
  eq(E.schMinutes(NIGHTS.wed), 510, "and schMinutes agrees");
  ok(!E.schWraps({ on: true, start: "06:00", end: "14:30" }), "a day shift does not wrap");
  ok(!E.schWraps({ on: false, start: "21:00", end: "05:30" }), "nor does a day that is switched off");
  eq(E.schMinutes({ on: true, start: "21:00", end: "21:00" }), 0, "and zero length stays zero");
});

test("the middle of the night belongs to the shift that started yesterday", () => {
  const E = loadShiftEngine();
  const thu0200 = new Date(2026, 7, 20, 2, 0).getTime();
  const ctx = E.shiftContext(NIGHTS, thu0200, 0);
  eq(ctx.position, "inside", "02:00 Thursday is inside Wednesday's shift");
  eq(ctx.owner.getDate(), 19, "owned by Wednesday");
  eq(E.autoWorkDay(NIGHTS, thu0200, 0), new Date(2026, 7, 19).toDateString(),
    "so it files under Wednesday with no question asked");
  ok(E.autoWorkDay(NIGHTS, thu0200, 0) !== E.workDayOf(thu0200),
    "which is deliberately not what the clock says");
});

test("the ends of a wrapping shift still behave", () => {
  const E = loadShiftEngine();
  const inside = [[19, 21, 0], [19, 23, 59], [20, 0, 30], [20, 5, 29]];
  inside.forEach(([d, h, m]) => {
    const ts = new Date(2026, 7, d, h, m).getTime();
    eq(E.shiftContext(NIGHTS, ts, 0).position, "inside", d + " " + h + ":" + m + " is on shift");
    eq(E.autoWorkDay(NIGHTS, ts, 0), new Date(2026, 7, 19).toDateString(), "all filed under Wednesday");
  });
  const after = new Date(2026, 7, 20, 6, 30).getTime();      // an hour past the 05:30 finish
  const c = E.shiftContext(NIGHTS, after, 0);
  eq(c.position, "before", "06:30 Thursday is before Thursday's own 21:00 start");
  const ch = E.shiftChoices(c);
  eq(new Date(ch[0].when).getDate(), 19, "so the previous shift offered is Wednesday's");
  eq(new Date(ch[1].when).getDate(), 20, "and the upcoming one is Thursday's");
});

test("grace on a wrapping shift reaches past midnight", () => {
  const E = loadShiftEngine();
  const justAfter = new Date(2026, 7, 20, 5, 45).getTime();   // fifteen past the finish
  eq(E.shiftContext(NIGHTS, justAfter, 0).position, "before", "with no grace it asks");
  eq(E.shiftContext(NIGHTS, justAfter, 30).position, "inside", "with grace it does not");
  eq(E.autoWorkDay(NIGHTS, justAfter, 30), new Date(2026, 7, 19).toDateString(),
    "and grace does not lose track of whose shift it was");
});

test("a Saturday morning is still Friday night's shift", () => {
  const E = loadShiftEngine();
  const sat0300 = new Date(2026, 7, 22, 3, 0).getTime();
  eq(E.shiftContext(NIGHTS, sat0300, 0).position, "inside", "Friday's shift runs into Saturday");
  eq(E.autoWorkDay(NIGHTS, sat0300, 0), new Date(2026, 7, 21).toDateString(), "filed under Friday");
  const sat1200 = new Date(2026, 7, 22, 12, 0).getTime();
  eq(E.shiftContext(NIGHTS, sat1200, 0).position, "off", "by noon it is a day off again");
});

test("unpaid breaks land correctly inside a wrapping shift", () => {
  const E = loadShiftEngine();
  const night = NIGHTS.wed;
  eq(E.breakOverlapMins(night, { start: "01:00", mins: 30 }), 30,
    "a 01:00 lunch is four hours into a 21:00 shift, not twenty hours before it");
  eq(E.breakOverlapMins(night, { start: "22:00", mins: 30 }), 30, "an evening break counts too");
  eq(E.breakOverlapMins(night, { start: "12:00", mins: 30 }), 0, "midday is nowhere near this shift");
  eq(E.breakOverlapMins(night, { start: "05:15", mins: 30 }), 15,
    "a break straddling the finish deducts only the part that fits");
  eq(E.breakOverlapMins(night, { start: "20:45", mins: 30 }), 15,
    "and one straddling the start deducts only its tail");
  const day = { on: true, start: "06:00", end: "14:30" };
  eq(E.breakOverlapMins(day, { start: "12:00", mins: 30 }), 30, "day shifts are unchanged");
  eq(E.breakOverlapMins(day, { start: "05:30", mins: 60 }), 30, "including the straddled start");
  eq(E.breakOverlapMins(day, { start: "20:00", mins: 30 }), 0, "and a break outside the day");
  eq(E.breakOverlapMins(day, { start: "12:00", mins: 30 }, 12 * 60 + 10), 10,
    "pace only counts the part already behind you");
});

test("adjacent shift days skip the weekend", () => {
  const E = loadShiftEngine();
  const fri = new Date(2026, 7, 21), sat = new Date(2026, 7, 22), mon = new Date(2026, 7, 24);
  eq(E.dayKeyOf(fri), "fri", "fixture check");
  eq(E.adjacentShiftDay(SCH, sat, -1).getDate(), 21, "Saturday looks back to Friday");
  eq(E.adjacentShiftDay(SCH, sat, 1).getDate(), 24, "and forward to Monday");
  eq(E.adjacentShiftDay(SCH, mon, -1).getDate(), 21, "Monday looks back past the weekend");
  const none = {};
  ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].forEach((k) => { none[k] = { on: false }; });
  eq(E.adjacentShiftDay(none, WED, -1), null, "a schedule with nothing on terminates");
  eq(E.adjacentShiftDay(none, WED, 1), null, "in both directions");
});

test("clocking in inside the window asks nothing", () => {
  const E = loadShiftEngine();
  [[0, 6, 0], [0, 10, 0], [0, 14, 30]].forEach(([d, h, m]) => {
    const ctx = E.shiftContext(SCH, at(d, h, m), 0);
    eq(ctx.position, "inside", h + ":" + (m || "00") + " is inside the shift");
    ok(ctx.inside, "so no question is asked");
  });
  eq(E.autoWorkDay(SCH, at(0, 10, 0), 0), E.workDayOf(at(0, 10, 0)), "and it files under today");
});

test("clocking in before the shift offers previous or upcoming", () => {
  const E = loadShiftEngine();
  const ts = at(0, 4, 30);                       // 04:30 Wednesday, shift at 06:00
  const ctx = E.shiftContext(SCH, ts, 0);
  eq(ctx.position, "before", "before the window");
  eq(E.autoWorkDay(SCH, ts, 0), null, "so there is no safe default");
  const c = E.shiftChoices(ctx);
  eq(c.length, 2, "exactly two answers");
  same(c.map((x) => x.label), ["Previous shift", "Upcoming shift"], "worded from the shift, not the calendar");
  eq(new Date(c[0].when).getDate(), 18, "previous is Tuesday");
  eq(new Date(c[1].when).getDate(), 19, "upcoming is today");
  eq(c[1].day, E.workDayOf(ts), "taking the upcoming one files under today");
});

test("clocking in after the shift offers this or next", () => {
  const E = loadShiftEngine();
  const ts = at(0, 21, 40);                      // 21:40 Wednesday, shift ended 14:30
  const ctx = E.shiftContext(SCH, ts, 0);
  eq(ctx.position, "after", "after the window");
  eq(E.autoWorkDay(SCH, ts, 0), null, "still no safe default");
  const c = E.shiftChoices(ctx);
  same(c.map((x) => x.label), ["This shift", "Next shift"], "the two answers");
  eq(new Date(c[0].when).getDate(), 19, "this shift is today");
  eq(new Date(c[1].when).getDate(), 20, "next is Thursday");
});

test("clocking in on a day off offers the day itself, not just its neighbours", () => {
  const E = loadShiftEngine();
  const ctx = E.shiftContext(SCH, new Date(2026, 7, 22, 9, 0).getTime(), 0);
  eq(ctx.position, "off", "Saturday is not a shift at all");
  eq(ctx.ownDay.getDate(), 22, "but it is still a day you can work");
  const c = E.shiftChoices(ctx);
  same(c.map((x) => x.label), ["This day", "Previous shift", "Next shift"],
    "three answers, with the call-out leading");
  eq(new Date(c[0].when).getDate(), 22, "Saturday itself");
  eq(c[0].day, new Date(2026, 7, 22).toDateString(), "stamped as its own work day");
  ok(c[0].unscheduled, "and flagged as off-roster, which is what raises the pay question");
  eq(new Date(c[1].when).getDate(), 21, "Friday");
  eq(new Date(c[2].when).getDate(), 24, "Monday");
  ok(!c[1].unscheduled && !c[2].unscheduled, "the rostered shifts raise no such question");
});

test("only an unscheduled day is flagged for the pay question", () => {
  const E = loadShiftEngine();
  [at(0, 4, 30), at(0, 21, 40), at(0, 10, 0)].forEach((ts) => {
    E.shiftChoices(E.shiftContext(SCH, ts, 0)).forEach((c) => {
      ok(!c.unscheduled, "a rostered day never asks how it is paid");
    });
  });
});

test("the grace window silences the prompt near the edges", () => {
  const E = loadShiftEngine();
  const early = at(0, 5, 50);                    // ten minutes before a 06:00 start
  eq(E.shiftContext(SCH, early, 0).position, "before", "with no grace it asks");
  eq(E.shiftContext(SCH, early, 15).position, "inside", "with 15 minutes it does not");
  eq(E.autoWorkDay(SCH, early, 15), E.workDayOf(early), "and files under today");
  const late = at(0, 14, 45);
  eq(E.shiftContext(SCH, late, 0).position, "after", "the same at the end of the shift");
  eq(E.shiftContext(SCH, late, 30).position, "inside", "grace applies to both edges");
  eq(E.shiftContext(SCH, at(0, 3, 0), 15).position, "before", "but three hours early still asks");
});

test("a choice always resolves to a work-day stamp", () => {
  const E = loadShiftEngine();
  [at(0, 4, 30), at(0, 21, 40), new Date(2026, 7, 22, 9, 0).getTime()].forEach((ts) => {
    E.shiftChoices(E.shiftContext(SCH, ts, 0)).forEach((c) => {
      eq(typeof c.day, "string", "every answer carries a day stamp");
      ok(c.day.length > 0, "and it is not empty");
      eq(c.day, E.workDayOf(c.when), "matching the date it names");
    });
  });
});

test("a record with no stamp files exactly where the old code filed it", () => {
  const E = loadShiftEngine();
  const ts = at(0, 21, 40);
  eq(E.recordDay({ startTime: ts }), E.workDayOf(ts), "unstamped falls back to its own date");
  eq(E.recordDay({ startTime: ts, day: "" }), E.workDayOf(ts), "an empty stamp is no stamp");
  eq(E.recordDay({ startTime: ts, day: 5 }), E.workDayOf(ts), "and neither is a number");
  eq(E.recordDay({ startTime: ts, day: "Tue Aug 18 2026" }), "Tue Aug 18 2026",
    "a real stamp wins over the timestamp - that is the whole point");
});

test("an overnight shift is visible in the schedule, not silent", () => {
  has(/schWraps\(d\) \? "\+1d" : ""/, "the row marks a shift that ends the next day");
  has(/"aria-label": schWraps\(d\) \? "ends the next day" : ""/, "and says so out loud");
  // The old rule flagged end<=start as "end?". Only end===start does now, so
  // the wrap marker is the sole thing standing between a typo and a 23h day.
  has(/var invalid = d\.on && schMinutes\(d\)===0;/, "zero-length is still an error");
  eq(count(/schWraps\(/g), 4, "the marker is the only consumer of the wrap flag in the UI");
});

test("shiftSpan is the single source of shift length", () => {
  const src = source();
  // Nothing may re-derive a shift's length by subtracting the two clock times.
  ok(!/toMin\(day\.end\)\s*-\s*toMin\(day\.start\)/.test(src), "no open-coded subtraction");
  ok(!/e0>s0/.test(src), "the old same-day guard is gone from pace");
  has(/function shiftSpan\(day\)\{/, "there is one span function");
  has(/var sp=shiftSpan\(day\); if\(!sp\) return 0;/, "breaks are measured against it");
  has(/dk=dayKeyOf\(midnight\), sp=shiftSpan\(schedule\[dk\]\);/, "and so is pace");
  has(/var sp=shiftSpan\(schedule\[dayKeyOf\(d\)\]\);/, "and the shift window");
});

test("a wrapped shift is checked before the current day's own", () => {
  has(/prevWin && prevWin\.wraps && ts>=prevWin\.start-grace/,
    "yesterday's window gets first refusal, but only if it wraps");
  has(/return \(ctx\.inside && ctx\.owner\) \? workDayOf\(ctx\.owner\.getTime\(\)\) : null;/,
    "and the stamp follows the shift's owner, not the wall clock");
});

// ---- the two data points on a card ------------------------------------------
// distStats is the whole of the badge's arithmetic, lifted out and run for real
// rather than asserted against with a regex.
function loadDistStats() {
  const src = source();
  const grab = (name) => {
    const i = src.indexOf("function " + name + "(");
    if (i < 0) throw new Error("missing " + name);
    return src.slice(i, src.indexOf("\n}", i) + 2);
  };
  return new Function("return (function(){ " + grab("distStats") + " return distStats; })()")();
}
const DAY = 86400000;

test("distStats counts and totals only what it was asked for", () => {
  const distStats = loadDistStats();
  const now = Date.now();
  const today = new Date().toDateString();
  const list = [
    { projectId: 1, startTime: now, endTime: now + 1, duration: 600000 },
    { projectId: 1, startTime: now, endTime: now + 1, duration: 300000 },
    { projectId: 1, startTime: now - 2 * DAY, endTime: now, duration: 1200000 },
    { projectId: 2, startTime: now, endTime: now + 1, duration: 999 },
    { projectId: 1, startTime: now, endTime: null, duration: 0 }
  ];
  // The caller scopes the day; distStats just counts what it is handed.
  const todayOnly = list.filter((d) => new Date(d.startTime).toDateString() === today);
  const t = distStats(todayOnly, [1]);
  eq(t.n, 2, "today counts two");
  eq(t.ms, 900000, "and totals only those two");
  const all = distStats(list, [1]);
  eq(all.n, 3, "the running total includes the older one");
  eq(all.ms, 2100000, "and its time");
  eq(distStats(todayOnly, [2]).n, 1, "another project is not swept in");
  eq(distStats(list, [1, 2]).n, 4, "a parent rolls up its descendants");
  ok(all.n >= t.n && all.ms >= t.ms, "the running total can never be under today's");
});

test("distStats ignores what it cannot count", () => {
  const distStats = loadDistStats();
  const now = Date.now();
  same(distStats([], [1]), { n: 0, ms: 0 }, "an empty list");
  same(distStats(null, [1]), { n: 0, ms: 0 }, "no list at all");
  same(distStats([{ projectId: 1, startTime: now, endTime: null, duration: 0 }], [1]),
    { n: 0, ms: 0 }, "an open disruption has no duration yet, so it is not totalled");
  same(distStats([{ projectId: null, startTime: now, endTime: now, duration: 5 }], [1]),
    { n: 0, ms: 0 }, "a standalone disruption belongs to no project");
});

test("the badge shows history on a clean day, and hides only when there is none", () => {
  has(/if\(!total\.n\) return null;/, "no badge until the project has ever been disrupted");
  has(/var live = today\.n>0;/, "today drives the bright state");
  has(/live \? today\.n\+" "\+fmtDur\(today\.ms,true\) : "0"/, "today shows count and time");
  has(/total\.n\+" "\+fmtDur\(total\.ms,true\)/, "and so does the running total");
  ok(!/props\.distCount/.test(s), "no card reads the old single count");
  ok(!/distCount:distCount|distCount:subDistCount/.test(s), "and nothing passes it down");
  ok(/distCount:dist\.length/.test(s), "the Reports rollup keeps its own unrelated field");
  eq(count(/React\.createElement\(DistBadge,/g), 2, "one badge component, used by card and sub-task");
});

test("the popup separates the two figures it is standing behind", () => {
  has(/var today=done\.filter\(function\(d\)\{ return sameWorkDay\(d\.startTime,dayKey\); \}\);/,
    "today is split out");
  has(/var earlier=done\.filter\(function\(d\)\{ return !sameWorkDay\(d\.startTime,dayKey\); \}\);/,
    "and everything before it");
  has(/head\("Today", today, true\)/, "today is headed and bright");
  has(/head\("Earlier", earlier, false\)/, "earlier is headed and dimmed");
  has(/disruptions:allDist\.filter/, "a sub-task popup reads the full history, not just today");
});

test("style getters in the API are functions, not captured objects", () => {
  const block = s.slice(s.indexOf("==== TT PLATFORM BEGIN"), s.indexOf("==== TT PLATFORM END"));
  ok(/tokens: function\(\)\{ return S; \}/.test(block), "tokens() is a getter");
  ok(/inputStyle: function\(\)\{ return Object\.assign\(\{\}, INPUT_STYLE\); \}/.test(block), "inputStyle() copies live");
  ok(!/tokens: S/.test(block), "S is never captured directly");
});

// ---- backup really does cover module data -----------------------------------
// The core's own functions, lifted out and run over a store that contains
// module keys: this is the guarantee that enabling a module never creates data
// a backup would silently drop.
function loadBackup() {
  const a = s.indexOf("var TT_KEY_PREFIX=");
  const b = s.indexOf("function getMeta(");
  const body = s.slice(a, b) + "\nreturn { backupBuild, backupValidate, backupSummary, backupApply };";
  return new Function(body)();
}

test("a backup captures and restores module keys", () => {
  const B = loadBackup();
  const st = memStorage({
    tt_logs: "[]",
    tt_modules: '{"tools":true}',
    tt_mod_tools_items: '[{"id":"a","name":"caliper"}]',
    unrelated_key: "leave me"
  });
  const bak = B.backupBuild(st);
  eq(B.backupValidate(bak), null, "the backup validates");
  ok("tt_mod_tools_items" in bak.data, "module data is in the file");
  ok("tt_modules" in bak.data, "so is the enablement map");
  ok(!("unrelated_key" in bak.data), "non-app keys are left out");

  const fresh = memStorage({ tt_mod_tools_items: '["stale"]', tt_logs: '["old"]' });
  const res = B.backupApply(bak, fresh);
  ok(res.ok, "restore succeeds");
  eq(fresh.getItem("tt_mod_tools_items"), '[{"id":"a","name":"caliper"}]', "module data is restored exactly");
  eq(fresh.getItem("tt_modules"), '{"tools":true}', "enablement is restored");
});

test("a restore clears module data the backup did not contain", () => {
  const B = loadBackup();
  const bak = B.backupBuild(memStorage({ tt_logs: "[]" }));
  const st = memStorage({ tt_mod_ghost_items: '["orphan"]', tt_logs: '["x"]' });
  B.backupApply(bak, st);
  eq(st.getItem("tt_mod_ghost_items"), null, "orphaned module data does not survive replace-all");
});


})();

// ============================================================
// extensions: the Phase 2 switchboard
// ============================================================
(function(){
// t_extensions.js - Phase 2: the Extensions screen and the accounting it needs.
const s = source();
const has = (re, label) => ok(re.test(s), label);
const count = (re) => (s.match(re) || []).length;

function base(over) {
  return Object.assign({ id: "tools", title: "Tool Tracker", version: 1 }, over || {});
}

// ---- accounting --------------------------------------------------------------
test("usage reports only this module's keys and bytes", () => {
  const st = memStorage({ tt_logs: '["a lot of core data here"]' });
  const p = loadPlatform({ storage: st });
  p.TT.define(base());
  p.TT.define(base({ id: "materials", title: "Materials" }));
  same(p.TT.usage("tools"), { keys: 0, bytes: 0 }, "a fresh module costs nothing");
  p.ttModStorage("tools").set("items", [1, 2]);        // "[1,2]"      -> 5
  p.ttModStorage("tools").set("schema", 1);            // "1"          -> 1
  p.ttModStorage("materials").set("items", ["xxxxxxx"]);
  same(p.TT.usage("tools"), { keys: 2, bytes: 6 }, "counts stored JSON length");
  eq(p.TT.usage("materials").keys, 1, "the other module is counted separately");
  same(p.TT.usage("ghost"), { keys: 0, bytes: 0 }, "an unknown id reports nothing");
});

test("deleting a module's data touches nothing else", () => {
  const st = memStorage({ tt_logs: "[]", tt_modules: '{"tools":true}' });
  const p = loadPlatform({ storage: st });
  p.TT.define(base());
  p.TT.define(base({ id: "materials", title: "Materials" }));
  p.ttModStorage("tools").set("items", [1]);
  p.ttModStorage("materials").set("items", [2]);
  eq(p.TT.clearData("tools"), 1, "reports how many keys went");
  eq(p.TT.usage("tools").keys, 0, "its data is gone");
  eq(p.TT.usage("materials").keys, 1, "the neighbour is untouched");
  eq(st.getItem("tt_logs"), "[]", "core data untouched");
  eq(st.getItem("tt_modules"), '{"tools":true}', "enablement survives a data wipe");
  eq(p.TT.clearData("ghost"), 0, "an unknown id is a no-op");
});

test("deleting data does not disable, and disabling does not delete", () => {
  const p = loadPlatform();
  p.TT.define(base({ defaultEnabled: true }));
  p.ttModStorage("tools").set("items", [1]);
  p.TT.clearData("tools");
  eq(p.TT.isEnabled("tools"), true, "still on after a wipe");
  p.ttModStorage("tools").set("items", [1]);
  p.TT.setEnabled("tools", false);
  eq(p.TT.usage("tools").keys, 1, "still holding its data after being switched off");
});

// ---- the screen ---------------------------------------------------------------
test("the Extensions screen exists and is reachable", () => {
  has(/function ExtensionsModal\(props\)\{/, "component defined");
  has(/React\.createElement\(ExtensionsModal, \{/, "mounted in the overlay list");
  has(/setShowExtensions\(true\)/, "opened from the settings menu");
  ok(s.indexOf('"Extensions"\n              )') > 0 || /}, "Extensions"/.test(s), "a menu row labelled Extensions");
  const fn = s.slice(s.indexOf("function closeAllPopups(){"));
  ok(/setShowExtensions\(false\)/.test(fn.slice(0, fn.indexOf("\n  }"))), "closed with every other popup");
});

test("it is a sibling overlay like every other modal", () => {
  const i = s.indexOf("React.createElement(BackupModal");
  const j = s.indexOf("React.createElement(ExtensionsModal");
  const k = s.indexOf("ttModuleContext(modScreen.id");
  ok(i < j && j < k, "sits between Backup and the module screens");
  const mod = s.slice(s.indexOf("function ExtensionsModal(props){"));
  ok(/React\.createElement\(Modal, \{ title:"Extensions"/.test(mod), "built on the core Modal, no new layer");
});

test("it lists every module, not just the enabled ones", () => {
  const mod = s.slice(s.indexOf("function ExtensionsModal(props){"), s.indexOf("// ---- UNPAID BREAKS MODAL"));
  ok(/var mods=ttModules\(\);/.test(mod), "reads the whole registry");
  ok(!/ttEnabledModules\(/.test(mod), "does not filter to enabled - that would hide the switch");
  ok(/ttModuleEnabled\(m\.id\)/.test(mod), "asks each one whether it is on");
  ok(/keys:\["off","on"\]/.test(mod), "uses the core Toggle for the switch");
});

test("toggling writes through and forces the host to recompute", () => {
  const mod = s.slice(s.indexOf("function ExtensionsModal(props){"), s.indexOf("// ---- UNPAID BREAKS MODAL"));
  ok(/ttSetModuleEnabled\(m\.id, on\)/.test(mod), "persists the choice");
  ok(/props\.onChange\(\)/.test(mod), "tells the host");
  has(/onChange:function\(\)\{ setModTick\(function\(x\)\{ return x\+1; \}\); \}/, "the host bumps its tick");
  has(/var modTickS=useState\(0\)/, "the tick exists");
});

test("deleting data asks first and says how to get it back", () => {
  const mod = s.slice(s.indexOf("function ExtensionsModal(props){"), s.indexOf("// ---- UNPAID BREAKS MODAL"));
  ok(/setConfirm\(m\.id\)/.test(mod), "the delete button only arms a confirmation");
  ok(/ttClearModuleData\(m\.id\)/.test(mod), "the confirmation is what wipes");
  ok(/cannot be undone except from a backup/.test(mod), "the copy points at the backup");
  ok(/"Keep"/.test(mod), "and there is a way out");
  eq((mod.match(/ttClearModuleData/g) || []).length, 1, "exactly one call site");
});

test("the empty state explains what extensions are", () => {
  const mod = s.slice(s.indexOf("function ExtensionsModal(props){"), s.indexOf("// ---- UNPAID BREAKS MODAL"));
  ok(/mods\.length===0/.test(mod), "branches on an empty registry");
  ok(/No extensions yet/.test(mod), "says so plainly");
});

test("byte formatting stays readable at every scale", () => {
  const fmt = new Function(s.slice(s.indexOf("function fmtBytes(n){"),
    s.indexOf("function ExtensionsModal")) + "return fmtBytes;")();
  eq(fmt(0), "0 B", "zero");
  eq(fmt(512), "512 B", "bytes");
  eq(fmt(2048), "2.0 KB", "small kilobytes keep a decimal");
  eq(fmt(300000), "293 KB", "large kilobytes drop it");
  eq(fmt(3 * 1048576), "3.0 MB", "megabytes");
});

// ---- Phase 2 is the only visible change --------------------------------------
test("the shipped module is off by default, so Extensions still gates it", () => {
  ok(!/defaultEnabled/.test(s.slice(s.indexOf("// ==== TT MODULE tools BEGIN ===="))),
    "Tool Tracker never sets defaultEnabled");
  eq(count(/TT_REGISTRY\.push/g), 1, "the only push is inside ttDefineModule");
});


})();

// ============================================================
// tools: the Tool Tracker module
// ============================================================
(function(){
// The first real module. The screen itself is rendered for real by boot.js
// against the built file; what is testable here is everything underneath it -
// the normalizer, the one-open-checkout invariant, the reporting maths - plus
// the fact that the shipped spec satisfies the contract it was written against.

const MOD_BEGIN = "// ==== TT MODULE tools BEGIN ====";
const MOD_END   = "// ==== TT MODULE tools END ====";

function moduleBlock() {
  const src = source();
  const a = src.indexOf(MOD_BEGIN), b = src.indexOf(MOD_END);
  if (a < 0 || b < 0) throw new Error("module markers missing from " + SRC_PATH);
  return src.slice(a + MOD_BEGIN.length, b);
}

// Platform + module in one scope, the way they sit in the file. React is a
// recording stub: nothing here renders, but reports.section has to be able to
// build an element, and returning null has to stay distinguishable.
function loadTools(opts) {
  opts = opts || {};
  const storage = opts.storage || memStorage();
  const events = [];
  let uidSeq = 0;
  const stubs = {
    S: { bg1: "#000", bg3: "#222", border: "#111", text: "#fff", textDim: "#ccc",
      textMuted: "#999", warnText: "#fc0", radius: "10px", radius3: "6px", fontBody: "x" },
    rgba: (hex, a) => "rgba(" + hex + "," + a + ")",
    haptic: () => { events.push("haptic"); },
    Modal: function Modal() {}, ModalActions: function ModalActions() {},
    Mono: function Mono() {}, Toggle: function Toggle() {}, Carousel: function Carousel() {},
    MODAL_SAVE: () => ({ tag: "save" }), MODAL_CANCEL: () => ({ tag: "cancel" }),
    TIME_FIELD_STYLE: () => ({ tag: "time" }),
    INPUT_STYLE: { tag: "input" }, LABEL_STYLE: { tag: "label" },
    fmtDur: (ms) => ms + "ms", fmtTime: () => "T", fmtDate: () => "D",
    fmtHours: () => "", fmtMoney: () => "", pad: (n) => String(n),
    DAY_KEYS: ["mon"], DAY_LABELS: { mon: "Monday" }, dayKeyOf: () => "mon",
    isoDate: () => "", toMin: () => 0,
    startOfDay: (d) => d, addDays: (d) => d, startOfWeek: (d) => d,
    startOfMonth: (d) => d, startOfQuarter: (d) => d, startOfYear: (d) => d,
    periodRange: () => ({}), periodLabel: () => "", payCycleRange: () => ({}),
    scheduledMinutes: () => 0, scheduledToDate: () => 0, schNetMinutes: () => 0,
    uid: () => "u" + (++uidSeq),
    findProj: (list, id) => (list || []).filter((p) => p.id === id)[0] || null,
    getChildren: () => [], getDescendantIds: () => [],
    getMeta: (meta, lane) => ({ label: lane, accent: "#888", bg: "#111", dim: "#333" }),
    React: { Fragment: "Fragment",
      createElement: (type, props) => ({ type: type, props: props || {} }) },
    useState: (v) => [typeof v === "function" ? v() : v, () => {}],
    useEffect: () => {}, useRef: () => ({ current: null }),
    setInterval: () => 0, clearInterval: () => {},
    window: { dispatchEvent: (e) => { events.push(e && e.type); return true; } },
    Event: function (type) { return { type: type }; },
    localStorage: storage
  };
  const names = Object.keys(stubs);
  const body = platformBlock() + moduleBlock() +
    "\nreturn { TT, TOOLS_ID, toolsNormalize, toolsOpenMap, toolsOpenList, toolsSpan," +
    " toolsInWindow, toolsProjectList, toolsReportStats, toolsReportText, toolsReportSection," +
    " ToolsScreen, ToolsCheckoutSheet, ToolsEditorSheet, ToolsConfirmSheet };";
  const api = new Function(...names, body)(...names.map((n) => stubs[n]));
  api.storage = storage;
  api.events = events;
  api.stubs = stubs;
  api.store = api.TT.storage("tools");
  return api;
}

const HOUR = 3600000;
const T0 = 1700000000000;   // a fixed clock, so durations are exact

// ---- the shipped spec conforms ----------------------------------------------
test("Tool Tracker registers against the contract with no complaints", () => {
  const p = loadTools();
  const m = p.TT.module("tools");
  ok(m, "the module is registered");
  eq(p.TOOLS_ID, "tools", "id constant matches");
  eq(m.version, 1, "version 1");
  eq(m.defaultEnabled, false, "off until the user turns it on");
  eq(m.nav.label, "Tools", "one nav row");
  eq(m.nav.group, undefined, "no group override, so it lands under Modules");
  eq(typeof m.screens.main, "function", "nav.screen names a real screen");
  same(m.storage.keys, ["tools", "checkouts", "prefs", "schema"], "declared storage keys");
  eq(typeof m.storage.normalize, "function", "and a normalizer");
  eq(typeof m.reports.section, "function", "reports a section");
  eq(typeof m.reports.text, "function", "and copied-report lines");
  same(p.TT.validate({ id: "tools2", title: m.title, version: m.version, summary: m.summary,
    nav: m.nav, screens: m.screens, storage: m.storage, reports: m.reports }), [],
    "the same shape re-validates clean");
});

test("the module writes only inside its own namespace", () => {
  const st = memStorage({ tt_logs: "[]", tt_settings: "{}", tt_mod_materials_items: "[]" });
  const p = loadTools({ storage: st });
  p.TT.boot();
  const keys = Object.keys(st.snapshot());
  keys.forEach((k) => ok(k.indexOf("tt_") === 0, k + " stays under the backup prefix"));
  eq(st.getItem("tt_logs"), "[]", "core logs untouched");
  eq(st.getItem("tt_settings"), "{}", "core settings untouched");
  eq(st.getItem("tt_mod_materials_items"), "[]", "a neighbour module is untouched");
  ok(keys.indexOf("tt_mod_tools_tools") >= 0, "and it did write its own");
});

// ---- normalizer --------------------------------------------------------------
test("a first boot lays down the empty shape", () => {
  const p = loadTools();
  same(p.TT.boot(), ["tools"], "the normalizer ran");
  same(p.store.get("tools", null), [], "no tools");
  same(p.store.get("checkouts", null), [], "no checkouts");
  same(p.store.get("prefs", null), { holder: "" }, "prefs seeded");
  eq(p.store.get("schema", null), 1, "schema stamped");
});

test("the normalizer is idempotent", () => {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "Torque wrench", tag: "A-1" }]);
  p.store.set("checkouts", [{ id: "c1", toolId: "t1", out: T0, in: null }]);
  p.toolsNormalize(p.store);
  const first = JSON.stringify(p.store.get("checkouts", null)) + JSON.stringify(p.store.get("tools", null));
  p.toolsNormalize(p.store);
  p.toolsNormalize(p.store);
  eq(JSON.stringify(p.store.get("checkouts", null)) + JSON.stringify(p.store.get("tools", null)),
    first, "running it three times changes nothing after the first");
});

test("hostile saves are repaired, not fatal", () => {
  const cases = [
    { tools: "not an array", checkouts: 7, prefs: [] },
    { tools: [null, 3, "x", []], checkouts: [null, "x", {}], prefs: "nope" },
    { tools: [{ name: 42 }], checkouts: [{ toolId: 9, out: "soon" }], prefs: { holder: 12 } }
  ];
  cases.forEach((seed, i) => {
    const p = loadTools();
    Object.keys(seed).forEach((k) => p.store.set(k, seed[k]));
    doesNotThrow(() => p.toolsNormalize(p.store), "case " + i + " does not throw");
    ok(Array.isArray(p.store.get("tools", null)), "case " + i + " leaves tools an array");
    ok(Array.isArray(p.store.get("checkouts", null)), "case " + i + " leaves checkouts an array");
    eq(typeof p.store.get("prefs", null).holder, "string", "case " + i + " leaves holder a string");
  });
});

test("a nameless tool is dropped and the rest survive", () => {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "  Mallet  " }, { id: "t2", name: "   " },
    { id: "t3" }, { id: "t4", name: "Caliper", tag: 5, category: null, notes: "keep" }]);
  p.toolsNormalize(p.store);
  const tools = p.store.get("tools", []);
  same(tools.map((t) => t.name), ["Mallet", "Caliper"], "only usable tools remain");
  eq(tools[1].tag, "", "a non-string tag becomes empty, not \"5\"");
  eq(tools[1].category, "", "same for category");
  eq(tools[1].notes, "keep", "notes survive");
  ok(tools[0].createdAt > 0, "a missing createdAt is backfilled");
});

test("duplicate ids collapse and missing ids are minted", () => {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "First" }, { id: "t1", name: "Shadow" },
    { name: "Anon A" }, { name: "Anon B" }]);
  p.toolsNormalize(p.store);
  const tools = p.store.get("tools", []);
  same(tools.map((t) => t.name), ["First", "Anon A", "Anon B"], "the shadow is dropped");
  eq(new Set(tools.map((t) => t.id)).size, 3, "every id is distinct");
});

test("a checkout with no start time is not a record", () => {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "Mallet" }]);
  p.store.set("checkouts", [{ id: "c1", toolId: "t1" }, { id: "c2", toolId: "t1", out: 0 },
    { id: "c3", toolId: "t1", out: T0 }]);
  p.toolsNormalize(p.store);
  same(p.store.get("checkouts", []).map((c) => c.id), ["c3"], "only the one with a clock survives");
});

test("a check-in earlier than the check-out is treated as still out", () => {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "Mallet" }]);
  p.store.set("checkouts", [{ id: "c1", toolId: "t1", out: T0, in: T0 - HOUR }]);
  p.toolsNormalize(p.store);
  eq(p.store.get("checkouts", [])[0].in, null, "the impossible timestamp is discarded");
});

// The invariant the whole module rests on.
test("a tool can only be out once", () => {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "Mallet" }, { id: "t2", name: "Caliper" }]);
  p.store.set("checkouts", [
    { id: "c1", toolId: "t1", out: T0, in: null },
    { id: "c2", toolId: "t1", out: T0 + 2 * HOUR, in: null },
    { id: "c3", toolId: "t2", out: T0 + HOUR, in: null }
  ]);
  p.toolsNormalize(p.store);
  const cos = p.store.get("checkouts", []);
  const open = cos.filter((c) => c.in === null);
  same(open.map((c) => c.id).sort(), ["c2", "c3"], "one open record per tool");
  eq(cos.filter((c) => c.id === "c1")[0].in, T0 + 2 * HOUR,
    "the older record is closed when the newer opened, not deleted");
  eq(p.toolsOpenList(cos).length, 2, "and the open list agrees");
});

test("a checkout outlives its tool but cannot stay open", () => {
  const p = loadTools();
  p.store.set("tools", []);
  p.store.set("checkouts", [{ id: "c1", toolId: "gone", toolName: "Old Grinder", out: T0, in: null },
    { id: "c2", toolId: "gone2", out: T0, in: null }]);
  p.toolsNormalize(p.store);
  const cos = p.store.get("checkouts", []);
  eq(cos[0].in, T0, "nothing could check it in, so it is closed at zero length");
  eq(cos[0].toolName, "Old Grinder", "the snapshot keeps the history readable");
  eq(cos[1].toolName, "Removed tool", "and a missing snapshot still reads as something");
  same(p.toolsOpenList(cos), [], "nothing is left dangling open");
});

test("checkouts come back in time order however they were saved", () => {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "Mallet" }]);
  p.store.set("checkouts", [
    { id: "c2", toolId: "t1", out: T0 + 2 * HOUR, in: T0 + 3 * HOUR },
    { id: "c1", toolId: "t1", out: T0, in: T0 + HOUR }
  ]);
  p.toolsNormalize(p.store);
  same(p.store.get("checkouts", []).map((c) => c.id), ["c1", "c2"], "oldest first");
});

test("a null project id survives; it means no job, not missing data", () => {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "Mallet" }]);
  p.store.set("checkouts", [{ id: "c1", toolId: "t1", out: T0, projectId: null, projectName: "" },
    { id: "c2", toolId: "t1", out: T0 + HOUR, projectId: 7, projectName: "Laminating" }]);
  p.toolsNormalize(p.store);
  const cos = p.store.get("checkouts", []);
  eq(cos[0].projectId, null, "no job stays no job");
  eq(cos[1].projectId, 7, "a numeric project id is kept as-is");
  eq(cos[1].projectName, "Laminating", "with its name snapshotted");
});

// ---- windowing ---------------------------------------------------------------
test("a checkout is measured only inside the window being viewed", () => {
  const p = loadTools();
  const range = { start: T0, end: T0 + 4 * HOUR };
  eq(p.toolsSpan({ out: T0 + HOUR, in: T0 + 2 * HOUR }, range), HOUR, "wholly inside");
  eq(p.toolsSpan({ out: T0 - HOUR, in: T0 + HOUR }, range), HOUR, "clipped at the start");
  eq(p.toolsSpan({ out: T0 + 3 * HOUR, in: T0 + 9 * HOUR }, range), HOUR, "clipped at the end");
  eq(p.toolsSpan({ out: T0 - HOUR, in: T0 + 9 * HOUR }, range), 4 * HOUR, "spanning the whole window");
  eq(p.toolsSpan({ out: T0 + 8 * HOUR, in: T0 + 9 * HOUR }, range), 0, "wholly after");
  eq(p.toolsSpan({ out: T0 + HOUR, in: null }, range, T0 + 2 * HOUR), HOUR, "an open record runs to now");
  eq(p.toolsSpan({ out: T0 + HOUR, in: null }, range, T0 + 99 * HOUR), 3 * HOUR,
    "and is still clipped by the window");
});

test("window membership is half-open at both ends", () => {
  const p = loadTools();
  const range = { start: T0, end: T0 + HOUR };
  ok(p.toolsInWindow({ out: T0, in: T0 + HOUR }, range), "exactly filling it counts");
  ok(!p.toolsInWindow({ out: T0 + HOUR, in: T0 + 2 * HOUR }, range), "starting at the end does not");
  ok(!p.toolsInWindow({ out: T0 - HOUR, in: T0 }, range), "ending at the start does not");
  ok(p.toolsInWindow({ out: T0 - HOUR, in: null }, range, T0 + 9 * HOUR), "an open record counts");
  ok(p.toolsInWindow({ out: T0, in: T0 }, { start: null, end: null }), "no window means everything");
});

// ---- reporting ---------------------------------------------------------------
function seeded(now) {
  const p = loadTools();
  p.store.set("tools", [{ id: "t1", name: "Mallet" }, { id: "t2", name: "Caliper" },
    { id: "t3", name: "Grinder" }]);
  p.store.set("checkouts", [
    { id: "c1", toolId: "t1", toolName: "Mallet", out: T0, in: T0 + 2 * HOUR, projectName: "Laminating" },
    { id: "c2", toolId: "t2", toolName: "Caliper", out: T0 + HOUR, in: T0 + 2 * HOUR },
    { id: "c3", toolId: "t3", toolName: "Grinder", out: T0 + 3 * HOUR, in: null }
  ]);
  p.toolsNormalize(p.store);
  p.now = now || T0 + 4 * HOUR;
  return p;
}

test("the report counts and totals against the viewed window", () => {
  const p = seeded();
  const st = p.toolsReportStats({ storage: p.store, range: { start: T0, end: T0 + 4 * HOUR }, now: p.now });
  eq(st.count, 3, "all three overlap the window");
  eq(st.ms, 2 * HOUR + HOUR + HOUR, "total time out is the sum of the clipped spans");
  eq(st.still.length, 1, "one is still out");
  eq(st.still[0].toolName, "Grinder", "and it is named");
  same(st.top.map((r) => r.name), ["Mallet", "Caliper", "Grinder"], "busiest tool first");
});

test("a narrower window excludes what falls outside it", () => {
  const p = seeded();
  const st = p.toolsReportStats({ storage: p.store, range: { start: T0 + 2 * HOUR, end: T0 + 3 * HOUR }, now: p.now });
  eq(st.count, 0, "nothing overlaps that hour");
  eq(st.ms, 0, "so there is nothing to total");
  eq(st.still.length, 1, "but still-out is about now, not about the window");
});

test("report lines read like the core's own", () => {
  const p = seeded();
  const ctx = { storage: p.store, range: { start: T0, end: T0 + 4 * HOUR }, now: p.now };
  const lines = p.toolsReportText(ctx);
  eq(lines.length, 3, "three lines");
  ok(/^Tool checkouts: 3$/.test(lines[0]), "count first");
  ok(/^Tool time out: /.test(lines[1]), "then the total");
  ok(/^Still out: 1 \(Grinder\)$/.test(lines[2]), "then what is unaccounted for");
  lines.forEach((l) => eq(typeof l, "string", "every line is a string the host will accept"));
});

test("the report stays silent when there is nothing to say", () => {
  const p = loadTools();
  p.TT.boot();
  const ctx = { storage: p.store, range: { start: T0, end: T0 + HOUR }, now: T0 };
  same(p.toolsReportText(ctx), [], "no lines");
  eq(p.toolsReportSection(ctx), null, "and no section, so Reports is unchanged");
});

test("the section renders once there is something to show", () => {
  const p = seeded();
  const el = p.toolsReportSection({ storage: p.store, range: { start: T0, end: T0 + 4 * HOUR }, now: p.now });
  ok(el && typeof el === "object", "an element comes back");
  eq(el.type, "div", "a plain div, not a modal or a new layer");
});

test("a long still-out list is truncated rather than run on", () => {
  const p = loadTools();
  const tools = [], cos = [];
  for (let i = 0; i < 7; i++) {
    tools.push({ id: "t" + i, name: "Tool " + i });
    cos.push({ id: "c" + i, toolId: "t" + i, out: T0 + i, in: null });
  }
  p.store.set("tools", tools); p.store.set("checkouts", cos);
  p.toolsNormalize(p.store);
  const lines = p.toolsReportText({ storage: p.store, range: { start: T0, end: T0 + HOUR }, now: T0 + HOUR });
  ok(/Still out: 7 \(Tool 0, Tool 1, Tool 2, Tool 3, \.\.\.\)/.test(lines[lines.length - 1]),
    "four names then an ellipsis");
});

// The reason the host now wraps the report context: a module reads its own data
// through ctx.storage, exactly as a screen does.
test("the host hands the reports hook a real module context", () => {
  const p = seeded();
  p.TT.setEnabled("tools", true);
  const lines = p.TT.reportText({ kind: "day", range: { start: T0, end: T0 + 4 * HOUR }, now: p.now });
  eq(lines.length, 3, "the lines arrive through TT.reportText with no storage passed in");
  const secs = p.TT.reportSections({ kind: "day", range: { start: T0, end: T0 + 4 * HOUR }, now: p.now });
  eq(secs.length, 1, "and so does the section");
  eq(secs[0].id, "tools", "tagged with the module id");
});

test("a disabled Tool Tracker contributes nothing to Reports", () => {
  const p = seeded();
  same(p.TT.reportText({ range: { start: T0, end: T0 + 4 * HOUR }, now: p.now }), [], "no lines");
  same(p.TT.reportSections({ range: { start: T0, end: T0 + 4 * HOUR }, now: p.now }), [], "no section");
  same(p.TT.nav(), [], "and no menu row");
});

test("switching it on lights up the menu row", () => {
  const p = loadTools();
  p.TT.setEnabled("tools", true);
  const nav = p.TT.nav();
  eq(nav.length, 1, "one row");
  eq(nav[0].label, "Tools", "labelled Tools");
  eq(nav[0].group, "Modules", "under the default group");
  eq(typeof p.TT.screen("tools", nav[0].screen), "function", "and it opens a real screen");
});

test("its data survives being switched off and comes back intact", () => {
  const p = seeded();
  p.TT.setEnabled("tools", true);
  p.TT.setEnabled("tools", false);
  eq(p.store.get("checkouts", []).length, 3, "the log is untouched");
  eq(p.TT.usage("tools").keys, 4, "all four keys still accounted for");
  p.TT.setEnabled("tools", true);
  eq(p.TT.reportText({ range: { start: T0, end: T0 + 4 * HOUR }, now: p.now }).length, 3,
    "and it reports again the moment it is back on");
});

test("Delete data wipes the module and nothing else", () => {
  const st = memStorage({ tt_logs: "[]" });
  const p = seeded();
  const p2 = loadTools({ storage: st });
  p2.TT.boot();
  eq(p2.TT.clearData("tools"), 4, "four keys removed");
  eq(st.getItem("tt_logs"), "[]", "core data untouched");
  eq(p2.TT.usage("tools").keys, 0, "the module is holding nothing");
  doesNotThrow(() => p2.toolsNormalize(p2.store), "and it boots clean from empty again");
  same(p2.store.get("tools", null), [], "back to the empty shape");
  ok(p.store.get("tools", []).length === 3, "an unrelated instance is unaffected");
});

// ---- project picker ----------------------------------------------------------
test("the picker lists projects depth-first in board order", () => {
  const p = loadTools();
  const projects = [
    { id: 2, name: "Second", parentId: null, order: 1 },
    { id: 1, name: "First", parentId: null, order: 0 },
    { id: 3, name: "First child", parentId: 1, order: 0 },
    { id: 4, name: "Grandchild", parentId: 3, order: 0 }
  ];
  const list = p.toolsProjectList(projects);
  same(list.map((e) => e.p.name), ["First", "First child", "Grandchild", "Second"], "board order");
  same(list.map((e) => e.depth), [0, 1, 2, 0], "indented by depth");
});

test("the picker survives a broken parent chain", () => {
  const p = loadTools();
  doesNotThrow(() => p.toolsProjectList([{ id: 1, name: "Orphan", parentId: 99 }]),
    "a dangling parent does not throw");
  same(p.toolsProjectList([{ id: 1, name: "Orphan", parentId: 99 }]), [],
    "and an unreachable project simply does not appear");
  const cycle = [{ id: 1, name: "A", parentId: null }, { id: 2, name: "B", parentId: 1 }];
  cycle[0].parentId = 2;
  doesNotThrow(() => p.toolsProjectList(cycle), "a cycle terminates instead of spinning");
  same(p.toolsProjectList([]), [], "an empty board gives an empty picker");
  same(p.toolsProjectList(null), [], "and so does no board at all");
});

// ---- open/closed helpers -----------------------------------------------------
test("open lookups agree with each other", () => {
  const p = seeded();
  const cos = p.store.get("checkouts", []);
  const map = p.toolsOpenMap(cos), list = p.toolsOpenList(cos);
  eq(list.length, 1, "one open record");
  eq(map[list[0].toolId].id, list[0].id, "and the map points at the same one");
  same(p.toolsOpenMap([]), {}, "empty in, empty out");
  same(p.toolsOpenList(null), [], "and a missing list is not a crash");
});

// ---- source-level invariants -------------------------------------------------
test("the module obeys the house rules", () => {
  const src = source();
  const block = src.slice(src.indexOf(MOD_BEGIN), src.indexOf(MOD_END));
  ok(!/localStorage/.test(block), "it never touches localStorage directly");
  ok(!/\btt_mod_/.test(block), "and never builds a storage key by hand");
  ok(!/zIndex/.test(block), "it invents no stacking layer of its own");
  ok(/React\.createElement\(React\.Fragment/.test(block),
    "sheets mount as siblings, not nested inside the main modal");
  ok(/api\.tokens\(\)/.test(block), "tokens are read live, per render");
  ok(!/var S ?= ?S\b/.test(block), "no load-time token snapshot");
  ok(/api\.closeMenus\(\)/.test(block), "opening a sheet broadcasts on the menu bus");
  ok(/UIkit\.Modal/.test(block), "it uses the core Modal rather than its own");
  ok(/api\.fmt\.dur\(/.test(block), "durations go through the core formatter, so Tenths still works");
  ok(!/setTimeout/.test(block), "no stray timers besides the ticking interval");
  ok(/clearInterval/.test(block), "and the interval it does start is cleaned up");
});

})();

// ---- run --------------------------------------------------------------------
console.log("");
const bad = syntaxCheck();
const r = report("suites     ");
console.log(bad || r.fail ? "\nFAILED\n" : "\nall green\n");
process.exit(bad || r.fail ? 1 : 0);
