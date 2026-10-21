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
    " ttReportSections, ttReportText, TT_REGISTRY, TT_BOOTED, TT_ENABLED_KEY, TT_MOD_PREFIX," +
    " ttMemoryStorage, ttValidateHelp, TT_HELP_FIELDS };";
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

// ---- the store: one doorway to the board's data (10-20) -------------------
// The seam the shared board is built on. Everything the core keeps goes
// through ttDb; its backend is swappable, so a sync layer can sit under it.
test("the core reaches its stored data only through ttDb", () => {
  const src = source();
  const a = src.indexOf("// ==== TT PLATFORM BEGIN ===="), b = src.indexOf("// ==== TT PLATFORM END ====");
  const d0 = src.indexOf("// ---------------- The store: one doorway"), d1 = src.indexOf("function save(key, val){");
  ok(a > 0 && b > a && d0 > 0 && d1 > d0, "the platform block and the store block are where they should be");
  const core = (src.slice(0, d0) + src.slice(d1, a) + src.slice(b)).replace(/\/\/.*$/gm, "");
  const hits = core.split("\n").map((l, i) => [i, l]).filter(([i, l]) => /\blocalStorage\b/.test(l));
  eq(hits.length, 0, "no core code outside the store names localStorage" + (hits.length ? "  [" + hits.map((h) => h[1].trim().slice(0, 60)).join(" | ") + "]" : ""));
  const store = src.slice(d0, d1 + 200);
  eq((store.replace(/\/\/.*$/gm, "").match(/\blocalStorage\b/g) || []).length, 1, "the store names it once: the default backend");
  ok(/function load\(key, def\)\{ try\{ var v=ttDb\.getRaw\(key\);/.test(src), "load() reads through the store");
  ok(/function save\(key, val\)\{ try\{ ttDb\.setRaw\(key, JSON\.stringify\(val\)\); \}/.test(src), "save() writes through it");
  eq((src.match(/^function load\(/gm) || []).length, 1, "load is defined once");
  eq((src.match(/^function save\(/gm) || []).length, 1, "save is defined once");
  eq((src.match(/^function ttDbUse\(/gm) || []).length, 1, "the backend can be swapped, in one place");
  ok(!/indexedDB/.test(src.slice(d0, d1)), "the store is the board's data; Saves keep their own IndexedDB");
  const plat = src.slice(a, b);
  ok(/if\(typeof ttDbBackend==="function"\) return ttDbBackend\(\);/.test(plat), "modules reach the same backend through ttStore");
});

// ---- ids and change tracking (10-20, shared board step 2) ------------------
test("records get long ids, and the real board is change-tracked at save time", () => {
  const src = source();
  ok(/crypto\.randomUUID\(\)/.test(src.slice(src.indexOf("function uid(){"), src.indexOf("function uid(){") + 500)),
    "uid() uses the browser's UUID where it has one");
  ok(!/function uid\(\)\{ return Math\.random\(\)\.toString\(36\)\.slice\(2,9\); \}/.test(src), "the old 7-character uid is gone");
  ok(/function newProjectId\(projects\)\{ return uid\(\); \}/.test(src), "a new project id is a long id too");
  eq((src.match(/Math\.max\(mx,\s*p\.id\)/g) || []).length, 0, "no 'highest id + 1' left anywhere");
  ok(/var id=newProjectId\(projects\);/.test(src), "Add takes its id from the one place");
  [["tt_projects","realProjects"],["tt_logs","realLogs"],["tt_disruptions","realDist"],["tt_breaks","realBreaks"]].forEach(([k, v]) =>
    ok(src.indexOf('useEffect(function(){ saveTracked("' + k + '",' + v + '); },[' + v + ']);') >= 0, k + " is saved through saveTracked"));
  ["tt_test_projects","tt_test_logs","tt_test_disruptions","tt_test_breaks"].forEach((k) =>
    ok(src.indexOf('useEffect(function(){ save("' + k + '",') >= 0 && src.indexOf('saveTracked("' + k + '"') < 0, k + " is NOT tracked: the Practice Board is never shared"));
  eq((src.match(/saveTracked\("/g) || []).length, 4, "exactly the four real collections are tracked");
  ok(/var TT_TRACKED = \["tt_projects","tt_logs","tt_disruptions","tt_breaks"\];/.test(src), "and the list says so");
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

// ---- the help field -----------------------------------------------------------
// A module brings its own pages for the User Manual. Same shapes as the core
// registries, ids namespaced <id>:<key>, and a stage renderer of its own.
function helpSpec(extra) {
  return Object.assign({
    topic: "Tools",
    stage: function (stage, ctx) { return { staged: stage.kind }; },
    pictures: { "tools:screen": { title: "The screen", stage: { kind: "screen" },
      parts: [{ anchor: '[data-anchor="a"]', label: "A", text: "Words." }] } },
    guides: { "tools:out": { title: "Check out",
      steps: [{ stage: { kind: "screen" }, ring: '[data-anchor="a"]', title: "Tap", text: "Words." }] } }
  }, extra || {});
}
function withHelp(help) { return Object.assign(refModule(), { help: help }); }

test("a module may bring its own help, held to the same contract", () => {
  const p = loadPlatform();
  ok(p.TT_HELP_FIELDS.join() === "topic,pictures,guides,stage", "help has exactly four fields");
  same(p.TT.validate(withHelp(helpSpec())), [], "a well-formed help block is conformant");
  const m = p.TT.define(withHelp(helpSpec()));
  eq(m.help.topic, "Tools", "and registration keeps it");
  eq(typeof m.help.stage, "function", "with its stage renderer");
  const p2 = loadPlatform();
  eq(p2.TT.define(refModule()).help, null, "a module without help registers with help:null");
});

test("help that breaks the contract is rejected at load", () => {
  const p = loadPlatform();
  const bad = (h, re, label) => {
    const errs = p.TT.validate(withHelp(h));
    ok(errs.some((e) => re.test(e)), label + "  [" + errs.join(" | ") + "]");
    let threw = false; try { loadPlatform().TT.define(withHelp(h)); } catch (e) { threw = true; }
    ok(threw, label + " - and define throws");
  };
  bad([], /help must be an object/, "an array is not a help block");
  bad(helpSpec({ extra: 1 }), /unknown help field: extra/, "an unknown help field is a typo");
  bad(helpSpec({ topic: " " }), /help\.topic is required/, "a topic is required");
  bad(helpSpec({ stage: undefined }), /help\.stage is required/, "pictures need a stage renderer");
  bad(helpSpec({ stage: "x" }), /help\.stage must be a function/, "the renderer is a function");
  bad(helpSpec({ pictures: { screen: { title: "T", stage: {}, parts: [{}] } } }), /key must be tools:<slug>: screen/,
    "a bare key could collide with the core, so ids are namespaced");
  bad(helpSpec({ pictures: { "other:screen": { title: "T", stage: {}, parts: [{}] } } }), /key must be tools:<slug>/,
    "and namespaced with the module's OWN id");
  bad(helpSpec({ pictures: { "tools:Bad Key": { title: "T", stage: {}, parts: [{}] } } }), /key must be tools:<slug>/,
    "the part after the colon is a slug");
  bad(helpSpec({ pictures: { "tools:screen": { title: "T", parts: [{}] } } }), /tools:screen needs a stage/,
    "a picture needs a stage");
  bad(helpSpec({ pictures: { "tools:screen": { title: "T", stage: {}, parts: [] } } }), /tools:screen needs parts/,
    "and something to point at");
  bad(helpSpec({ guides: { "tools:out": { steps: [] } } }), /tools:out needs a title/, "a guide needs a title");
  bad(helpSpec({ guides: { "tools:out": { title: "T", steps: [{ stage: {}, title: "x", text: "y" }] } } }),
    /tools:out step 1 needs stage, ring, title and text/, "every step rings something");
  bad(helpSpec({ guides: { "tools:out": { title: "T", steps: [{ ring: "[x]", title: "x", text: "y" }] } } }),
    /step 1 needs stage/, "and is drawn on a stage - a module has no practice-only steps");
});

test("a staged module draws from memory, never from storage", () => {
  const st = memStorage({ tt_logs: "[]" });
  const p = loadPlatform({ storage: st });
  const before = JSON.stringify(st.snapshot());
  const mem = p.ttMemoryStorage();
  eq(mem.get("tools", "dflt"), "dflt", "missing reads give the default");
  ok(mem.set("tools", [{ id: "a" }]) === true, "a write reports success");
  const got = mem.get("tools", []); got.push({ id: "b" });
  eq(mem.get("tools", []).length, 1, "reads are copies, like JSON round-tripped storage");
  same(mem.keys(), ["tools"], "keys lists what was set");
  mem.remove("tools"); same(mem.keys(), [], "remove removes");
  mem.set("a", 1); mem.set("b", 2); mem.clear(); same(mem.keys(), [], "clear clears");
  eq(JSON.stringify(st.snapshot()), before, "and not one byte reached localStorage");
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
  // The exported App is a thin wrapper round an error boundary; the board
  // itself is TTBoard, and that is what has to run the boot.
  const appDecl = /function TTBoard\(\)\{/.exec(s);
  ok(appDecl, "the board component is declared");
  ok(appDecl.index < s.indexOf("ttBootModules()"), "boot is inside it");
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
  order("Backup & Saves", "modGroups.map", "module rows sit below the core rows");
  // The tutorial row moved to the TOP of the menu at Brent's request; the
  // User Manual row (which now holds the practice board) took its place.
  order("// USER MANUAL row", "modGroups.map", "the User Manual row sits above the module rows");
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
  // Scoped to the board: the User Manual stages BackupModal and ReportsModal
  // too, earlier in the file, and a whole-file search found those instead.
  const brd = s.indexOf("function TTBoard(){");
  const at = (x) => s.indexOf(x, brd);
  ok(at("React.createElement(BackupModal") > 0 && at("React.createElement(BackupModal") < at("ttModuleContext(modScreen.id"), "mounted alongside BackupModal");
  ok(at("ttModuleContext(modScreen.id") < at("React.createElement(ReportsModal"), "and before ReportsModal");
  const tail = s.slice(s.indexOf("ttModuleContext(modScreen.id"));
  ok(tail.indexOf("onClose:function(){ setModScreen(null); }") < 800, "the screen can close itself");
  ok(/activeId:activeId/.test(tail.slice(0, 800)), "and is told what is running right now");
});

// ---- reports and settings ----------------------------------------------------
test("Reports collects module sections and report lines", () => {
  has(/function modReportCtx\(\)\{/, "a shared context is built once");
  has(/var modLines=ttReportText\(modReportCtx\(\)\);/, "text hook feeds the copied report");
  has(/var modSections=ttReportSections\(modReportCtx\(\)\)/, "section hook feeds the modal");
  // A range is {start,end}; from/to do not exist on it, and passing those
  // names made the milestone window undefined and the section invisible.
  has(/milestoneReport\(props\.projects\|\|\[\], props\.laneOrder\|\|\[\], range\.start, range\.end-1, now\)/,
    "the milestone window comes from the range's real fields");
  has(/seg, nav, summary, payCard, stats, milestones, body, modSections,/,
    "milestones sit between the stats and the project breakdown; module sections after the core rollup");
  order("out.push(\"Days with time: \"", "var modLines=ttReportText", "module lines come after the core lines");
});

test("module settings panels mount inside the Layout screen", () => {
  has(/ttSettingsPanels\(\)\.map\(function\(m\)\{/, "panels are enumerated");
  has(/React\.createElement\(m\.settingsPanel, ttModuleContext\(m\.id,/, "each gets a module context");
  // Scoped to LayoutModal: Themes has its own Close button earlier in the file,
  // so an unscoped search would measure against the wrong one and pass on
  // whichever modal happened to come first.
  const lay = s.slice(s.indexOf("function LayoutModal(props){"),
                      s.indexOf("// ---- EDIT DISRUPTION PRESETS MODAL"));
  ok(lay.indexOf("ttSettingsPanels()") >= 0, "they are enumerated in Layout, not Themes");
  ok(lay.indexOf("ttSettingsPanels()") < lay.indexOf('}, "Close")'),
    "panels sit above the Close button");
  const thm = s.slice(s.indexOf("function ThemesModal(props){"),
                      s.indexOf("function LayoutModal(props){"));
  ok(thm.indexOf("ttSettingsPanels") < 0, "and Themes does not mount them a second time");
});

test("Themes and Layout are two separate screens", () => {
  eq(count(/function ThemesModal\(props\)\{/g), 1, "a Themes modal exists");
  eq(count(/function LayoutModal\(props\)\{/g), 1, "a Layout modal exists");
  eq(count(/function SettingsModal\(props\)\{/g), 0, "and the combined one is gone");
  eq(count(/setShowThemes\(true\)/g), 1, "exactly one way into Themes");
  eq(count(/setShowLayout\(true\)/g), 1, "exactly one way into Layout");
  has(/setShowThemes\(false\); setShowLayout\(false\);/, "closeAllPopups closes both");
  // The appearance controls belong to Themes and the reach controls to Layout;
  // a control in both would fight itself through two live copies of settings.
  const thm = s.slice(s.indexOf("function ThemesModal(props){"),
                      s.indexOf("function LayoutModal(props){"));
  const lay = s.slice(s.indexOf("function LayoutModal(props){"),
                      s.indexOf("// ---- EDIT DISRUPTION PRESETS MODAL"));
  ["theme","palette","typeface","mode"].forEach((n) => {
    ok(thm.indexOf('name:"' + n + '"') >= 0, n + " is on the Themes screen");
    ok(lay.indexOf('name:"' + n + '"') < 0, n + " is not also on Layout");
  });
  ["hand","header"].forEach((n) => {
    ok(lay.indexOf('name:"' + n + '"') >= 0, n + " is on the Layout screen");
    ok(thm.indexOf('name:"' + n + '"') < 0, n + " is not also on Themes");
  });
  ok(thm.indexOf('title:"Themes"') >= 0, "the Themes modal is titled Themes");
  ok(lay.indexOf('title:"Layout"') >= 0, "the Layout modal is titled Layout");
  // Labelling now lives with the group items rather than with flat menu rows;
  // "both groups list their screens" pairs each label to the screen it opens.
});

test("the menu groups open modals, not inline accordions", () => {
  // Inline expansion pushed everything below a group down and off the bottom
  // of a 72vh scroller. These must stay modals.
  eq(count(/function MenuGroupModal\(props\)\{/g), 1, "one group modal serves both groups");
  eq(count(/timeMenuOpen/g), 0, "the Time Settings accordion is gone");
  eq(count(/uiMenuOpen/g), 0, "and so is the Interface one");
  eq(count(/React\.createElement\(MenuGroupModal, \{ title:"Time Settings"/g), 1, "Time Settings mounts one");
  eq(count(/React\.createElement\(MenuGroupModal, \{ title:"Interface"/g), 1, "Interface mounts one");
  // One key, not a flag each: two flags can both be true at once.
  has(/var menuGroupS=useState\(null\)/, "which group is open is a single value");
  has(/setMenuGroup\("time"\)/, "the Time Settings row sets it");
  has(/setMenuGroup\("interface"\)/, "and the Interface row sets it");
  // Opening a group closes the dropdown it came from, or the menu is left
  // hanging behind a modal that covers it.
  ["time","interface"].forEach((k) => {
    const i = s.indexOf('"data-menugroup":"' + k + '"');
    ok(i >= 0, k + " row is tagged");
    const row = s.slice(i, s.indexOf("},", s.indexOf("onClick:", i)));
    ok(row.indexOf("setMenuOpen(false)") >= 0, "opening " + k + " closes the menu");
    ok(row.indexOf("setMenuGroup(") >= 0, "and opens its group");
  });
  const fn = (name) => {
    const i = s.indexOf("function " + name + "(");
    return i < 0 ? "" : s.slice(i, i + 700);
  };
  ok(/setMenuGroup\(null\)/.test(fn("closeHeaderMenus")), "closeHeaderMenus clears it");
  ok(/setMenuGroup\(null\)/.test(fn("closeAllPopups")), "and so does closeAllPopups");
});

test("every group modal carries a Close button", () => {
  const m = s.slice(s.indexOf("function MenuGroupModal(props){"),
                    s.indexOf("// ---- STAGES MODAL"));
  ok(m.indexOf("ownActions:true") >= 0, "it supplies its own action row");
  ok(m.indexOf('}, "Close")') >= 0, "which is a Close button");
  ok(m.indexOf("onClick:onClose") >= 0, "wired to close the modal");
  // ownActions suppresses Modal's built-in Cancel, so forgetting the button
  // would leave the modal with no visible way out but the scrim.
  ok(m.indexOf("items.map(function(it){") >= 0, "the items are rendered from the list");
  ok(m.indexOf("onClick:it.onSelect") >= 0, "each one selectable");
  // Exactly one, and below the items. lastIndexOf alone would find the bottom
  // one and pass with a stray Close sitting above the list as well.
  eq((m.match(/\}, "Close"\)/g) || []).length, 1, "exactly one Close button");
  ok(m.indexOf('}, "Close")') > m.indexOf("items.map(function(it){"),
    "and it sits below the items");
});

test("both groups list their screens, and nothing else reaches them", () => {
  const grp = (title) => {
    const i = s.indexOf('React.createElement(MenuGroupModal, { title:"' + title + '"');
    return i < 0 ? "" : s.slice(i, s.indexOf("] })", i));
  };
  const t = grp("Time Settings"), u = grp("Interface");
  ok(/label:"Work Schedule"/.test(t) && /label:"Tracking"/.test(t), "Time Settings offers both its screens");
  ok(/label:"Themes"/.test(u) && /label:"Layout"/.test(u), "Interface offers both of its");
  // The group modal is the only route in; a row left at the top level of the
  // menu would still work and would quietly undo the grouping.
  ["setShowSchedule(true)","setShowTracking(true)"].forEach((c) => {
    eq(count(new RegExp(c.replace(/[()]/g, "\\$&"), "g")), 1, c + " has one caller");
    ok(t.indexOf(c) >= 0, "and it is inside Time Settings");
  });
  ["setShowThemes(true)","setShowLayout(true)"].forEach((c) => {
    eq(count(new RegExp(c.replace(/[()]/g, "\\$&"), "g")), 1, c + " has one caller");
    ok(u.indexOf(c) >= 0, "and it is inside Interface");
  });
});

test("the settings menu is sized like the header buttons", () => {
  // 28px glyphs and 1rem labels, matching the Clock and Disruption buttons the
  // menu drops out of.
  has(/var MENU_FONT = "1rem";/, "one label size for the whole menu");
  has(/var MENU_ICON = 28;/, "and one glyph size");
  const i = s.indexOf('menuOpen && React.createElement("div", { dir:"ltr", "data-surface":"menu"');
  const menu = s.slice(i, s.indexOf("// CLOCK button", i));
  eq((menu.match(/fontSize:"0\.9[0-9]rem"/g) || []).length, 0,
    "no row is left at the old smaller size");
  ok((menu.match(/fontSize:MENU_FONT/g) || []).length >= 12, "every row uses the shared size");
  eq((menu.match(/size:14/g) || []).length, 0, "no 14px glyph is left behind");
  // Every glyph in the menu comes from the shared table or is TouchSVG. A
  // hand-written <svg> here is how the set drifted apart in the first place:
  // it carries its own size and weight and answers to nothing.
  eq((menu.match(/React\.createElement\("svg"/g) || []).length, 0,
    "no glyph is hand-written inside the menu");
  ok((menu.match(/React\.createElement\(MenuIcon,/g) || []).length >= 10,
    "the menu rows draw from the glyph table");
  ok(menu.indexOf("React.createElement(TouchSVG,") >= 0, "and Interface uses its own component");
  // MenuIcon defaults to MENU_ICON, so a row that names a size is opting out.
  eq((menu.match(/React\.createElement\(MenuIcon, \{ name:"[a-z]+", size:/g) || []).length, 0,
    "and none of them override the shared size");
});

test("every menu row carries a glyph, and they all come from one table", () => {
  eq(count(/var MENU_GLYPHS = \{/g), 1, "one table");
  eq(count(/function MenuIcon\(props\)\{/g), 1, "one component draws it");
  const tbl = s.slice(s.indexOf("var MENU_GLYPHS = {"), s.indexOf("function MenuIcon(props){"));
  // "add" left the list with the Add New row: the glyph stays in the table
  // (row menus may want it again) but nothing draws it, and this loop asserts
  // every listed glyph is actually used.
  ["lanes","clock","summary","reports","archive","backup","extensions",
   "arrange","test","break","more"].forEach((k) => {
    ok(new RegExp('(^|\\s)"?' + k + '"?:').test(tbl), k + " has a glyph");
    ok(s.indexOf('name:"' + k + '"') >= 0, "and something draws " + k);
  });
  // The 28-unit grid and the 2.5 house weight are the whole point of the table.
  eq((tbl.match(/viewBox/g) || []).length, 0, "the table is geometry only, no markup");
  // Read the table for real rather than pattern-matching numbers out of it.
  // The last number in an entry is a stroke width for some kinds and a corner
  // radius for others, and a regex cannot tell them apart - it read a fill's
  // rx as a 0.6 stroke and failed a correct glyph.
  const literal = tbl.slice(tbl.indexOf("{"), tbl.lastIndexOf("}") + 1);
  let GLY = null;
  try { GLY = Function("return " + literal)(); } catch (e) { GLY = null; }
  ok(!!GLY, "the table is a plain literal, readable on its own");
  const ARITY = { p: 3, c: 5, r: 7, f: 6 };
  const strokes = [];
  Object.keys(GLY || {}).forEach((k) => {
    GLY[k].forEach((el) => {
      ok(ARITY[el[0]] !== undefined, k + ": every part declares a known kind");
      eq(el.length, ARITY[el[0]], k + ": a " + el[0] + " part has the right number of values");
      if (el[0] === "p") strokes.push(el[2]);
      if (el[0] === "c") strokes.push(el[4]);
      if (el[0] === "r") strokes.push(el[6]);
    });
  });
  ok(strokes.length > 0, "weights are declared");
  ok(strokes.every((w) => w >= 1.4 && w <= 2.5),
    "nothing heavier than the shared 2.5, nothing so light it greys out");
  ok(strokes.filter((w) => w === 2.5).length > strokes.length / 3,
    "and the house weight dominates - lighter strokes are for parts that recede");
  // Only the gauge level is filled. Everything else in the set is an outline.
  const filled = Object.keys(GLY || {}).filter((k) => GLY[k].some((el) => el[0] === "f"));
  eq(filled.length, 1, "exactly one glyph uses a solid area");
  eq(filled[0], "stages", "and it is the gauge, whose level cannot be a stroke");
  const mi = s.slice(s.indexOf("function MenuIcon(props){"), s.indexOf("// A hand tapping"));
  ok(/viewBox:"0 0 28 28"/.test(mi), "everything renders on the shared grid");
  ok(/size=props.size\|\|MENU_ICON/.test(mi), "and at the shared size by default");
  ok(/fill:"none"/.test(mi), "stroked, never filled");
  ok(/strokeLinecap:"round"/.test(mi) && /strokeLinejoin:"round"/.test(mi), "round caps and joins");
});

test("no hook is ever called inside a loop", () => {
  // useTaps inside rows.map() took the app down the first time the row count
  // changed. This catches the class: any use* call whose nearest enclosing
  // construct is a .map( / .forEach( callback rather than a component.
  const hooks = ["useState", "useEffect", "useRef", "useTaps", "useMemo", "useCallback"];
  const re = /\.(map|forEach|filter)\(function\([^)]*\)\{/g;
  let m, offenders = [];
  while ((m = re.exec(s))) {
    // walk to the matching close of this callback body
    let depth = 1, i = re.lastIndex;
    while (i < s.length && depth > 0) { if (s[i] === "{") depth++; else if (s[i] === "}") depth--; i++; }
    const body = s.slice(re.lastIndex, i);
    hooks.forEach((h) => { if (new RegExp("\\b" + h + "\\(").test(body)) offenders.push(h + " inside ." + m[1] + "( near " + s.slice(m.index - 40, m.index).trim().split("\n").pop()); });
  }
  eq(offenders.length, 0, "no hook inside a loop callback" + (offenders.length ? ": " + offenders.join("; ") : ""));
});

test("milestones are reachable from every menu that should offer them", () => {
  // The entry comes from the shared builder, so the board and the outline
  // offer it in the same place: last on a lane and on a project, never on a
  // task - trackers live on projects only.
  const mi = s.slice(s.indexOf("function rowMenuItems(kind, role, a){"), s.indexOf("function MenuRows(props){"));
  ok(/add\("Milestones",  "milestone", a\.milestones\);/.test(mi.slice(mi.indexOf('if(kind==="lane")'), mi.indexOf('else if(kind==="stage")'))), "a lane offers Milestones");
  ok(/add\("Milestones",         "milestone", a\.milestones\);/.test(mi.slice(mi.indexOf('add("Edit project"'))), "and so does a project");
  ok(!/Milestones/.test(mi.slice(mi.indexOf('else if(role==="task")'), mi.indexOf('add("Edit project"'))), "but not a task");
  ok(/milestones: r\.kind==="lane" \? function\(\)\{ props\.onLaneMilestones\(r\.id\); \}/.test(s), "the outline routes a lane to the lane view");
  ok(/\(r\.role!=="task" \? function\(\)\{ props\.onMilestones\(r\.id\); \} : null\)/.test(s), "and a project to its editor, a task to nothing");
  ok(/milestones:props\.onLaneMilestones \? function\(\)\{ props\.onLaneMilestones\(lane\); \} : null/.test(s), "the board's lane header does the same");
  ok(/milestones:props\.onMilestones \? function\(\)\{ props\.onMilestones\(proj\.id\); \} : null/.test(s), "and its project card");
  // The three sheets exist, and the glyph is in the family.
  ["MilestoneLine", "MilestoneStepModal", "MilestoneEditModal", "LaneMilestonesModal", "offDaysOf"].forEach((fn) => {
    eq(count(new RegExp("^function " + fn + "\\b", "gm")), 1, fn + " is defined once");
  });
  has(/milestone: \[\["p","M3\.5 24\.5H24\.5",2\.5\], \["p","M8 24\.5V21 M20 24\.5V21",2\.2\],/, "the milestone glyph is in MENU_GLYPHS");
  // Steps are written to their project and nowhere else.
  has(/function saveMilestones\(pid, steps\)\{/, "one save");
  has(/return p\.id===pid \? Object\.assign\(\{\}, p, \{ milestones:steps \}\) : p;/, "which writes the project's milestones field");
  // The step sheet carries a notes field.
  has(/"data-msnote":true/, "a step has notes");
  // Off days come from the schedule, not an assumption.
  has(/offDays:offDaysOf\(settings\.workSchedule\)/, "off days are read from the work schedule");
});

test("Complete is held, and the closure sheet asks what, when, and about children", () => {
  // No stages: Complete sits where the gauge would, worked by the same hold
  // as Delete, so a brush cannot close a project.
  has(/!hasStages && isOpen\(proj\) && onCloseOut && React\.createElement\(HoldButton, \{\s*onHold:function\(\)\{ onCloseOut\(proj\); \}, holdMs:HOLD_DELETE_MS/,
    "Complete is a HoldButton where the gauge would sit");
  has(/"data-complete":proj\.id/, "on the project card");
  has(/"data-complete":sub\.id/, "and on the task card");
  // The sheet.
  const cs = s.slice(s.indexOf("function CloseProjectModal(props){"), s.indexOf("function StagesDoneModal(props){"));
  has(/var CLOSE_OUTCOMES = \[\["done","Done"\],\["abandoned","Abandoned"\],\["superseded","Superseded"\]\];/, "three outcomes");
  ok(/"data-closedate":true/.test(cs) && /"data-closetime":true/.test(cs), "when it was completed, editable");
  ok(/var future = at!==null && at>Date\.now\(\)\+60000;/.test(cs), "a future time is refused");
  ok(/"data-closenote":true/.test(cs), "closure notes");
  // Every open child is MOVED to a chosen parent or DELETED - one at a time
  // on its row, or all at once - and until each is decided, Complete is
  // blocked. Nothing is ever closed over silently.
  ok(/"data-closekids":true/.test(cs), "open children get their own section");
  ok(/"data-kidmove":b\.id/.test(cs) && /"data-kiddelete":b\.id/.test(cs), "a Move and a Delete per child");
  ok(/"data-kidsall":"move"/.test(cs) && /"data-kidsall":"delete"/.test(cs), "and an All line for the lot");
  ok(/var unresolved=blockers\.filter\(function\(b\)\{ return !res\[b\.id\]; \}\);/.test(cs), "undecided children are counted");
  ok(/var ok = at!==null && !future && unresolved\.length===0;/.test(cs), "and block Complete while any remain");
  ok(/var future = at!==null && at>Date\.now\(\)\+60000;/.test(cs) && /future && React\.createElement\("div"/.test(cs),
    "the in-the-future warning keys on the time alone, not on undecided children");
  ok(cs.indexOf("Close them too") < 0, "there is no closing-over option any more");
  ok(cs.indexOf("so close them first") < 0, "and no refusal either - the sheet carries the decision");
  ok(/onConfirm\(\{ at:at, outcome:outcome, note:note\.trim\(\), resolutions:res \}\)/.test(cs), "the sheet hands the resolutions to the close");
  eq(count(/^function MoveTargetModal\(props\)\{/gm), 1, "Move opens a picker of real destinations");
  const mt = s.slice(s.indexOf("function MoveTargetModal(props){"), s.indexOf("\nfunction ", s.indexOf("function MoveTargetModal(props){") + 10));
  ok(/var banned=getDescendantIds\(projects, exclude\)\.concat\(\[exclude\]\);/.test(mt), "which excludes the closing record and everything beneath it");
  ok(/label:"Top of "\+getMeta\(laneMeta,k\)\.label/.test(mt), "and offers the top of every lane");
});

test("no sheet draws its own action row - every one rides in the sticky box", () => {
  // Save / Cancel / Delete / a hold go through Modal's `actions`, which
  // renders ModalActions: sticky, mirrored for handedness, at the header's
  // end (top or bottom). A row drawn inline scrolls away on a long sheet.
  eq(count(/style:ACTION_ROW\(\)/g), 0, "no inline ACTION_ROW is left anywhere");
  has(/props\.actions && React\.createElement\(ModalActions, null, props\.actions\),/, "Modal routes `actions` through ModalActions");
  const ma = s.slice(s.indexOf("function ModalActions(props){"), s.indexOf("\nfunction ", s.indexOf("function ModalActions(props){") + 10));
  ok(/position:"sticky"/.test(ma), "which is sticky");
  ok(/flexDirection: ACTION_DIR\(\)/.test(ma), "mirrored for handedness");
  ok(/if\(UI\.bottom\)\{ st\.bottom=/.test(ma) && /else \{ st\.top=/.test(ma), "and follows the header to the top or the bottom");
  eq(count(/React\.createElement\(Modal, \{ actions:\[/g), 12, "twelve sheets hand their buttons to it");
  // The step sheet's mark rides in the box too, its own row above the three.
  ok(/React\.createElement\(Modal, \{ actions:\[\s*React\.createElement\("div", \{ key:"col", style:\{display:"flex",flexDirection:"column"/.test(s)
     && /markBtn,\s*React\.createElement\("div", \{ style:\{display:"flex",gap:"0\.6rem",flexDirection:ACTION_DIR\(\)\} \},/.test(s),
    "the step's mark sits above its Save / Cancel / Delete in the same box");
  eq(count(/"data-outlineactions"/g), 0, "the outline's private sticky wrapper is gone - it uses the shared box");
});

test("every Delete that opens something is held, not tapped", () => {
  // A couple of seconds of fill before the confirmation even opens: a stray
  // tap on the way to Save cannot start a delete. The milestone step's Delete
  // had no confirmation at all, so there the hold IS the guard.
  has(/var HOLD_DELETE_MS = 1500;/, "the delete hold is a couple of seconds");
  eq(count(/"data-holddelete":true/g), 5,
    "five destructive entry points hold: project form, lane editor, milestone step, tutorial reset, board reset");
  ["onHold:onDelete, holdMs:HOLD_DELETE_MS", "onHold:function(){ setConfirm(true); }, holdMs:HOLD_DELETE_MS",
   "onHold:function(){ onDelete(step.id); }, holdMs:HOLD_DELETE_MS"].forEach((frag) => {
    ok(s.indexOf(frag) >= 0, "held: " + frag.slice(7, 40));
  });
  // No Delete entry point is a plain tap any more.
  eq(count(/onClick:onDelete[,} ]/g), 0, "the project form's Delete is not a tap");
  eq(count(/onClick:function\(\)\{ setConfirm\(true\); \}/g), 0, "nor the lane editor's");
  eq(count(/onClick:function\(\)\{ onDelete\(step\.id\); \}/g), 0, "nor the step's");
});

test("holding the mark sets when it was met; tapping marks now", () => {
  // A mark made after the fact would record the tap, not the moment, and turn
  // an on-time step amber. Hold opens a sheet for the real time.
  eq(count(/^function useHold\(onTap, onHold, holdMs\)\{/gm), 1, "one hold hook");
  const uh = s.slice(s.indexOf("function useHold("), s.indexOf("function useTaps("));
  ok(/held\.current=true; setHolding\(false\); haptic\(18\); if\(holdRef\.current\) holdRef\.current\(\);/.test(uh), "the hold fires on its timer");
  // Every hold draws the same charging fill; the hook reports `holding` and
  // no control decides for itself whether to show one.
  ok(/holding:holding, holdMs:holdMs,/.test(uh), "the hook reports whether a hold is in progress");
  eq(count(/^function HoldFill\(props\)\{/gm), 1, "one fill");
  ok(/width:props\.holding\?"100%":"0%"/.test(s) && /transition:props\.holding\?\("width "\+props\.ms\+"ms linear"\):"none"/.test(s),
    "which grows for the length of the hold and snaps back when released");
  // Every user of useHold draws it.
  // One HoldButton wraps the hook and the fill; nothing else may call the
  // hook directly, so a hold cannot exist without its fill.
  eq(count(/^function HoldButton\(props\)\{/gm), 1, "one HoldButton");
  eq((s.match(/=useHold\(/g) || []).length, 1, "useHold is called only inside it");
  eq((s.match(/React\.createElement\(HoldFill, /g) || []).length, 1, "and it is the only thing that draws the fill");
  ok(/if\(wasTimed && !held\.current && tapRef\.current\) tapRef\.current\(\);/.test(uh), "a release before it is a tap, a release after it is not");
  ok(/Math\.abs\(e\.clientX-start\.current\.x\)>8/.test(uh), "movement cancels the hold, so a scroll is not read as one");
  const st = s.slice(s.indexOf("function MilestoneStepModal(props){"), s.indexOf("function MilestoneWhenModal(props){"));
  ok(/onTap:function\(\)\{ setDone\(done\?null:Date\.now\(\)\); \},/.test(st), "tap toggles a mark at now");
  ok(/onHold:function\(\)\{ setWhen\(\{ date:toDateInput\(done\|\|Date\.now\(\)\), time:toTimeInput\(done\|\|Date\.now\(\)\) \}\); \}/.test(st), "hold opens the when-sheet, seeded from the existing mark");
  ok(/hold to set when it was met/.test(st), "and the button says so");
  eq(count(/^function MilestoneWhenModal\(props\)\{/gm), 1, "the when-sheet exists");
  const wm = s.slice(s.indexOf("function MilestoneWhenModal(props){"), s.indexOf("function MilestoneEditModal(props){"));
  ok(/ok=ms!==null && ms<=Date\.now\(\)\+60000/.test(wm), "a future time is refused");
  ok(/onSave:function\(ms\)\{ setDone\(ms\); setWhen\(null\); \}/.test(st), "and a past one becomes the mark");
});

test("the mark is a full-width row, and inputs fit their sheets", () => {
  // Mark met now was a small button in the corner over Delete - the one
  // neighbour a mark should never have. It is its own action-sized row now.
  const st = s.slice(s.indexOf("function MilestoneStepModal(props){"), s.indexOf("function MilestoneEditModal(props){"));
  ok(/"data-msmarkmet":true[\s\S]{0,400}width:"100%"/.test(st), "the mark spans the sheet");
  ok(/"data-msmarkmet":true[\s\S]{0,500}padding:"0\.85rem"/.test(st), "at action-button height");
  ok(/"data-msmarkmet":true[\s\S]{0,600}fontSize:MODAL_BTN_FONT/.test(st), "and action-button size");
  ok(st.indexOf("var markBtn=") < st.indexOf('React.createElement(Modal, { actions:['), "defined for the sticky box, not the content");
  ok(st.indexOf("alignSelf") < 0, "no longer tucked into a corner");
  // width:100% + padding + border overflowed every sheet by ~30px.
  has(/var INPUT_STYLE = \{ direction:"ltr",textAlign:"left",width:"100%",boxSizing:"border-box",/, "inputs are border-box");
});

test("milestone strips draw from the FULL record set, and one component", () => {
  // The board hands cards only OPEN records. A milestone's targets are the
  // records that have been CLOSED - filter them out and a met step could never
  // register as met. So every strip reads msProjects, the unfiltered set.
  eq(count(/^function MilestoneStrip\(props\)\{/gm), 1, "one strip component");
  // three fixed kinds on the board, and the outline picks lane or project per row
  eq(count(/React\.createElement\(MilestoneStrip, \{ weekStart:weekStartOf\([^)]*\), kind:"(project|lane|board)"/g), 3,
    "used on the card, the lane header and the board, each told where the week starts");
  has(/MilestoneStrip, \{ weekStart:weekStartOf\([^)]*\), kind:r\.kind==="lane"\?"lane":"project"/,
    "and once in the outline, per row kind");
  has(/msProjects:projects, offDays:offDaysOf\(settings\.workSchedule\),/, "the board passes the full set down");
  has(/var all=props\.msProjects\|\|allProjects\|\|\[\];\s*if\(!props\.onMilestones \|\| !hasMilestonesBeneath\(all, proj\.id\)\) return null;/,
    "the card reads it");
  has(/laneLine\(props\.msProjects\|\|allProjects\|\|\[\], lane, Date\.now\(\)\)/, "so does the lane header");
  has(/var pts=boardLine\(projects, laneOrder, laneMeta, Date\.now\(\)\);/, "and the board strip reads projects, not liveProjects");
  has(/projects:liveProjects, msProjects:projects, offDays:offDaysOf\(settings\.workSchedule\),\s*onOpen:openFromOutline/,
    "the outline gets both: open records to list, the full set for lines");
  has(/var all=props\.msProjects\|\|projects;\s*var pts = r\.kind==="lane" \? laneLine\(all,/, "and uses the full set for its strips");
  // A strip with nothing to show is not drawn.
  const ms = s.slice(s.indexOf("function MilestoneStrip(props){"), s.indexOf("\n\n// ---- THE OUTLINE"));
  ok(/if\(!points\.length\) return null;/.test(ms), "an empty line draws nothing");
  // ...and that return sits AFTER the hooks. A conditional return before them
  // is the same class of bug as a hook in a loop: the hook count changes
  // between renders and React throws #310, taking the app down.
  ok(ms.indexOf("useState(0)") < ms.indexOf("if(!points.length) return null;"),
    "and the early return is after every hook, never before one");
  // Each strip opens the right sheet.
  has(/onOpen:function\(\)\{ closeAllPopups\(\); setMsBoard\(true\); \}/, "the board strip opens the board view");
  eq(count(/^function BoardMilestonesModal\(props\)\{/gm), 1, "which exists");
  has(/onOpenLane:function\(k\)\{ setMsLane\(k\); \}/, "and hands off to a lane's view");
});

test("the line zooms and pans, without borrowing the hold-to-confirm signal", () => {
  // A parent line shows every step beneath it, which over months crowds. Zoom
  // steps through real units; the charging fill is NOT used to set the level -
  // in this app a charge means something irreversible is about to happen.
  has(/var MS_ZOOMS = \[/, "the levels are a table");
  has(/\{ id:"fit",    label:"Fit",    ms:null \}/, "starting at Fit");
  has(/function nextZoom\(i\)\{ return \(i\+1\) % MS_ZOOMS\.length; \}/, "and tapping wraps");
  const ms = s.slice(s.indexOf("function MilestoneStrip(props){"), s.indexOf("\n\n// ---- THE OUTLINE"));
  ok(/onTap:step, onHold:toFit/.test(ms), "tap steps the level, hold snaps back to Fit");
  ok(/"data-mszoom":zoomAt\(zoom\)\.id/.test(ms), "the control names its level");
  // Written control-then-line; the app root's dir="rtl" mirrors it for a
  // left-hander. Setting flexDirection here as well cancelled that out and
  // put the control left of the line for BOTH hands - the same double-mirror
  // that once put Save on the wrong side.
  ok(ms.indexOf("flexDirection:UI.left") < 0, "the strip does not mirror itself - the root already does");
  // Written line-then-control: under LTR that puts the control at the right,
  // and the root's dir="rtl" moves it to the left for a left-hander - the
  // thumb edge either way.
  ok(ms.indexOf('"data-mspan"') < ms.indexOf('"data-mszoom"'), "the control is written last, so it lands at the thumb edge");
  // Equal weight at every level: at Fit it was a dim outline on a dim panel.
  ok(/background:S\.infoBg,border:"1px solid "\+S\.actionBdr,/.test(ms), "the control looks the same at every level");
  // The control's PLACEMENT mirrors; its TEXT must not - the rtl root
  // reversed the words and "3 months" read as "months 3".
  ok(ms.indexOf('React.createElement("span", { dir:"ltr" }, zoomAt(zoom).label)') >= 0,
    "and its label reads the same way round in both hands");
  ok(!/background:zoomed\?/.test(ms) && !/color:zoomed\?/.test(ms), "Fit is not a faded state");
  // Panning: only when zoomed, and a drag that never moved is a tap.
  ok(/var panHandlers = zoomed \? \{/.test(ms), "the line pans only when zoomed in");
  ok(/touchAction:zoomed\?"pan-y":"auto"/.test(ms), "leaving vertical scrolling to the page");
  ok(/if\(d && !d\.moved && props\.onOpen\) props\.onOpen\(\);/.test(ms), "and a drag that never moved still opens the sheet");
  // The line draws only what is inside the window.
  has(/var visible=points\.filter\(function\(p\)\{ return p\.at>=span\.lo && p\.at<=span\.hi; \}\)/,
    "marks outside the window are not drawn");
  has(/var span=props\.span \|\| lineSpan\(points, now\)/, "and the line takes the window it is given");
  // Two signals that the line runs past the window, and only when it does.
  // The fade alone reads as decoration; the bar alone does not show that the
  // line continues. Together: that it scrolls, where you are, how much you see.
  has(/if\(full && \(full\.hi-full\.lo\) > \(span\.hi-span\.lo\)\+1\)\{/, "shown only when there is more line than window");
  has(/React\.createElement\("linearGradient", \{ id:fid\+"l" \}/, "the leading edge fades");
  has(/React\.createElement\("linearGradient", \{ id:fid\+"r" \}/, "and the trailing edge");
  has(/var thumbW=Math\.max\(16, w\*\(\(span\.hi-span\.lo\)\/fw\)\);/, "the bar's width is the share of the line in view");
  has(/var thumbX=left\+\(w-thumbW\)\*Math\.max\(0, Math\.min\(1, \(span\.lo-full\.lo\)\/Math\.max\(1, fw-\(span\.hi-span\.lo\)\)\)\);/,
    "and its position is where the window sits in the whole");
  has(/fullSpan: zoomed \? lineSpan\(points, now\) : null,/, "the strip passes the full extent only when zoomed");
  has(/var H = \(labels \? 58 : 34\) \+ \(bar\?6:0\)/, "and the line makes room for the bar when it draws one");
  // A parent shows the full extent of what is beneath it.
  has(/function subtreePoints\(projects, id, now\)\{/, "every step beneath a record is a point");
  has(/out=out\.concat\(subtreePoints\(projects, p\.id, now\)\);/, "a lane line gathers them all");
  // A PROJECT line follows the same rule - it used to collapse each child to
  // one aggregate mark, which hid the children's own steps.
  eq(count(/subtreePoints\(all, (proj|r)\.id, Date\.now\(\)\)/g), 2, "the card and the outline both expand fully");
  has(/var points=subtreePoints\(scored, proj\.id, now\);/, "and so does the editor's line");
  has(/\(laneOrder\|\|\[\]\)\.forEach\(function\(k\)\{ out=out\.concat\(laneLine\(projects, k, now\)\); \}\);/, "and the board line gathers the lanes");
});

test("the line's ticks slide with the zoom and follow the user's own week", () => {
  // Two sizes at every level, and what each unit MEANS changes with the
  // window, so the line is never a solid comb or a bare rule.
  has(/function tickScale\(span\)\{/, "one place decides what a tick means");
  has(/if\(w > 31\*MS_DAY\)  return \{ minor:"week", major:"month" \};/, "months and longer: weeks under months");
  has(/if\(w > 2\*MS_DAY\)   return \{ minor:"day",  major:"week"  \};/, "a week to a month: days under week starts");
  has(/return \{ minor:"hour", major:"day" \};/, "and down at a day or two: hours under days");
  has(/function lineTicks\(span, weekStart\)\{/, "the ticks themselves are computed, not drawn inline");
  has(/"data-tick":k\.major\?"major":"minor"/, "each says which it is");
  has(/y2:axisY-\(k\.major\?8:3\),/, "the major tick is taller");
  has(/strokeWidth:k\.major\?2:1/, "and thicker, so it reads as a boundary");
  // The week boundary is the user's own, from Pay & Work Week.
  has(/function weekStartOf\(schedule\)\{/, "one place reads the configured first day");
  has(/return \(pr&&pr\.weekStart\) \|\| "mon";/, "defaulting to Monday when none is set");
  has(/else if\(sc\.major==="week"\) major = startOfWeek\(d, weekStart\)/, "and week majors land on it");
  has(/guard<2000/, "with a guard so a bad span cannot flood the line");
});

test("a met step is drawn where it HAPPENED, with a ghost at the target", () => {
  // The brightest mark is the truth: where the work actually landed. A ghost
  // at the target and an arc between say what was planned and how far it
  // moved. Missed steps have nothing to connect to and get neither.
  has(/var DRIFT_MIN_PX = 7;/, "a drift too small to bow stays one mark");
  has(/var DRIFT_MAX_H  = 34;/, "and the arc has a ceiling");
  has(/return Math\.min\(DRIFT_MAX_H, 9 \+ Math\.sqrt\(Math\.abs\(spanPx\)\)\*3\.4\);/,
    "height is sqrt-compressed, so small drifts still bow and big ones stop running away");
  has(/if\(p\.actual==null \|\| \(p\.status!=="met" && p\.status!=="late"\)\) return false;/, "only met and late steps drift");
  // An arc is kept when any PART of it crosses the window: dropping it when
  // the TARGET was off-screen made arcs wink out as you panned towards them.
  has(/return b>=span\.lo && a<=span\.hi;/, "an arc that crosses the window is kept, wherever its ends are");
  // Height is measured over EVERY drift at this zoom, so panning cannot
  // change it - the line held one height instead of jumping as arcs scrolled
  // in and out.
  has(/driftArcs\(points, \{ lo:drawSpan\.lo, hi:drawSpan\.hi \}, w, true\)/,
    "and the height is measured over the whole line, not just what is on screen");
  has(/out\.sort\(function\(a,b\)\{ return Math\.abs\(b\.ax-b\.x\)-Math\.abs\(a\.ax-a\.x\); \}\);/,
    "widest first, so a short arc is never buried");
  // The line grows by exactly the headroom the tallest arc needs.
  has(/var head = props\.drift===false \? 0 : Math\.round\(driftHeadroom\(/, "the tallest arc sets the headroom");
  has(/var H = \(labels \? 58 : 34\) \+ \(bar\?6:0\) \+ head, axisY = \(labels \? 34 : 26\) \+ head;/,
    "and the line grows by it - by nothing at all when there is no drift");
  has(/"data-driftarc":a\.id/, "each arc is identifiable");
  has(/"data-driftghost":a\.id/, "so is each ghost");
  has(/var real = \(p\.actual!=null && \(p\.status==="met"\|\|p\.status==="late"\)\) \? p\.actual : p\.at;/,
    "and the bright mark sits on the date that happened");
});

test("the opening screen names the app and gets out of the way", () => {
  // An app you open to start a timer: a splash you have to sit through is a
  // splash in the way. About a second, then it fades, and a tap kills it.
  eq(count(/^function SplashScreen\(props\)\{/gm), 1, "one splash component");
  has(/var APP_VERSION = "/, "a public version number, separate from the build stamp");
  has(/var SPLASH_SHOW_MS = 2500;/, "held long enough to read, at Brent's pacing");
  has(/var SPLASH_FADE_MS = 320;/, "then faded out");
  has(/onPointerDown:props\.onDismiss/, "and a tap dismisses it at once");
  has(/"data-splash":props\.fading\?"fading":"shown"/, "it says which state it is in");
  has(/zIndex:1000/, "above every other layer, including modals");
  has(/pointerEvents:props\.fading\?"none":"auto"/, "and stops intercepting taps the moment it starts fading");
  // The timers are cleaned up, or a remount leaves them firing into a dead tree.
  has(/return function\(\)\{ clearTimeout\(a\); clearTimeout\(b\); \};/, "its timers are cleared on unmount");
  // The build stamp is untouched: that is what proves which deploy landed.
  ok(/Time Tracker build/.test(require("fs").readFileSync("index.html","utf8")),
    "the build stamp still lives in the shell");
});

test("every milestone token reaches S", () => {
  // applyTokens copies tokens by name. A token in the scheme tables that is
  // not copied here is undefined at runtime, and the line draws black.
  const ap = s.slice(s.indexOf("function applyTokens("), s.indexOf("\nfunction ", s.indexOf("function applyTokens(") + 10));
  ["msMet", "msLate", "msMissed", "msUpcoming", "msOffDay"].forEach((k) => {
    ok(new RegExp("S\\." + k + "=c\\." + k + ";").test(ap), k + " is copied into S");
    eq(count(new RegExp(k + ':"', "g")), 8, k + " is defined in all eight token sets");
  });
});

test("milestones live on projects, and only there", () => {
  // Steps are entered in exactly one place. Lanes and the board own nothing;
  // their lines are computed from the level beneath, so nothing can drift.
  const ms = s.slice(s.indexOf("// ---- MILESTONES ---"), s.indexOf("// ---- THE OUTLINE ---"));
  has(/var MS_RANK = \{ missed:3, late:2, upcoming:1, met:0 \};/, "worst wins in the agreed order");
  ok(/function laneLine\(projects, lane, now\)\{/.test(ms) && /function boardLine\(projects, laneOrder, laneMeta, now\)\{/.test(ms),
    "lane and board lines are functions of projects");
  ok(ms.indexOf("laneMeta[") < 0 || !/milestones/.test(ms.slice(ms.indexOf("function laneLine"))),
    "and read no milestones from a lane");
  ok(/function recordClosedAt\(projects, id\)\{/.test(ms) && /p\.closedAt/.test(ms),
    "complete means closed out, nothing else");
  ok(/tickUnit\(span\)\{ return \(span\.hi-span\.lo\) > 31\*MS_DAY \? "week" : "day"; \}/.test(ms),
    "ticks are days under a month, weeks past it");
});

test("every function the outline calls is actually defined", () => {
  // This suite reads source, so it happily passed a build in which the whole
  // outline model had been deleted: the CALL SITES still matched. Only the
  // evaluated harness caught it. Assert the definitions exist, not just uses.
  ["outlineRows", "outlineSpan", "outlineCommit", "mergeOutline", "blockEnd", "parentIndex",
   "prevSibling", "nextSibling", "replant", "firstChildAt", "stepUp", "stepDown", "stepIn",
   "stepOut", "stepOptions", "nestRoles", "RowGrip", "OutlineName", "LaneEditModal", "OutlineModal",
   "worstStatus", "stepActual", "stepStatus", "stepPoint", "aggregatePoint", "hasMilestonesBeneath",
   "projectLine", "projectCurrent", "laneLine", "laneCurrent", "boardLine", "lineSpan", "tickUnit", "groupMarks",
   "MilestoneStrip", "BoardMilestonesModal", "MilestoneWhenModal", "useHold", "HoldButton", "HoldFill", "StagesDoneModal", "MoveTargetModal",
   "MenuIcon", "ModalGlyph", "TitleGlyph", "readableInk"].forEach((fn) => {
    eq(count(new RegExp("^function " + fn + "\\b", "gm")), 1, fn + " is defined exactly once");
  });
  // And nothing calls a name that no longer exists. Cheap structural check:
  // every identifier called as fn(...) at top level of the outline model.
  const model = s.slice(s.indexOf("// ---- THE OUTLINE"), s.indexOf("function LaneEditModal") >= 0
    ? s.indexOf("// ---- CAROUSEL") : s.length);
  ["moveOutline", "dropAtY", "nestInto", "dragShift", "dropIndex"].forEach((gone) => {
    eq((model.match(new RegExp(gone + "\\(", "g")) || []).length, 0,
      "nothing calls the removed " + gone);
  });
});

test("rows are selected and stepped, and nothing drags any more", () => {
  // Dragging on iOS lost a week to Safari claiming the gesture for scrolling
  // before the first touchmove, with touch-action ignored on the handle. None
  // of that apparatus may come back.
  ["bindTouch", "freezePage", "lockDocument", "DRAG_TRACE", "dropAtY", "nestInto", "moveOutline",
   "HOLD_MS", "dragShift", "dropIndex", "DRAG_HANDLE_STYLE", "lockScroll", "beginHold", "touchOff",
   "tt-drag", "data-lanedrag", "data-outlinedrag"].forEach((w) => {
    eq(count(new RegExp(w.replace(/[-]/g, "\\$&"), "g")), 0, w + " is gone");
  });
  // Touch handlers survive in the Carousel, whose swipe predates all of this
  // and is not row dragging. Assert they are absent from the two edit sheets
  // rather than from the whole file.
  const lanesSrc = s.slice(s.indexOf("function EditLanesModal(props){"), s.indexOf("// ---- CAROUSEL"));
  const outSrc = s.slice(s.indexOf("function OutlineModal(props){"), s.indexOf("// ---- EDIT DISRUPTION PRESETS MODAL"));
  [["the lanes sheet", lanesSrc], ["the outline", outSrc]].forEach(([what, src]) => {
    ["onTouchStart", "onTouchMove", "onTouchEnd", "onMouseDown"].forEach((h) => {
      eq((src.match(new RegExp(h, "g")) || []).length, 0, what + " has no " + h);
    });
  });
  const om = s.slice(s.indexOf("function OutlineModal(props){"), s.indexOf("// ---- EDIT DISRUPTION PRESETS MODAL"));
  // A row's glyph selects it; its name opens the editor. Two targets, two jobs.
  ok(/"data-outlinepick":r\.key/.test(om), "the glyph selects the row");
  // Single tap opens the row's menu, double tap edits - the same pair the
  // board uses for lanes, projects and tasks, so the gesture means one thing
  // wherever you are.
  ok(/React\.createElement\(OutlineName, \{ row:r,/.test(om), "the name is its own component");
  // useTaps is a hook. Inside rows.map() it was a hook in a loop, which held
  // together until the row count changed - adding a record - and then React
  // threw #310 and the whole app died. It lives at OutlineName's top level now.
  ok(om.indexOf("useTaps(") < 0, "and no hook is called inside the row loop");
  const on = s.slice(s.indexOf("function OutlineName(props){"), s.indexOf("function OutlineModal(props){"));
  ok(/var onTap=useTaps\(props\.onSingle, props\.onDouble\);/.test(on), "the tap hook sits at a component's top level");
  ok(/"data-outlineopen":r\.key, onClick:onTap/.test(on), "and drives the name");
  ok(/setRowMenu\(function\(x\)\{ return x===r\.key \? null : r\.key; \}\)/.test(om),
    "one tap toggles that row's menu");
  ok(/setRowMenu\(null\); onOpen\(r\);/.test(om), "two taps close it and open the editor");
  ok(/function outlineMenuItems\(r\)\{/.test(om), "the menu's entries come from one place");
  // A popup hanging off the row, like the board's - not an inline list that
  // shoves the rows below it down the page.
  ok(/position:"absolute",top:"calc\(100% \+ 4px\)"/.test(om), "it hangs under its own row");
  ok(/left:UI\.left\?"auto":/.test(om) && /right:UI\.left\?/.test(om), "and flips with handedness");
  ok(/zIndex:rowMenu===r\.key\?60:undefined/.test(om),
    "the row it belongs to stacks above the rows after it, or later siblings paint over the popup");
  ok(om.indexOf('"data-surface":"menu"') < 0,
    "it is not glass - that rule reads as muddy over the rows of its own sheet");
  ok(/background:S\.bg2,border:"1px solid "\+S\.borderBright/.test(om), "solid fill, brighter edge");
  // Each kind's menu, in a fixed order: edit first, then what can be added
  // from here, same level inward. Assert the exact sequence per kind.
  // ONE builder serves the outline AND the board, so the two cannot drift.
  const mi = s.slice(s.indexOf("function rowMenuItems(kind, role, a){"), s.indexOf("function MenuRows(props){"));
  const labelsIn = (block) => (block.match(/add\("([^"]+)"/g) || []).map((x) => x.slice(5, -1));
  const seg = (from, to) => mi.slice(mi.indexOf(from), to ? mi.indexOf(to) : undefined);
  eq(labelsIn(seg('if(kind==="lane")', 'else if(kind==="stage")')).join("|"),
    "Edit lane|New lane|New project|Milestones", "a lane's menu");
  eq(labelsIn(seg('else if(kind==="stage")', 'else if(role==="task")')).join("|"),
    "Edit stage|Add stage", "a stage's menu");
  eq(labelsIn(seg('else if(role==="task")', 'add("Edit project"')).join("|"),
    "Edit task|Add task|Add nested task|Add stages", "a task's menu");
  eq(labelsIn(seg('add("Edit project"')).join("|"),
    "Edit project|Add project|Add nested project|Add task|Add stages|Milestones", "a project's menu");
  // and every menu on the board is built from it too
  const board = s.slice(s.indexOf("function SubRow(props){"), s.indexOf("// ---- MODULE PLATFORM"));
  eq((board.match(/rowMenuItems\("node", projRole\((proj|sub)\)/g) || []).length, 2,
    "both card menus come from the shared builder");
  ok(/rowMenuItems\("lane", null, \{/.test(board), "and so does the lane header's");
  eq((board.match(/React\.createElement\(MenuRows, /g) || []).length, 3, "drawn by the shared renderer");
  ["Edit Project", "Add Task", "View Stages", "Add Stages", "+ New Lane", "Nest Something Here"].forEach((l) => {
    eq((board.match(new RegExp('"' + l.replace(/[+]/g, "\\$&") + '"', "g")) || []).length, 0,
      'no hand-rolled "' + l + '" row survives on the board');
  });
  // "Add project" / "Add task" on a record is a SIBLING: same lane, same
  // parent, same kind. "Add nested" goes inside.
  has(/onAddSibling:function\(pid\)\{ var pr=findProj\(projects,pid\);\s*if\(pr\) setShowAdd\(\{lane:pr\.lane,parentId:pr\.parentId\|\|null,role:projRole\(pr\)\}\); \}/,
    "a sibling shares the record's lane, parent and role");
  const om2 = s.slice(s.indexOf("function outlineMenuItems(r){"), s.indexOf("function apply(res){"));
  ok(/addNestedProject:function\(\)\{ props\.onAddProjectUnder\(r\.id\)/.test(om2),
    "a nested project goes under the record");
  ok(/addNestedTask:function\(\)\{ props\.onAddTask\(r\.id\)/.test(om2), "and so does a nested task");
  ok(/add\("Edit stage",  "stages",  a\.edit\)/.test(mi) && /add\("Add stage",   "stages",  a\.edit\)/.test(mi),
    "both stage entries open the host's stage list");
  // The board's Add Task / Add nested / sibling reach the same sheet with the
  // same role the outline asks for.
  has(/onAddSub:function\(parentId\)\{ closeAllPopups\(\); setShowAdd\(\{lane:lane,parentId:parentId,role:"task"\}\); \}/,
    "the board's task add says it is a task");
  has(/onAddNested:function\(pid\)\{[\s\S]{0,120}role:"project"\}\); \}/, "and its nested add says project");
  ok(/setSel\(picked\?null:r\.key\)/.test(om), "and tapping the glyph again deselects");
  // A second target on the trailing edge, shaped like the controller it opens.
  eq(count(/function RowGrip\(props\)\{/g), 1, "one grip component");
  const rg = s.slice(s.indexOf("function RowGrip(props){"), s.indexOf("function OutlineModal(props){"));
  ok(/var GRIP_BOX = 40, GRIP_REST = 32, GRIP_SEL = 38;/.test(s),
    "it grows on selection, inside a fixed box so the row cannot reflow");
  ok(/width:GRIP_BOX\+"px",height:GRIP_BOX\+"px"/.test(rg), "the box is the fixed size");
  ok(/props\.on\?GRIP_SEL:GRIP_REST/.test(rg), "and the drawing is what changes");
  ok(/props\.on\?S\.text:S\.textDim/.test(rg),
    "resting takes textDim, selected the full text colour - both invert with the theme");
  // The glyph must fit the 28-unit box INCLUDING its stroke. It shipped once
  // reaching -1.85 to 29.85, with all four outer walls clipped off, which
  // turned the cross into what read as a lattice. Check the arithmetic, not a
  // literal: reach = offset + half the key + half the stroke.
  const gm = /var GRIP_OFF = ([\d.]+), GRIP_KEY = ([\d.]+), GRIP_SW = ([\d.]+);/.exec(rg);
  ok(!!gm, "the grip's geometry is named, not scattered through the markup");
  if (gm) {
    const off = Number(gm[1]), key = Number(gm[2]), sw = Number(gm[3]);
    const reach = off + key / 2 + sw / 2;
    ok(reach <= 14, "every key fits the box with its stroke (reach " + reach.toFixed(2) + " <= 14)");
    ok(reach > 12, "and fills it rather than floating in the middle");
    const gap = 2 * off - key;
    ok(gap >= 5, "the keys stay visibly separate (gap " + gap.toFixed(1) + ")");
  }
  eq((rg.match(/rx:GRIP_KEY\*0\.29/g) || []).length, 1, "four keys drawn from one spec, as the pad is");
  ok(rg.indexOf("UI.left") < 0, "no handedness conditional - dir mirrors it");
  // The grip and the row glyph do the same thing, from one function.
  ok(/var pick=function\(\)\{ setSel\(picked\?null:r\.key\); haptic\(10\); \};/.test(om),
    "one pick handler");
  ok(/"data-outlinepick":r\.key, onClick:pick/.test(om), "the row glyph calls it");
  ok(/RowGrip, \{ rowKey:r\.key, on:picked, onPick:pick \}/.test(om), "and so does the grip");
  ok(om.indexOf('"data-outlinekey":r.key') < om.indexOf("RowGrip, {"),
    "the grip is written after the row box, so it sits outside it");
  // The controller appears only with a row selected, and asks the model what
  // that row can do rather than deciding for itself.
  ok(/cur && !props\.suspended && React\.createElement\("div", \{ "data-controller":true/.test(om),
    "the controller needs a selection, and stands down while a child editor is open");
  ok(/var can=cur \? stepOptions\(rows, idx, role\) : null;/.test(om), "it asks the model what is possible");
  ["up", "down", "left", "right"].forEach((d) => ok(om.indexOf('padKey("' + d + '"') >= 0, "the pad has a " + d + " key"));
  ok(/disabled:!on/.test(om), "an impossible direction is disabled, not silently ignored");
  // A dead key keeps its outline. At 0.28 with no border the pad stopped
  // reading as a pad once most directions were unavailable.
  ok(/border:"2px solid "\+\(on\?S\.textDim:S\.textMuted\)/.test(om),
    "a disabled key still has a border, just a dimmer one");
  ok(/background:on\?S\.bg3:"transparent"/.test(om), "the fill is what marks a key live");
  ok(/opacity:on\?1:0\.6/.test(om), "and it stays legible at 0.6, not 0.28");
  // The all-lanes list is gone: both routes to it - the board's lane header
  // and the settings menu - now open the single-lane editor instead, so the
  // same gesture no longer gave two different editors.
  eq(count(/EditLanesModal/g), 0, "the all-lanes list is gone, not left orphaned");
  eq(count(/saveLaneEdits/g), 0, "and the multi-lane save with it");
  ok(/flexDirection:UI\.left\?"row-reverse":"row"/.test(om), "the pad mirrors with handedness, under the thumb");
  // The nesting role is chosen, and only offered where it exists.
  ok(/stepIn\(rows, idx, role\)/.test(om), "nesting in uses the chosen role");
  ok(/roles\.length>0 && React\.createElement\("div", \{ style:\{display:"flex",gap:"0\.4rem"\}/.test(om),
    "the role pills only appear when there is a choice to make");
  ok(/rolePill\("task","Task"\), rolePill\("project","Project"\)/.test(om), "task or project");
  ok(/if\(roles\.length && roles\.indexOf\(role\)<0\) setRole\(roles\[0\]\);/.test(om),
    "and a role the host cannot hold is corrected, not left selected");
  ok(/A task can only hold tasks\./.test(om), "the reason a choice is missing is stated");
  // Moves that leave the parent or convert the record still ask first.
  ok(/if\(res\.crossed\)\{\s*setAsk\(/.test(om), "a crossing asks");
  ok(/ask && React\.createElement\(Modal, \{ actions:\[[\s\S]{0,900}title:"Move it\?"/.test(om), "as its own sibling modal");
  ok(/scrollIntoView\(\{ block:"nearest", behavior:"smooth" \}\)/.test(om),
    "and the selected row stays in view above the controller");
  // Save and Cancel are pinned to the foot of the sheet, so an edit at the top
  // of a long list can be saved without scrolling to the bottom first.
  ok(/React\.createElement\(Modal, \{ actions:\[React\.createElement\("button", \{ key:"a0", ("data-anchor":"outline-save", )?onClick:function\(\)\{ onSave\(rows\); \}/.test(om),
    "the action row rides in the shared sticky box");
  ok(om.indexOf('"data-outlineactions"') < 0, "and no private sticky wrapper of its own");
  // The controller floats OVER the foot of the sheet, Save/Cancel included.
  // Moving and saving are separate moments: DONE puts the controller away.
  ok(om.indexOf("shrinkBy") < 0 && om.indexOf("padBottom") < 0,
    "the sheet neither shrinks nor pads for the controller");
  ok(/marginBottom:cur\?"11rem":"0\.5rem"/.test(om),
    "but the list keeps room under it, so a selected row near the foot can scroll clear");
  // DONE is a bordered button, not a word - the same treatment as EXIT.
  ok(/"data-ctrldone":true[\s\S]{0,200}border:"1\.5px solid "\+S\.infoText/.test(om), "DONE is a bordered button");
  ok(/\} \}, "DONE"\)\)/.test(om), "and says so");
  // The lanes sheet steps too.
  // Lane order is the outline's job now - it lists every lane with the same
  // controller as everything else.
});

test("the header runs opposite to the board behind it", () => {
  // The page mirrors on handedness via dir; the header bar is reversed on top
  // of that, so the menu button is on the right for a right-handed user and on
  // the left for a left-handed one. row-reverse does it under both dir values,
  // because in RTL a reversed row already reads left to right.
  eq(count(/var hdrMenuRight = !isLeft;/g), 1, "one flag names which side the menu is on");
  const i = s.indexOf("// Written Menu | Clock | Disruption");
  const bar = s.slice(i, s.indexOf("SETTINGS MENU button", i));
  ok(bar.indexOf('flexDirection:"row-reverse"') >= 0, "the bar is reversed");
  ok(bar.indexOf("isLeft") < 0, "unconditionally - it must invert on both hands, not one");
  // Each dropdown hangs off its own button. If an anchor keeps following
  // isLeft it opens off the edge of the screen on both settings.
  ok(s.indexOf('left:hdrMenuRight?"auto":0,right:hdrMenuRight?0:"auto",minWidth:"290px"') >= 0,
    "the menu dropdown follows the menu button");
  // The reasons list is its own component now; the header still decides where
  // it hangs, through `place`.
  ok(s.indexOf('place:{position:"absolute",top:ddTop,bottom:ddBottom,right:hdrMenuRight?"auto":0,left:hdrMenuRight?0:"auto"') >= 0,
    "and the disruption dropdown follows its own, on the opposite side");
  const dd = s.match(/position:"absolute",top:ddTop,bottom:ddBottom,[^}]*/g) || [];
  eq(dd.filter((d) => /isLeft/.test(d)).length, 0,
    "no header dropdown is still anchored off the page mirror");
});

test("leaving the tutorial keeps your work; resetting is its own, held act", () => {
  // It used to reset on the way out, which is wrong for somewhere you come
  // back to and carry on building. Leaving keeps everything; Reset is a
  // separate control, held, and it says what it throws away.
  eq(count(/function leaveTutorial\(\)\{/g), 1, "one way out");
  const lv = s.slice(s.indexOf("function leaveTutorial(){"), s.indexOf("function resetTutorialNow("));
  ok(lv.indexOf("resetTutorial()") < 0, "leaving does not reset");
  ok(/setTestMode\(false\);/.test(lv), "it just leaves");
  eq(count(/function resetTutorial\(\)\{/g), 1, "one reset");
  const rs = s.slice(s.indexOf("function resetTutorial(){"), s.indexOf("function leaveTutorial(){"));
  [["setTestProjects","TEST_PROJECTS"],["setTestLogs","TEST_LOGS"],["setTestDist","TEST_DIST"],
   ["setTestBreaks","TEST_BREAKS"],["setTestLaneOrder","TEST_ORDER"],["setTestLaneMeta","TEST_META"]]
    .forEach(([fn, seed]) => {
      ok(rs.indexOf(fn + "(" + seed + ")") >= 0, fn + " goes back to its shipped seed");
    });
  has(/"data-tutorialreset":true/, "the reset is offered where you leave");
  has(/onHold:resetTutorialNow, holdMs:HOLD_DELETE_MS/, "and it is held, never tapped");
  // Versioned baseline, but never at the cost of someone's practice work.
  has(/var TUTORIAL_SEED = "/, "the baseline carries a version");
  has(/if\(seen!==TUTORIAL_SEED && touched!=="1"\) resetTutorial\(\);/,
    "stale tutorial data is replaced on load ONLY while it is untouched");
  has(/ttDb\.setRaw\("tt_test_touched","1"\);/, "anything changed in there marks it as theirs");
  has(/ttDb\.remove\("tt_test_touched"\);/, "and a reset makes it the shipped copy again");
});
test("a render crash names itself instead of saying Script error", () => {
  // From the phone: "Uncaught Error: Script error." at line 0:0 - no message,
  // no stack, nothing to act on. window.onerror cannot see inside a React
  // render; a boundary gets the real error and the component stack.
  eq(count(/var TTBoundary = \(function\(\)\{/g), 1, "there is a boundary");
  const bd = s.slice(s.indexOf("var TTBoundary"), s.indexOf("function TTBoard()"));
  ok(/getDerivedStateFromError/.test(bd) && /componentDidCatch/.test(bd),
    "it catches both ways React reports a crash");
  ok(/e\.message/.test(bd) && /e\.stack/.test(bd) && /info\.componentStack/.test(bd),
    "and shows the message, the stack and the component it happened in");
  ok(/"data-crash":true/.test(bd), "in a readable block");
  ok(/typeof React\.Component!=="function"\) return TTErrorBoundary;/.test(bd),
    "degrading to a pass-through where React is a stub, so the harnesses still run");
  // The board is still wrapped; the splash is a SIBLING of the boundary, so a
  // crash in the board shows the crash report rather than a frozen splash.
  has(/React\.createElement\(TTBoundary, null, React\.createElement\(TTBoard\)\),/,
    "and the exported entry is already wrapped");
});

test("the tutorial is a sandbox - nothing in it touches the real board", () => {
  // Lanes were the one thing shared between the two modes: renaming,
  // recolouring, reordering or deleting a lane while learning did it to the
  // real board too. Every collection is now per-mode.
  [["projects","tt_test_projects"],["logs","tt_test_logs"],
   ["disruptions","tt_test_disruptions"],["breaks","tt_test_breaks"],
   ["lane order","tt_test_laneorder"],["lane meta","tt_test_lanemeta"]].forEach(([what, key]) => {
    has(new RegExp('load\\("' + key + '"'), what + " has its own tutorial store");
  });
  // Both setters switch on the mode, or a write lands in the wrong world.
  has(/var laneOrder=testMode\?testLaneOrder:realLaneOrder;/, "lane order reads the current mode");
  has(/var setLaneOrder=testMode\?setTestLaneOrder:setRealLaneOrder;/, "and writes to it");
  has(/var laneMeta=testMode\?testLaneMeta:realLaneMeta;/, "lane meta too");
  has(/var setLaneMeta=testMode\?setTestLaneMeta:setRealLaneMeta;/, "both ways");
  // Nothing may reach past the switch to a mode-specific setter directly.
  const app = s.slice(s.indexOf("var setLaneMeta=testMode"));
  ["setRealLaneOrder", "setRealLaneMeta", "setTestLaneOrder", "setTestLaneMeta"].forEach((fn) => {
    eq((app.match(new RegExp(fn + "\\(", "g")) || []).length, 0,
      "nothing calls " + fn + " directly after the switch");
  });
});

test("the two baselines say what they are for", () => {
  // First run is skeletal and names each record after WHAT IT IS, so the
  // vocabulary arrives before any example does.
  const real = s.slice(s.indexOf("var REAL_PROJECTS"), s.indexOf("var DAY_MS"));
  ["First Project", "First Stage", "Second Project", "Second Task", "Second Stage"].forEach((n) => {
    ok(real.indexOf('"' + n + '"') >= 0, "first run has " + n);
  });
  eq((real.match(/\{ id:\d+,/g) || []).length, 3, "and only three records");
  has(/"Daily Activity":  \{ label:"First Lane"/, "with First Lane");
  has(/"Projects":        \{ label:"Second Lane"/, "and Second Lane");
  eq(count(/var DEFAULT_ORDER = \["Daily Activity","Projects"\];/g), 1, "two lanes, not three");
  // The tutorial is the full demonstration, with history so nothing is blank.
  const tut = s.slice(s.indexOf("var TEST_PROJECTS"), s.indexOf("// ---- HOOKS"));
  ok(/role:"task"/.test(tut) && /role:"project"/.test(tut), "it shows a task and a project");
  ok(/kind:"finite"/.test(tut) && /kind:"ongoing"/.test(tut), "finite and ongoing");
  ok(/startAt:/.test(tut) && /endAt:/.test(tut), "a scheduled start and an end date");
  ok(/done:true/.test(tut) && /done:false/.test(tut), "stages part finished");
  ok(/var TEST_LOGS = \[/.test(tut) && /var TEST_DIST = \[/.test(tut) && /var TEST_BREAKS = \[/.test(tut),
    "and seeded history, so Reports and the badges are not empty");
  has(/load\("tt_test_logs",TEST_LOGS\)/, "which is actually wired up");
  has(/load\("tt_test_disruptions",TEST_DIST\)/, "disruptions too");
  has(/load\("tt_test_breaks",TEST_BREAKS\)/, "and breaks");
});

test("the tutorial is one bar at the head, and nothing else moves", () => {
  // It used to be a 24px frame on all four sides, insetting the app by 48px
  // each way - so the tutorial and the real board did not lay out the same,
  // and help-page screenshots would not match what a user sees.
  eq(count(/S\.testFrameBg/g), 1, "one frame element, not four");
  has(/var FW = 0;/, "and it costs the layout nothing");
  has(/var TUT_H = testMode \? 30 : 0;/, "only a bar's height at the head");
  const bar = s.slice(s.indexOf('"data-tutorialbar":true'), s.indexOf('"data-tutorialexit"'));
  ok(/position:"fixed",top:0,left:0,right:0/.test(bar), "pinned to the head");
  ok(/dir:"ltr"/.test(s.slice(s.indexOf("testMode && React.createElement"), s.indexOf('"data-tutorialexit"'))),
    "and forced LTR, so handedness cannot mirror it");
  ok(bar.indexOf("hdrBottom") < 0, "the header-position setting does not move it");
  ok(/"PRACTICE BOARD"/.test(s), "it says what it is");
  // Exit is a real button, and it asks first - leaving clears the tutorial data.
  const ex = s.slice(s.indexOf('"data-tutorialexit"'), s.indexOf('"data-tutorialexit"') + 600);
  ok(/border:"1\.5px solid "\+S\.testFrameInk/.test(ex), "Exit is a button, not a label");
  ok(/setShowTestConfirm\(true\)/.test(ex), "and it asks before leaving");
  ok(ex.indexOf("setTestMode(false)") < 0, "never leaving without asking");
  // Nothing still calls it test mode where a user can see it.
  ["TEST MODE", "Exit Test Mode", "Stay in Test", "[TEST]"].forEach((w) => {
    eq(count(new RegExp(w.replace(/[[\]]/g, "\\$&"), "g")), 0, '"' + w + '" is gone');
  });
  has(/\[PRACTICE\]/, "the copy-out says PRACTICE instead");
  has(/"Leave Practice Board"/, "and the way out says where you are leaving");
});

test("a lane is edited in its own full-size form", () => {
  const le = s.slice(s.indexOf("function LaneEditModal(props){"), s.indexOf("// ---- EDIT LANES MODAL"));
  // The edit twin of New Lane: same field, same swatches, same live preview.
  ok(/"data-lanename":true/.test(le), "a real name field, not an inline cell");
  ok(/laneColors\(\).map/.test(le), "the full swatch grid");
  ok(/gridTemplateColumns:"repeat\(4,1fr\)"/.test(le), "laid out four across, as New Lane is");
  ok(/"data-lanepreview":true/.test(le), "and a live preview");
  ok(le.indexOf('"data-lanepreview"') < le.indexOf('LABEL_STYLE }, "Color"'),
    "the preview sits under the name, where a rename shows as it is typed");
  // Delete must never be a neighbour of Save.
  // The row now lives in the Modal's `actions` (the sticky box); the order
  // written there is what ACTION_DIR() mirrors.
  const row = le.slice(le.indexOf("React.createElement(Modal, { actions:["), le.indexOf("], title:"));
  const iSave = row.indexOf('"data-lanesave"'), iCancel = row.indexOf(">Cancel") >= 0 ? row.indexOf("Cancel") : row.indexOf("Cancel");
  const iDel = row.indexOf('"data-lanedelete"');
  ok(iSave >= 0 && iDel >= 0, "both are in the one action row");
  ok(iSave < iCancel && iCancel < iDel,
    "written Save, Cancel, Delete - so the mirror puts Delete in the far corner");
  ok(/flex:"0 0 auto"/.test(row), "and Delete does not claim an equal share of the row");
  // Deleting a lane asks, and offers somewhere for its projects to go.
  ok(/setConfirm\(true\)/.test(le), "delete asks first");
  ok(/"data-movelane":k/.test(le), "offering to move the projects into another lane");
  ok(/onDeleteLane\(laneKey,"delete",null\)/.test(le), "or to take them with it, said plainly");
  ok(/inside\.length===0 \? "This lane is empty\."/.test(le), "and it says how many are inside");
});

test("Save sits under the thumb and Cancel away from it", () => {
  // Children are always written Save first, Cancel second; the flex direction
  // does the mirroring. Right-handed puts Save on the right, left-handed on
  // the left. It was the other way round, which put Cancel under the thumb.
  eq(count(/function ACTION_DIR\(\)\{/g), 1, "one rule for the direction");
  // The app root flips to dir="rtl" for a left-hander and that mirrors every
  // flex row already. ACTION_DIR used to flip too, and the two cancelled: Save
  // sat on the right for BOTH hands. It is a constant row-reverse now.
  has(/function ACTION_DIR\(\)\{ return "row-reverse"; \}/, "and it is the right way round - one mirror, not two");
  const ma = s.slice(s.indexOf("function ModalActions(props){"), s.indexOf("function MODAL_CANCEL"));
  ok(ma.indexOf("flexDirection: ACTION_DIR()") >= 0, "the shared action bar reads the rule");
  eq((ma.match(/UI\.left/g) || []).length, 0, "and does not decide for itself");
  // Hand-rolled Save+Cancel rows must read it too, or they mirror the wrong way
  // on one hand while the shared bar mirrors the right way.
  // Grows as new modals supply their own action row; what matters is that
  // every Save+Cancel pair reads the shared rule rather than hardcoding one.
  // No hand-rolled pairs remain: every sheet hands its buttons to Modal's
  // `actions`, and ModalActions applies ACTION_DIR() once for all of them.
  eq(count(/style:ACTION_ROW\(\)/g), 0, "no hand-rolled pair remains");
  ok(/flexDirection: ACTION_DIR\(\)/.test(s.slice(s.indexOf("function ModalActions(props){"))), "the shared box reads the rule");
  const pairs = [...s.matchAll(/React\.createElement\("div", \{ style:\{display:"flex",gap:"0\.5rem"\}/g)];
  pairs.forEach((m) => {
    const tail = s.slice(m.index, m.index + 1400);
    // A flex row that is NOT an action row (a date/time pair, say) may sit
    // above a proper ACTION_ROW(); only a MODAL_CANCEL with no ACTION_ROW
    // before it is a hardcoded pair.
    const c = tail.indexOf("MODAL_CANCEL()"), a = tail.indexOf("ACTION_ROW()");
    ok(c < 0 || (a >= 0 && a < c),
      "no Save+Cancel pair is left with a hardcoded direction");
  });
  // Save must come first in source everywhere, or the mirroring inverts it.
  ["ModalActions"].forEach(() => {
    const bar = s.indexOf("!props.ownActions && React.createElement(ModalActions");
    const seg = s.slice(bar, bar + 420);
    ok(seg.indexOf("props.onSave") < seg.indexOf("props.onClose"),
      "the shared bar lists Save before Cancel");
  });
});

test("modal action buttons are big enough and heavy enough to read", () => {
  eq(count(/var MODAL_BTN_FONT = "1\.05rem";/g), 1, "one size for all of them");
  const c = s.slice(s.indexOf("function MODAL_CANCEL()"), s.indexOf("var MODAL_BTN_FONT"));
  ok(/fontWeight:700/.test(c), "Cancel is bold - it was inheriting normal weight");
  ok(/fontSize:MODAL_BTN_FONT/.test(c), "and takes the shared size");
  const v = s.slice(s.indexOf("function MODAL_SAVE()"), s.indexOf("function MODAL_SAVE()") + 400);
  ok(/fontWeight:700/.test(v) && /fontSize:MODAL_BTN_FONT/.test(v), "so does Save");
  // Nothing paired with a Cancel may sit at the old smaller size.
  eq((s.match(/fontSize:"0\.95rem"\} \}, "Save Stages"\)/g) || []).length, 0,
    "no action button left behind at 0.95rem");
  ok(count(/fontSize:MODAL_BTN_FONT/g) >= 8, "every action button reads the shared size");
});

test("a modal that names a menu row wears that row's glyph", () => {
  eq(count(/var MODAL_GLYPHS = \{/g), 1, "one title-to-glyph map");
  eq(count(/function ModalGlyph\(props\)\{/g), 1, "one component reads it");
  const map = s.slice(s.indexOf("var MODAL_GLYPHS = {"), s.indexOf("function ModalGlyph(props){"));
  // Every glyph named here must exist, or the title silently renders bare.
  const tbl = s.slice(s.indexOf("var MENU_GLYPHS = {"), s.indexOf("var MODAL_GLYPHS = {"));
  [...map.matchAll(/:"([a-z]+)"/g)].map((m) => m[1]).forEach((g) => {
    ok(g === "interface" || new RegExp('(^|\\s)"?' + g + '"?:').test(tbl),
      g + " is a glyph that exists");
  });
  // Every title named here must be a real modal title, or the entry is dead.
  // Titles are sometimes chosen inline - title:x?"Edit Task":"Edit Project" -
  // so the literal need not sit directly after "title:". Requiring that it did
  // failed three correct entries.
  [...map.matchAll(/"([^"]+)":"[a-z]+"/g)].map((m) => m[1]).forEach((t) => {
    ok(s.indexOf('"' + t + '"') >= 0, '"' + t + '" is a title some modal actually uses');
  });
  // Prefix entries exist for titles that carry a record's name.
  const pfx = s.slice(s.indexOf("var MODAL_GLYPH_PREFIX"), s.indexOf("var MODAL_GLYPHS"));
  ok(/\["Stages - ","stages"\]/.test(pfx), "the stages sheet is matched on its opening");
  const mg2 = s.slice(s.indexOf("function ModalGlyph(props){"), s.indexOf("function MenuIcon(props){"));
  ok(mg2.indexOf("MODAL_GLYPHS[title]") < mg2.indexOf("MODAL_GLYPH_PREFIX"),
    "an exact title always beats a prefix that happens to cover it");
  // Titles that never came from a menu row stay bare: a confirmation or a
  // picker wearing a menu glyph would claim to be a screen it is not.
  ["Match Tasks?","Regular or Overtime?","New Start Time","Delete lane","Not Started Yet"]
    .forEach((t) => ok(map.indexOf('"' + t + '"') < 0, '"' + t + '" stays bare'));
  const mg = s.slice(s.indexOf("function ModalGlyph(props){"), s.indexOf("function MenuIcon(props){"));
  ok(/if\(!name\) return null;/.test(mg), "an unmapped title renders nothing at all");
  // Both branches, not just whichever one the regex happens to hit first.
  const sizes = [...mg.matchAll(/size:(\d+)/g)].map((m) => Number(m[1]));
  eq(sizes.length, 2, "both branches declare a size");
  ok(sizes.every((n) => n === 20), "sized to the title, not to the menu row");
});

test("title glyphs are written first and let the mirror do the rest", () => {
  // The board sits inside dir=rtl when left-handed, so a flex row already lays
  // its children right to left. Writing the glyph first is all that is needed
  // for it to land after the title on that hand. A UI.left conditional here
  // cancels the mirror out and pins the glyph to one side on both - which is
  // what the modal header was doing until this was measured in a browser.
  eq(count(/function TitleGlyph\(props\)\{/g), 1, "one component for a title glyph");
  const tg = s.slice(s.indexOf("function TitleGlyph(props){"), s.indexOf("function ModalGlyph(props){"));
  ok(tg.indexOf("UI.left") < 0, "it does not try to mirror itself");
  const h0 = s.indexOf('justifyContent:UI.left?"flex-end":"flex-start"');
  const hdr = s.slice(h0, s.indexOf("props.children", h0));
  eq((hdr.match(/React\.createElement\(ModalGlyph/g) || []).length, 1,
    "the modal header mounts its glyph once, unconditionally");
  ok(hdr.indexOf("ModalGlyph") < hdr.indexOf("props.title)"),
    "and writes it before the title");
  ok(hdr.indexOf("UI.left ?") < 0, "with no conditional left to fight the mirror");
  // Lanes, projects and tasks each lead with their own glyph.
  [["lanes", "meta.accent"], ["project", "titleCol"], ["task", "titleCol"]].forEach(([n]) => {
    ok(new RegExp('TitleGlyph, \\{ name:"' + n + '"').test(s), n + " titles carry a glyph");
  });
  eq(count(/React\.createElement\(TitleGlyph, \{/g), 3, "three title sites, no more");
});

test("nothing is left drawing its own chrome glyph", () => {
  // GearSVG was the one glyph in the set that was filled rather than stroked.
  // It survives for two non-menu uses; the menu and the header must not be
  // among them, or the family is inconsistent again.
  const i = s.indexOf('menuOpen && React.createElement("div", { dir:"ltr", "data-surface":"menu"');
  const menu = s.slice(i, s.indexOf("// CLOCK button", i));
  ok(menu.indexOf("GearSVG") < 0, "no gear left in the settings menu");
  const hdr = s.slice(s.indexOf("// SETTINGS MENU button"), i);
  const hb = s.slice(s.indexOf("function HeaderMenuButton(props){"), s.indexOf("function HeaderMenuButton(props){")+600);
  ok(hdr.indexOf("React.createElement(HeaderMenuButton") >= 0 && hb.indexOf('MenuIcon, { name:"more"') >= 0,
    "the header button uses the hamburger");
  ok(hdr.indexOf("GearSVG") < 0, "and not the gear");
});

test("the Interface group has its own icon", () => {
  eq(count(/function TouchSVG\(props\)\{/g), 1, "TouchSVG is declared once");
  const ic = s.slice(s.indexOf("function TouchSVG(props){"), s.indexOf("// The settings menu reads"));
  ok(/viewBox:"0 0 28 28"/.test(ic), "on the same 28-unit grid as the clock glyph");
  ok(/fill:"none"/.test(ic), "stroked, not filled, like the rest");
  // The hand is drawn on its own grid and scaled down, so its stroke is
  // pre-divided to land back on 2.5. Asserting the literal 2.5 would fail on a
  // correct icon; asserting the arithmetic is what actually holds the weight.
  ok(/var TOUCH_SCALE = 0\.\d+;/.test(s), "the hand's scale is a named constant");
  ok(/\(2\.5\/TOUCH_SCALE\)/.test(ic), "and its stroke is divided by that same scale");
  ok(/scale\("\+TOUCH_SCALE\+"\)/.test(ic),
    "the transform reads the constant too, so the two cannot drift apart");
  const scale = Number((s.match(/var TOUCH_SCALE = (0\.\d+);/) || [])[1]);
  ok(scale > 0 && Math.abs((2.5 / scale) * scale - 2.5) < 1e-9,
    "so the hand renders at the shared 2.5 weight");
  ok(/strokeLinejoin:"round"/.test(ic), "joins are round like the rest of the set");
  // The ripples are thinner than the hand on purpose, and both must stay under
  // it - a ripple at full weight competes with the finger it comes off.
  const rw = [...ic.matchAll(/strokeWidth:"(\d\.\d)"/g)].map((m) => Number(m[1]));
  eq(rw.length, 2, "two ripples, and only two");
  ok(rw.every((w) => w > 0 && w < 2.5), "each lighter than the hand");
  ok(rw[0] > rw[1], "and the outer one lighter than the inner it spreads from");
  // The glyph once shipped clipped: the artwork measured 28.1 x 23.3 units in a
  // 28 box and lost its corner. Nothing here caught it, because the bounding
  // box of a rotated hand plus two arcs is nowhere near the numbers written in
  // the path data. This checks what can be checked without rasterising - the
  // ripples, whose extents are just centre plus radius plus half the stroke.
  // The hand still needs an eye on a render; see HANDOVER.
  const cen = ic.match(/translate\((\d+\.?\d*),(\d+\.?\d*)\) rotate\(-45\)/);
  ok(!!cen, "the composition declares its anchor point");
  const [ax, ay] = cen ? [Number(cen[1]), Number(cen[2])] : [0, 0];
  const arcs = [...ic.matchAll(/A(\d+\.?\d*) \d+\.?\d* 0 1 1/g)].map((m) => Number(m[1]));
  eq(arcs.length, 2, "two ripple radii declared");
  arcs.forEach((r, i) => {
    const reach = r + rw[i] / 2;
    ok(ax - reach >= 0 && ax + reach <= 28 && ay - reach >= 0 && ay + reach <= 28,
      "ripple " + (i + 1) + " stays inside the 28-unit box");
  });
  ok(ic.indexOf("props.col||S.chromeText") >= 0, "and it takes its colour from the caller");
  // Two uses now: the menu row, and the Interface modal's own title. Both are
  // the same screen, which is the point - anything beyond those two means the
  // glyph has been borrowed for something it does not name.
  eq(count(/React\.createElement\(TouchSVG,/g), 2, "used in exactly two places");
  ok(s.slice(s.indexOf('"data-menugroup":"interface"'), s.indexOf('"Interface"',
      s.indexOf('"data-menugroup":"interface"'))).indexOf("TouchSVG") >= 0,
    "one is the Interface row");
  ok(s.slice(s.indexOf("function ModalGlyph(props){"), s.indexOf("function MenuIcon(props){"))
      .indexOf("TouchSVG") >= 0, "the other is its modal title");
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
  // The outline's controller is pinned above its own sheet and below the
  // toast: 900 modal, 920 controller, 950 toast. Three layers, named, so a
  // fourth cannot appear without this failing.
  has(/zIndex:920/, "the outline controller at 920");
  eq(count(/zIndex:9[0-9][0-9]/g), 3, "and nothing else above the modal layer");
  const ctrlZ = s.indexOf("zIndex:920");
  ok(ctrlZ > s.indexOf('"data-controller":true') && ctrlZ - s.indexOf('"data-controller":true') < 400,
    "920 belongs to the controller and nothing else");
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
  // Exactly one toDateString among the SURFACES, and it is inside workDayOf.
  // The tutorial's seed data is excluded: it fabricates records at fixed
  // offsets from today and has to stamp their day key at build time, which is
  // not a surface reading the clock.
  const seedStart = s.indexOf("// ---- SAMPLE DATA ---");
  const seedEnd = s.indexOf("// ---- HOOKS ---");
  const noSeed = s.slice(0, seedStart) + s.slice(seedEnd);
  eq((noSeed.match(/toDateString\(\)/g) || []).length, 2, "no surface does its own date maths");
  // And the seed only stamps days on records it is inventing.
  const seed = s.slice(seedStart, seedEnd);
  ok((seed.match(/toDateString\(\)/g) || []).length <= 3, "the seed stamps a day key and nothing more");
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
  // Two halves, and the second one was missing: nothing may start before the
  // question is answered, AND the thing the user tapped has to happen once it
  // is. The board used to come back with nothing running and no sign the tap
  // had been dropped.
  has(/askWorkDay\(now, function\(day, ot\)\{ commitClockIn\(now, day, ot\); if\(then\) then\(now\); \}\);/,
    "an unresolved clock-in defers, then resumes what was asked for");
  has(/return false;/, "and still reports that it deferred");
  has(/if\(!atWorkStart\)\{ clockIn\(function\(at\)\{ runToggle\(id, at\); \}\); return; \}/,
    "a tap on a project hands itself to the clock-in as the continuation");
  has(/function runToggle\(id, now\)\{/, "the start itself is separable from the gate");
  // Both clock-in paths must call back, or the sync path silently does nothing.
  const ci = s.slice(s.indexOf("function clockIn(then){"), s.indexOf("function commitClockIn"));
  eq((ci.match(/if\(then\) then\(now\)/g) || []).length, 2,
    "both the deferred and the immediate path resume the caller");
  ok(ci.indexOf("commitClockIn(now, auto, null);") < ci.lastIndexOf("if(then) then(now)"),
    "and the immediate path clocks in before resuming");
  // Every record that carries time must carry the day it was filed under.
  eq(count(/day:curDay\(\)/g), 3, "project logs, disruptions and breaks are all stamped");
  has(/\{id:uid\(\),day:day,projectId:null,projectName:"At Work"/, "and so is the clock-in itself");
});

test("clocking out lands on Reports for the day just finished", () => {
  eq(count(/function openReports\(kind\)\{/g), 1, "one way into Reports");
  const co = s.slice(s.indexOf("function clockOut(){"), s.indexOf("function openReports"));
  ok(co.indexOf('openReports("day")') >= 0, "clock-out opens it on the day");
  ok(co.indexOf("setShowDay(true)") < 0, "and no longer on the copy-out sheet");
  // Everything that ends the shift must still be closed off first, or the
  // report is built from a day that is not finished yet.
  ["finalizeProject(now)", "closeDisruption(now)", "endBreak()"].forEach((c) => {
    ok(co.indexOf(c) >= 0 && co.indexOf(c) < co.indexOf('openReports("day")'),
      c + " runs before Reports opens");
  });
  ok(co.indexOf("setAtWorkStart(null)") < co.indexOf('openReports("day")'),
    "and the clock is stopped first");
  // The modal reads its period once on mount, so a stale value would make the
  // menu open on whatever was used last.
  eq(count(/openReports\("week"\)/g), 1, "the menu entry states its own period");
  has(/initialKind:reportsKind/, "and the modal is told which to use");
  eq(count(/setShowReports\(true\)/g), 1, "only openReports opens it");
  // Day Summary is not orphaned - it is still on the ticker.
  ok(count(/setShowDay\(true\)/g) >= 1, "the day sheet is still reachable");
  has(/showDay && React\.createElement\(DaySummary/, "and still mounted");
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
  has(/if\(project\) return projRole\(project\);/, "an existing project keeps what it already is");
  has(/if\(props\.defaultRole\) return props\.defaultRole;/,
    "a caller asking for a nested project gets one");
  has(/return \(defaultParentId\|\|null\)!=null \? "task" : "project";/,
    "and without a request, nesting still implies a task");
  // Placement now saves only when the form owns it - opened from the outline
  // these keys are omitted so the panel cannot overwrite an arrangement the
  // outline is still holding.
  has(/out\.role = pid==null \? "project" : role;/, "and only a top-level save forces project");
  has(/if\(props\.structure!==false\)\{/, "placement is written only when the form owns it");
  const sub = s.slice(s.indexOf("function submit(){"), s.indexOf("var hintStyle"));
  ok(sub.indexOf("out.lane=lane") > sub.indexOf("if(props.structure!==false)"),
    "lane, parent and role all sit inside that branch");
  ok(/name:name\.trim\(\), notes:notes\.trim\(\), kind:kind,/.test(sub),
    "while name, notes and type always save");
  has(/keys:\["task","project"\], value:role/, "with a toggle to choose when nested");
});

test("a nested project draws as a card tucked under its parent", () => {
  // Two lists: what is DRAWN (finished work included, sunk to the end) and
  // what is COUNTED (live only - a finished task is not outstanding).
  has(/var childTasksAll=subTasks\.filter\(isTaskRole\)\.slice\(\)\.sort\(sinkClosed\);/, "tasks and nested projects are separated");
  has(/var childTasks=childTasksAll\.filter\(isOpen\);/, "and the counted list drops the finished ones");
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
  has(/renderKids\(childTasksAll, 1\)/, "tasks stay as rows inside the card, finished ones included");
});

test("the collapsed card can see everything it reads", () => {
  const src = source();
  const card = src.slice(src.indexOf("function ProjectCard(props){"));
  const decl = card.indexOf("var childTasksAll=subTasks.filter(isTaskRole)");
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
  // The completed pill does NOT take the tuck: that headroom is for a nested
  // CARD sitting under its parent's title, and on a slim pill it landed on
  // the parent's bottom border.
  eq(count(/marginTop:isNestedCard\?"-12px":0/g), 2,
    "expanded card and collapsed pill are pulled up alike");
});

test("a select hands back a string, and project ids are numbers", () => {
  // Every child lookup is a strict ===, so an unresolved "3" would file a
  // project under a parent nothing can match and drop it off the board.
  has(/function resolveParentId\(v\)\{/, "the picked value is resolved to a real id");
  has(/return hit \? hit\.id : null;/, "by matching it against the actual projects");
  has(/var pid=resolveParentId\(parentId\);/, "and save goes through it");
  has(/out\.parentId=pid;/, "handing the resolved id on");
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
  has(/var nested = deepAll\.length > childTasksAll\.length;/, "the card notices when it is deeper than one level");
  // The count is of what is THERE, not what is left: an outstanding-only
  // count read "0 tasks" once everything was done, the expander vanished, and
  // the finished tasks it hid could never be reopened. How many are done is
  // said alongside.
  has(/var countLabel = \(nested \? \(totalTasks\+" nested"\) : \(totalTasks\+" task"\+\(totalTasks!==1\?"s":""\)\)\)/, "and says so");
  has(/\+ \(doneTasks>0 \? " \\u00b7 "\+doneTasks\+" done" : ""\);/, "with how many of them are finished");
  eq(count(/childTasksAll\.length>0/g), 4, "and every gate that opens the contents counts what is there, not what is left");
});

test("closing out is not deleting, and the board knows the difference", () => {
  // The board no longer drops finished records: they stay as a greyed,
  // minimised pill, because a record vanishing the moment it is completed
  // gives no confirmation that anything happened. Counts filter locally.
  has(/var liveProjects=projects;/, "the board keeps finished records");
  has(/if\(isClosed\(proj\)\)\{/, "a finished project draws as a completed pill");
  has(/if\(isClosed\(sub\)\)\{/, "and a finished task as a completed row");
  eq(count(/"data-donetag":true/g), 2, "both say so next to the name");
  eq(count(/"data-reopen":(proj|sub)\.id/g), 2, "and both are HELD to reopen");
  ok(!/onClick:function\(\)\{ if\(props\.onReopen\)/.test(s), "reopening is never a plain tap");
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
  // The closed record gets when, note and OUTCOME. Open children are never
  // silently hidden: they are closed with it, or moved up a level - the
  // sheet asks which.
  has(/if\(p\.id===proj\.id\) return Object\.assign\(\{\},p,\{ closedAt:at, closedNote:opts\.note\|\|"", closedOutcome:opts\.outcome\|\|"done" \}\);/,
    "the record is stamped with when, note and outcome");
  has(/var at = opts\.at \|\| Date\.now\(\), res = opts\.resolutions \|\| \{\};/, "and when is the sheet's time, defaulting to now");
  has(/if\(openKids\.some\(function\(id\)\{ return !res\[id\]; \}\)\) return;/,
    "an undecided child stops the close outright - belt and braces behind the sheet");
  has(/if\(r && r\.kind==="move" && p\.parentId===proj\.id\) return Object\.assign\(\{\},p,\{ parentId:r\.parentId\|\|null, lane:r\.lane\|\|p\.lane \}\);/,
    "a moved child takes the parent and lane that were chosen");
  has(/if\(res\[id\]\.kind==="delete"\)\{ gone\[id\]=true; getDescendantIds\(projects,id\)\.forEach\(function\(d\)\{ gone\[d\]=true; \}\); \}/,
    "a deleted child goes with its whole subtree");
  has(/return prev\.filter\(function\(p\)\{ return !gone\[p\.id\]; \}\)/, "removed, not hidden");
  eq(count(/closedNote:"", closedOutcome/g), 0, "and nothing is ever closed over silently");
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

test("the last stage offers a choice: complete it, or add more stages", () => {
  // Ticking the last stage used to jump straight to the close-out, and only
  // for a finite project with no open children. Now it OFFERS, for any open
  // record whose stages are all ticked: complete it, or add the stages still
  // to come. Open children are the sheet's business, not a reason to stay quiet.
  has(/if\(next && isOpen\(next\) && stagesAllDone\(next\)\)\{\s*setStagesDone\(next\);/,
    "all stages ticked raises the offer, finite or ongoing, children or not");
  eq(count(/^function StagesDoneModal\(props\)\{/gm), 1, "the offer is its own sheet");
  ["close", "more", "later"].forEach((k) => has(new RegExp('"data-stagesdone":"' + k + '"'), "with a " + k + " choice"));
  has(/setStagesDone\(null\); askCloseOut\(pr\); \}/, "complete-it leads to the closure sheet");
  has(/setStagesDone\(null\); setStagesProj\(pr\); \}/, "add-more-stages leads to the stage list");
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

test("the settings menu has no Add New row, and no dead chooser behind it", () => {
  // Removed at Brent's request. The chooser had exactly one entry point, so
  // taking the row out left the modal unreachable - dead code with state, the
  // thing this suite exists to catch. Component, state and mount all went.
  ok(!/"Add New/.test(s), "no Add New row");
  ok(!/function AddNewModal\(props\)\{/.test(s), "no chooser component");
  ok(!/addNew/.test(s), "no state left write-only");
  ok(!/addMenuOpen/.test(s) && !/addMenuRef/.test(s), "and none of the older accordion either");
  // Adding is still reachable from the board and the outline: a lane header's
  // menu, a card's menu, and every row menu in the outline.
  has(/rowMenuItems\(kind, role, a\)/, "row menus still offer New lane / project / task");
});

test("the project form calls a task a task", () => {
  has(/var noun = \(parentId!=null && role==="task"\) \? "Task" : "Project";/,
    "the noun follows the live parent selection and the chosen role");
  // Editing says only "Save" - the modal title already names the subject, and
  // every sheet in the app says the same word. Creating still names the thing,
  // because "Add Task" says something "Save" does not.
  has(/project\?"Save":\("Add "\+noun\)/, "creating uses the noun, editing just says Save");
  // No sheet may reintroduce a bespoke save label.
  ["Save Changes","Save Lane","Save Lanes","Save Layout","Save List","Save Stages",
   "Save Start Time","Save Schedule"].forEach((lbl) => {
    eq(count(new RegExp('"' + lbl + '"', "g")), 0, '"' + lbl + '" is gone');
  });
  has(/\} \},\s*"Delete "\+noun\)/, "and so does the destructive one");
  ok(!/"Add Project"/.test(s), "nothing hard-codes Add Project any more");
  ok(!/\}, "Delete Project"\)/.test(s), "nor a hard-coded Delete Project on a form button");
  // The delete-confirmation modal already branched correctly and keeps its own
  // wording, including the count of tasks that go down with a parent.
  has(/title:isSub\?"Delete Task":"Delete Project"/, "the confirmation modal is unaffected");
  // The modal title already branched on this; the buttons inside it did not.
  // Three titles now: adding into a lane, adding a nested project, adding a
  // task. Nesting alone cannot tell the last two apart - the caller says which.
  has(/title:!showAdd\.parentId \? \("Add to "\+\(getMeta\(laneMeta,showAdd\.lane\)\.label\)\)/,
    "adding into a lane names the lane");
  has(/showAdd\.role==="project" \? "Add Nested Project" : "Add Task"/,
    "and a nested add says which of the two it is");
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
  // From the board: the User Manual stages both sheets earlier in the file.
  const b0 = s.indexOf("function TTBoard(){");
  const i = s.indexOf("React.createElement(BackupModal", b0);
  const j = s.indexOf("React.createElement(ExtensionsModal", b0);
  const k = s.indexOf("ttModuleContext(modScreen.id", b0);
  ok(i > 0 && i < j && j < k, "sits between Backup and the module screens");
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
    " ToolsScreen, ToolsCheckoutSheet, ToolsEditorSheet, ToolsConfirmSheet," +
    " TOOLS_HELP, toolsHelpStage, toolsHelpSample, ttMemoryStorage };";
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

// ---- Tool Tracker's pages in the User Manual ---------------------------------
test("Tool Tracker brings its own topic: a picture of each screen, guides out and back in", () => {
  const p = loadTools();
  const h = p.TT.module("tools").help;
  ok(h === p.TOOLS_HELP, "registered through the help field");
  eq(h.topic, "Tool Tracker", "under its own topic");
  same(Object.keys(h.pictures), ["tools:screen", "tools:checkout"], "pictures of the screen and the checkout sheet");
  same(Object.keys(h.guides), ["tools:out", "tools:back"], "guides for checking out and checking back in");
  ok(h.pictures["tools:screen"].covers.indexOf("Tools") >= 0, "the Tools menu row is covered");
  const prose = [];
  Object.keys(h.pictures).forEach((k) => { const pic = h.pictures[k]; prose.push(pic.title, pic.blurb);
    pic.parts.forEach((pt) => prose.push(pt.label, pt.text)); });
  Object.keys(h.guides).forEach((k) => { prose.push(h.guides[k].title);
    h.guides[k].steps.forEach((st) => prose.push(st.title, st.text)); });
  same(prose.filter((t) => /\d/.test(t)), [], "no figure in any of it - the sample's times move with the clock");
  const how = [];
  Object.keys(h.pictures).forEach((k) => h.pictures[k].parts.forEach((pt) => { if (pt.guide) how.push(pt.guide); }));
  ok(how.length > 0 && how.every((g) => !!h.guides[g]), "every How > leads to one of its own guides");
});

test("every ring and anchor names a hook the module really draws", () => {
  const src = moduleBlock();
  const p = loadTools();
  const h = p.TOOLS_HELP;
  const sels = [];
  Object.keys(h.pictures).forEach((k) => h.pictures[k].parts.forEach((pt) => sels.push(pt.anchor)));
  Object.keys(h.guides).forEach((k) => h.guides[k].steps.forEach((st) => sels.push(st.ring)));
  sels.forEach((q) => {
    const m = /^\[data-anchor="([^"]+)"\]$/.exec(q);
    ok(!!m, q + " is a data-anchor selector");
    if (!m) return;
    const v = m[1];
    const drawn = v.indexOf("set-") === 0
      ? src.indexOf('name:"' + v.slice(4) + '"') >= 0                       // a Toggle answers to set-<name>
      : src.indexOf('"data-anchor":"' + v + '"') >= 0 || src.indexOf('saveAnchor:"' + v + '"') >= 0 ||
        src.indexOf('"' + v + '")') >= 0;                                   // passed to actionBtn
    ok(drawn, v + " is drawn by the module");
  });
});

test("Tool Tracker's stage draws sample data in memory and writes nothing", () => {
  const st = memStorage({ tt_mod_tools_tools: "[]" });
  const p = loadTools({ storage: st });
  const before = JSON.stringify(st.snapshot());
  const ctx = () => ({ moduleId: "tools", storage: p.ttMemoryStorage(), api: p.TT, projects: [], laneMeta: null, onClose() {} });
  const scr = p.toolsHelpStage({ module: "tools", kind: "screen", view: "all" }, ctx());
  eq(scr.type, p.ToolsScreen, "the screen stage is the real ToolsScreen");
  eq(scr.props.initialView, "all", "opened on the tab the stage asks for");
  eq(p.toolsHelpStage({ module: "tools", kind: "screen" }, ctx()).props.initialView, "out", "Out when it does not say");
  ok(scr.props.storage.get("tools", []).length > 0 && scr.props.storage.get("checkouts", []).length > 0,
    "seeded with sample tools and checkouts");
  ok(scr.props.storage.get("checkouts", []).some((c) => c["in"] === null), "one of them still out");
  eq(scr.props.activeId, 103, "with a practice-board job running, so the checkout default shows");
  const sheet = p.toolsHelpStage({ module: "tools", kind: "checkout" }, ctx());
  eq(sheet.type, p.ToolsCheckoutSheet, "the checkout stage is the real sheet");
  eq(p.toolsHelpStage({ module: "tools", kind: "nonsense" }, ctx()), null, "an unknown stage draws nothing");
  // Whether the hooks are really drawn is boot's job: it renders every stage for real.
  eq(JSON.stringify(st.snapshot()), before, "and the real store was never touched");
  ok(!/localStorage|ctx\.api\.storage\(|TT\.storage\(/.test(moduleBlock().slice(moduleBlock().indexOf("function toolsHelpSample"),
    moduleBlock().indexOf("var TOOLS_HELP"))), "the stage reaches no store but the one it is handed");
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


// ============================================================
// user manual: guides + practice board
// ============================================================
(function(){
// The manual's source-level rules. The runtime freshness checks - every anchor
// a guide rings exists in what its stage renders, every named record exists,
// no prose quotes a figure - live in boot.js, which evaluates the BUILT file.
const s = source();
const has = (re, label) => ok(re.test(s), label);
const count = (re) => (s.match(re) || []).length;
const slice = (a, b) => { const i = s.indexOf(a); return s.slice(i, s.indexOf(b, i + a.length)); };


test("there is one swipe, and every lane, card and task row uses it", () => {
  eq(count(/^function useSwipe\(onSwipe\)\{/gm), 1, "useSwipe is defined once");
  eq(count(/useSwipe\(function\(dir\)\{/g), 4, "called by the task row, the card, the lane - and the manual's practice panel");
  eq(count(/swipeX/g), 0, "no hand-written swipe survives anywhere");
  eq(count(/dx>50|Math\.abs\(dx\)>50/g), 0, "the threshold is not typed in at a call site");
  has(/var SWIPE_MIN_PX = 50;/, "it is one named constant");
  eq(count(/sw\.pill\.onTouchEnd/g), 3, "each collapsed pill uses the right-only half");
  eq(count(/sw\.open\.onTouchEnd/g), 3, "each open name uses the either-way half");
  eq(count(/onClick:sw\.guard\(/g), 4, "and every name that can be swiped swallows the tap a swipe ends in");
  const hook = s.slice(s.indexOf("function useSwipe(onSwipe){"), s.indexOf("function useTaps("));
  ok(!/preventDefault/.test(hook), "it never fights the page for the gesture - read on release only");
  ok(!/onTouchMove/.test(hook), "and never listens to the move at all");
});


test("the header's buttons are components the board and the manual share", () => {
  eq(count(/React\.createElement\(ClockButton, \{ clocked:clocked, sub:ckSub/g), 1, "the header draws ClockButton");
  eq(count(/React\.createElement\(DisruptButton, \{ mode:dActive\?"active":\(dStandalone\?"standalone":"idle"\)/g), 1, "and DisruptButton");
  eq(count(/distMenuOpen && React\.createElement\(DisruptPresetList, \{ presets:distPresets/g), 1, "and the reasons list");
  ok(!/var ckBg|var dBg/.test(s.slice(s.indexOf("function TTBoard(){"))), "the colours live in the components, not copied in the board");
  const el = s.slice(s.indexOf("function helpStageEl(stage, on){"), s.indexOf("var HELP_CARD_W"));
  ok(/React\.createElement\(ClockButton/.test(el) && /React\.createElement\(DisruptButton/.test(el) && /React\.createElement\(DisruptPresetList/.test(el),
    "and the manual stages the same three");
});


test("a staged sheet can show its later stages but never act", () => {
  has(/useState\(props\.preview \? \{ obj:null, summary:props\.preview \} : null\)/, "a previewed backup opens with no backup behind it");
  has(/function doRestore\(\)\{\n    if\(!pending \|\| !pending\.obj\) return;/, "so Replace cannot apply anything");
  const el = s.slice(s.indexOf("function helpStageEl(stage, on){"), s.indexOf("var HELP_CARD_W"));
  ok(/onSave:nop, onClose:nop/.test(el) && /onPick:nop, onCancel:nop/.test(el), "every staged sheet is wired to nothing");
  ok(/HELP_SHEETS\[stage\.kind\]/.test(s), "and sheets are measured by what shows, not by what scrolls");
  has(/h=pan \? Math\.ceil\(pan\.offsetHeight\)\+34/, "the staged panel's own height, capped as on a phone");
});


test("every gesture the board uses has a practice panel", () => {
  const pr = s.slice(s.indexOf("var HELP_PRACTICE = {"), s.indexOf("var HELP_INDEX = ["));
  ["taps", "hold", "swipe", "msline", "outline"].forEach((g) => ok(pr.indexOf('"' + g + '"') >= 0, g + " can be practised"));
  // and each is the board's own code, not a copy
  ok(/useTaps\(function\(\)\{ setRes\("one"\)/.test(s), "taps: the board's useTaps");
  ok(/HoldButton, \{ onTap:function\(\)\{ setRes\("early"\)/.test(s), "hold: the board's HoldButton");
  ok(/React\.createElement\(MilestoneStrip, \{ kind:"practice"/.test(s), "zoom and pan: the board's MilestoneStrip");
});

test("every manual component is defined exactly once", () => {
  ["GuidesModal", "HelpStage", "HelpPicture", "HelpSteps", "HelpTryHold", "HelpIndexRow",
   "helpStageEl", "helpSeedProject", "HelpTryBox", "HelpTryTaps", "HelpTrySwipe", "HelpPractice",
   "ClockButton", "DisruptButton", "DisruptPresetList", "HeaderTicker", "HeaderMenuButton", "HelpTryLine", "HELP_NIGHTS"].forEach((f) => {
    eq(count(new RegExp("^function " + f + "\\(", "gm")), 1, f + " is defined once");
  });
  eq(count(/^var HELP_PICTURES = \{/gm), 1, "one picture registry");
  eq(count(/^var HELP_GUIDES = \{/gm), 1, "one guide registry");
});

test("the User Manual row opens a group holding Guides and the Practice Board", () => {
  has(/"data-menugroup":"manual"/, "the row is a menu group");
  has(/MenuIcon, \{ name:"manual", col:testMode\?S\.warnText:S\.chromeText \}/, "it wears the book glyph");
  const g = slice('menuGroup==="manual"', 'menuGroup==="time"');
  ok(/title:"User Manual"/.test(g), "the group is titled User Manual");
  ok(/label:"Guides"/.test(g), "Guides is in it");
  ok(/label:"Practice Board"/.test(g) && /label:"Leave Practice Board"/.test(g), "and the practice board, or the way out of it");
  ok(/setShowTestConfirm\(true\)/.test(g), "leaving from here still asks first");
  has(/MENU_GLYPHS = \{[\s\S]*?\n  manual: \[/, "the book is in MENU_GLYPHS, not drawn at a call site");
});

test("nothing a user can see still says tutorial", () => {
  ["Interactive Tutorial\"", "\"Exit Tutorial", "Reset tutorial", "INTERACTIVE TUTORIAL", "[TUTORIAL]",
   "you have built in the tutorial"].forEach((w) => {
    eq(s.split(w).length - 1, 0, '"' + w + '" is gone');
  });
  // The internals keep their names so nobody's practice data moves.
  has(/var TUTORIAL_SEED = "/, "TUTORIAL_SEED keeps its name");
  has(/load\("tt_testmode",false\)/, "and the practice board is still testMode underneath");
});

test("the practice bar opens the Guides without leaving practice", () => {
  const bar = slice('"data-tutorialbar":true', '"data-tutorialexit"');
  ok(/"data-tutorialguides":true/.test(bar), "there is a book button in the bar");
  ok(/setShowGuides\(true\)/.test(bar), "it opens the Guides");
  ok(bar.indexOf("setTestMode(false)") < 0, "and does not leave the practice board");
  has(/setShowGuides\(false\); setStartAsk\(null\);/, "closeAllPopups closes the Guides too");
});

test("a stage is a live, inert render whose marks are measured, never typed in", () => {
  const st = slice("function HelpStage(props){", "function HelpNum(props){");
  ok(/inert:!props\.live/.test(st) && /pointerEvents:props\.live\?"auto":"none"/.test(st), "a staged picture cannot be touched");
  eq(count(/live:true/g), 1, "and exactly one stage is live: the practice outline, whose Save only says so");
  has(/if\(stagedOutline\) return;\n    if\(!sel/, "a staged outline never scrolls the guide around it");
  ok(/querySelectorAll\(m\.anchor\)/.test(st), "each mark is placed on its anchor's measured box");
  ok(/x1=Math\.min\(x1,vis\.right\); y1=Math\.min\(y1,vis\.bottom\);/.test(st), "and cut to what is visible, so a ring never runs off the picture");
  ok(/transform:"scale\("\+k\+"\)"/.test(st), "scaled, not re-laid-out");
  ok(/position:"relative", flexShrink:0/.test(st), "and the stage never shrinks under the sheet's flex column");
  const el = slice("function helpStageEl(stage, on){", "var HELP_CARD_W");
  ok(/TEST_PROJECTS/.test(el) && !/tt_test_projects/.test(el), "stages draw from the shipped seed, never the user's practice edits");
  ok(/still:true/.test(el), "a staged card ignores the board's remembered collapse");
  ok(/todayStr\(\)/.test(el), "and finds today through the one work-day function");
  ok(/StageCtx\.Provider, \{ value:stage\.full \? HELP_STAGE_FULL : true \}/.test(st), "a staged sheet is told it is staged (and whether to show its whole height)");
  has(/"data-modal-panel":staged\?undefined:true/, "so it never answers as the live sheet on top");
});

test("Try it here is the real hold control, and writes nothing", () => {
  const t = slice("function HelpTryHold(props){", "function HelpIndexRow(props){");
  ok(/React\.createElement\(HoldButton/.test(t), "it is the real HoldButton");
  ok(/holdMs:HOLD_DELETE_MS/.test(t), "with the real hold time");
  ok(!/localStorage|save\(|load\(/.test(t), "and no practice panel touches storage");
  ok(/useTaps\(function\(\)\{ setRes\("one"\); \}/.test(t), "one tap or two is the board's own useTaps");
  ok(/useSwipe\(function\(dir\)\{/.test(t), "and the swipe panel is the board's own useSwipe");
});

test("a picture's words sit in one box under it, never a list to scroll to", () => {
  const pic = slice("function HelpWalk(props){", "function HelpPicture(props){");
  ok(/useState\(Math\.min\(props\.start\|\|0, n-1\)\)/.test(pic), "the page opens on part one (or the part a search hit names), so the box is never empty");
  ok(/"data-helpdetail":on\+1/.test(pic), "one box shows the picked part");
  ok(/position:"sticky", bottom:barH\?\(barH-20\+8\)\+"px":0/.test(pic), "and rides the foot of the sheet when the picture is tall - above the action bar when that sits at the foot too");
  ok(/"data-helpdetailnav":dir>0\?"next":"prev"/.test(pic) && /disabled:off/.test(pic), "arrows step through the items and stop at the ends");
  ok(/done=guide && dir>0 && last/.test(pic) && /if\(done\) props\.onBack\(\);/.test(pic), "on a guide's last step the next arrow is Done");
  ok(/marginTop:"auto"/.test(pic) && /fill:true/.test(pic), "and on a short page the box still sits at the sheet's foot, so it never moves");
  ok(pic.indexOf("pic.parts.map(function(pt, i){") < 0 && !/"data-helppart":i\+1, onClick:function\(\)\{ setOn\(i\); \},\n *style:\{ display:"flex"/.test(pic), "the old legend list is gone");
  ok(pic.indexOf('"data-helpdetailnav"') < pic.indexOf('"data-helpdetaillabel"'), "the controls sit above the words, so they never move under a thumb");
});

test("steady-box rule: a box whose words change keeps its tallest height", () => {
  const sb = slice("function SteadyBox(props){", "function HelpNum(props){");
  ok(/gridArea:"1 \/ 1"/.test(sb), "every variant shares one grid cell, so the cell is as tall as the longest");
  ok(/visibility:ghost\?"hidden":"visible"/.test(sb) && /"aria-hidden":ghost\?true:undefined/.test(sb), "the rest are held invisibly and hidden from screen readers");
  const pic = slice("function HelpWalk(props){", "function HelpPicture(props){");
  ok(/SteadyBox, \{ count:n, at:on/.test(pic), "the instruction box - pictures and guides alike - is one");
  ok(/"data-helphow":ghost\?undefined:p\.guide/.test(pic), "and a ghost part carries no How > hook");
  const tb = slice("function HelpTryBox(props){", "function HelpTryHold(");
  ok(/SteadyBox, \{ count:keys\.length/.test(tb), "every practice panel's reply is one");
  eq(count(/, msg:msg,/g), 0, "no panel passes a single message any more - each lists all it can say");
});

test("picking a part from the box brings it to the middle of the clear band", () => {
  const pic = slice("function HelpWalk(props){", "function HelpPicture(props){");
  ok(/var pick=function\(i\)\{ wantScroll\.current=true; setOn\(i\); \};/.test(pic), "the box's chips and arrows ask for a scroll");
  ok(/else if\(!off\) pick\(to\);/.test(pic) && /onClick:function\(\)\{ pick\(i\); \}/.test(pic), "both of them");
  ok(/onPick:function\(\)\{ setOn\(i\); \}/.test(pic), "a tapped number does not - it is already on screen");
  const c = slice("function helpCentrePart(box, i, onlyIfHidden){", "function HelpWalk(props){");
  ok(/bandBot=P\.top\+panel\.clientTop\+panel\.clientHeight-sticky-box\.offsetHeight/.test(c), "the band ends at the box");
  ok(/h<=room-16 \? bandTop\+\(room-h\)\/2 : bandTop\+8/.test(c), "centred when it fits, top-first when it does not");
  ok(/prefers-reduced-motion: reduce/.test(c), "and no smooth scroll for anyone who asked for less motion");
});

test("Backup & Saves: copies live in IndexedDB, and every reset or load can be undone", () => {
  const eng = slice("// ---------------- Saves: automatic backups", "function getMeta(laneMeta, lane){");
  ok(/indexedDB\.open\(SNAP_DB, 1\)/.test(eng), "copies go to IndexedDB, not the 5 MB localStorage the board itself lives in");
  ok(!/localStorage\.setItem/.test(eng), "the engine never writes localStorage directly - it is handed a storage");
  ok(/new CompressionStream\("deflate-raw"\)/.test(eng) && /enc:"none", data:str/.test(eng), "compressed where the browser can, plain where it cannot");
  ok(/MULTI-USER HURDLE/.test(eng), "and it carries its multi-user flag");
  const then = slice("function snapThenReload(why, write, setMsg){", "function SnapTierSheet(props){");
  ok(then.indexOf("write(ttDb.backend())") > 0 && then.indexOf("snapTake(why)") < then.indexOf("write(ttDb.backend())"),
    "a reset or load takes its backup BEFORE it writes - through the store's doorway");
  ok(/could not take a backup first, so nothing was changed/i.test(then), "and writes nothing if that backup fails");
  ok(/snapThenReload\("before-reset"/.test(s) && /snapThenReload\("before-load"/.test(s), "both go through it");
  has(/if\(!testMode\) snapAfterClockOut\.current=true;/, "clock-out asks for the day's backup - never on the practice board");
  has(/snapTake\("clockout"\)/, "and takes it once the clock-out is written");
  has(/if\(load\("tt_session",\{\}\)\.atWorkStart\) return;/, "opening the app never backs up mid-shift");
  has(/if\(!n \|\| Date\.now\(\)-n\.at > DAY_MS\) return snapTake\("open"\);/, "but does when the newest copy is over a day old");
  const bm = slice("function BackupModal(props){", "function snapThenReload(");
  ok(/if\(staged\) return Promise\.resolve\(\);/.test(bm), "a staged sheet in the manual never touches the copies");
  ok(/"data-resetopen":true, disabled:clocked/.test(bm) && /"data-snapload":"latest", disabled:clocked/.test(bm), "nothing loads or resets while the clock runs");
  has(/BackupModal, \{ clocked:!!atWorkStart,/, "the sheet is told");
  ok(/HoldButton, \{ onHold:function\(\)\{ delSave\(r\.id\); \}/.test(bm), "deleting a save is held");
});

test("Day Summary lists the project tree, each job once", () => {
  const ds = slice("function DaySummary(props){", "function ReportsModal(props){");
  ok(/daySummaryTree\(projectLogs, props\.projects\)/.test(ds), "the listing comes from the tree");
  ok(!/Object\.values\(byProject\)\.filter\(function\(c\)\{ return c\.parentId; \}\)/.test(s), "the loop that printed every nested job under every parent is gone");
  has(/dayKey:todayStr2, projects:projects, onClose/, "the board hands it the projects");
  has(/DaySummary, \{ dayKey:yday, testMode:true, onClose:nop, projects:TEST_PROJECTS,/, "and so does the manual's picture");
});

test("the manual is by topic, with a pinned search on every page", () => {
  const idx = slice("var HELP_INDEX = [", "function helpEntry(");
  ok(/topic:"Time Settings"/.test(idx) && /\["picture","paywork"\]/.test(idx) && /\["guide","setpay"\]/.test(idx), "Time Settings is a topic holding its pictures and guides");
  const docs = slice("function helpSearchDocs(){", "function helpSearch(q){");
  ok(/A=helpAll\(\)/.test(docs) && /Object\.keys\(A\.pictures\)/.test(docs) && /Object\.keys\(A\.guides\)/.test(docs), "search reads the registries (core and enabled modules), so new help is searchable at once");
  ok(/pic\.parts\.forEach/.test(docs) && /g\.steps\.forEach/.test(docs), "every part and every step, not just titles");
  const bar = slice("function HelpSearchBar(props){", "function HelpSearchResults(props){");
  ok(/position:"sticky", top:top\+"px"/.test(bar), "the search is pinned");
  ok(/bar\.offsetHeight-HELP_BAR_OVERHANG/.test(bar), "just under the action bar");
  eq(count(/props\.setQuery \? React\.createElement\(HelpSearchBar, props\) : null/g), 2, "the walk (pictures and guides) and the practice page carry it");
  has(/React\.createElement\(HelpSearchBar, search\),/, "and so does the index");
  has(/var pick=function\(d\)\{ setQuery\(""\); setView\(\{ kind:d\.kind, id:d\.id, start:d\.at/, "a hit opens its page at that part or step");
  has(/var onS=useState\(Math\.min\(props\.start\|\|0, n-1\)\);/, "a picture can open on any part, and a guide on any step");
});

test("pictures and guides are one page: the walk", () => {
  const pic = slice("function HelpPicture(props){", "function HelpSteps(props){");
  const st = slice("function HelpSteps(props){", "\nfunction ");
  ok(/React\.createElement\(HelpWalk, /.test(pic) && /React\.createElement\(HelpWalk, /.test(st), "both draw through HelpWalk, so they cannot drift apart");
  const w = slice("function HelpWalk(props){", "function HelpPicture(props){");
  ok(/helpStageKey\(it\.stage\)===curKey/.test(w), "a guide numbers every step that shares the stage on show");
  ok(/key:curKey/.test(w), "and swaps the stage when a step moves to another screen");
  ok(/if\(moved && !wantScroll\.current\) wantScroll\.current="open";/.test(w), "bringing the new step into view once it has measured");
  ok(/done:guide && i<on/.test(w), "steps already passed show as done on the chips");
});

test("every manual view keeps its hooks at the top", () => {
  ["function GuidesModal(props){", "function HelpWalk(props){", "function HelpPicture(props){", "function HelpSteps(props){",
   "function HelpTryHold(){", "function HelpStage(props){"].forEach((f) => {
    const body = s.slice(s.indexOf(f), s.indexOf("\nfunction ", s.indexOf(f) + 10));
    // Only a return at the component's own level counts; one inside a
    // callback (a .map, an effect) is not an early exit.
    const m = body.match(/\n  (?:if\([^\n]*\) )?return /);
    const firstReturn = m ? m.index : body.length;
    const lastHook = Math.max(body.lastIndexOf("useState("), body.lastIndexOf("useEffect("), body.lastIndexOf("useRef("));
    ok(lastHook < firstReturn, f.slice(9, f.indexOf("(")) + " declares every hook before its first return");
  });
});
})();

// ---- run --------------------------------------------------------------------
console.log("");
const bad = syntaxCheck();
const r = report("suites     ");
console.log(bad || r.fail ? "\nFAILED\n" : "\nall green\n");
process.exit(bad || r.fail ? 1 : 0);
