// tt-tests.js - the whole static test estate for the Time Tracker in one file.
//   node tt-tests.js [path/to/time-tracker.jsx]
// Four suites: the module contract, a reference module's full lifecycle, the
// host wiring plus the architectural invariants, and the Extensions screen.
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
  "uid", "findProj", "getChildren", "getDescendantIds"
];

// Fresh platform per test: the registry is module-level state, so suites that
// register modules must not leak into each other.
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
    uid: () => "abc1234", findProj: () => null, getChildren: () => [], getDescendantIds: () => [],
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
  ok(tail.indexOf("onClose:function(){ setModScreen(null); }") < 400, "the screen can close itself");
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
test("no modules ship in this build; Extensions is the only new surface", () => {
  eq(count(/TT\.define\(\{/g), 0, "nothing is registered in the app source");
  eq(count(/ttDefineModule\(\{/g), 0, "and nothing bypasses TT.define");
  eq(count(/TT_REGISTRY\.push/g), 1, "the only push is inside ttDefineModule");
  eq(count(/setShowExtensions\(true\)/g), 1, "exactly one way into Extensions");
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
test("still no modules ship, so Extensions is the whole diff", () => {
  eq(count(/TT\.define\(\{/g), 0, "nothing is registered in the app source");
  eq(count(/ttDefineModule\(\{/g), 0, "and nothing bypasses TT.define");
  eq(count(/TT_REGISTRY\.push/g), 1, "the only push is inside ttDefineModule");
});


})();

// ---- run --------------------------------------------------------------------
console.log("");
const bad = syntaxCheck();
const r = report("suites     ");
console.log(bad || r.fail ? "\nFAILED\n" : "\nall green\n");
process.exit(bad || r.fail ? 1 : 0);
