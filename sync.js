// sync.js - personal sync (11-13): two devices and a stand-in server.
//   node sync.js /tmp/app_only.js
// The stand-in server is written HERE, from the rules in db/04_personal.sql,
// not from the app's code - so the app's merge and the server's are checked
// against each other rather than against themselves.
const fs = require("fs");
const React = require("react");
const src = fs.readFileSync(process.argv[2] || "/tmp/app_only.js", "utf8");
const win = { addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; } };
const navigator = { vibrate(){}, onLine: true };
const document = { addEventListener(){}, removeEventListener(){}, getElementById: () => null, hidden: false };
const gmem = new Map();
const localStorage = { get length(){ return gmem.size; }, key: (i) => Array.from(gmem.keys())[i],
  getItem: (k) => (gmem.has(k) ? gmem.get(k) : null), setItem: (k, v) => gmem.set(k, String(v)), removeItem: (k) => gmem.delete(k) };
const X = new Function("React", "window", "localStorage", "navigator", "document",
  src + "\nreturn { plan: ttSyncPlan, normPrefs: ttSyncNormPrefs, make: ttSyncMake, merge: ttSyncMerge, items: ttSyncItemsOf, kind: ttSyncKind, hash: ttFieldHash, LOOK: TT_SYNC_LOOK, snapIds: snapIdsFor, WHY: SNAP_WHY };")(React, win, localStorage, navigator, document);

const res = []; const t = (l, p) => res.push([l, !!p]);

// ---------------- the stand-in server ----------------
function Server(){
  const rows = new Map(); let clock = 1000000; let up = true; const log = [];
  // jsonb keeps object keys in its own order (shorter first, then by bytes),
  // not the order they were sent in - the real database does this, so must we.
  function jb(v){
    if (Array.isArray(v)) return v.map(jb);
    if (v && typeof v === "object") { const o = {}; Object.keys(v).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).forEach((k) => { o[k] = jb(v[k]); }); return o; }
    return v;
  }
  function merge(old, it){
    const f = Object.assign({}, old ? old.fields : {}), ts = Object.assign({}, old ? old.field_ts : {});
    for (const k of Object.keys(it.field_ts || {})) {
      const t1 = +it.field_ts[k];
      if (ts[k] == null || t1 > +ts[k]) { ts[k] = t1; if (k in (it.fields || {})) f[k] = it.fields[k]; else delete f[k]; }
    }
    let del = Math.max(old && old.del_ts || 0, +it.del_ts || 0) || null;
    const latest = Math.max(0, ...Object.values(ts).map(Number));
    if (del && latest > del) del = null;
    return { fields: f, field_ts: ts, del_ts: del };
  }
  function pushOne(user, it){
    const key = user + "|" + it.coll + "|" + it.item_id, old = rows.get(key), m = merge(old, it);
    if (!old || JSON.stringify(jb([old.fields, old.field_ts, old.del_ts])) !== JSON.stringify(jb([m.fields, m.field_ts, m.del_ts]))) {
      rows.set(key, Object.assign({ user, coll: it.coll, item_id: it.item_id }, { fields: jb(m.fields), field_ts: jb(m.field_ts), del_ts: m.del_ts }, { updated_at: clock })); return 1;
    }
    return 0;
  }
  const api = {
    rows, log, setUp(v){ up = v; }, tick(ms){ clock += ms || 1; },
    handle(user, method, path, body){
      log.push(method + " " + path.split("?")[0]);
      if (!up) return { status: 0, body: null };
      if (!user) return { status: 401, body: null };
      api.tick(1);
      if (method === "POST" && path === "/rest/v1/rpc/personal_push") {
        if (!Array.isArray(body.items) || body.items.length > 500) return { status: 400, body: { message: "too many" } };
        let n = 0; body.items.forEach((it) => { n += pushOne(user, it); }); return { status: 200, body: n };
      }
      if (method === "POST" && path === "/rest/v1/rpc/personal_replace") {
        for (const [k, r] of rows) if (r.user === user && (r.del_ts == null || r.del_ts < body.at_ms)) rows.set(k, Object.assign({}, r, { del_ts: Math.max(r.del_ts || 0, body.at_ms), updated_at: clock }));
        let n = 0; body.items.forEach((it) => { n += pushOne(user, it); }); return { status: 200, body: n };
      }
      if (method === "POST" && path === "/rest/v1/rpc/personal_summary") {
        const mine = [...rows.values()].filter((r) => r.user === user);
        const last = mine.reduce((m, r) => Math.max(m, r.updated_at), 0);
        return { status: 200, body: { projects: mine.filter((r) => r.coll === "projects" && r.del_ts == null).length,
          logs: mine.filter((r) => r.coll === "logs" && r.del_ts == null).length, last: last ? new Date(last).toISOString() : null } };
      }
      if (method === "POST" && path === "/rest/v1/rpc/personal_clock") {
        let mx = 0; for (const r of rows.values()) if (r.user === user) mx = Math.max(mx, r.del_ts || 0, ...Object.values(r.field_ts).map(Number));
        return { status: 200, body: mx };
      }
      if (method === "GET" && path.indexOf("/rest/v1/personal_items?") === 0) {
        const q = new URLSearchParams(path.split("?")[1]);
        let list = [...rows.values()].filter((r) => r.user === user);
        const gte = q.get("updated_at"); if (gte) { const ms = Date.parse(gte.replace(/^gte\./, "")); list = list.filter((r) => r.updated_at >= ms); }
        if (q.get("del_ts") === "is.null") list = list.filter((r) => r.del_ts == null);
        list.sort((a, b) => a.updated_at - b.updated_at || (a.coll < b.coll ? -1 : a.coll > b.coll ? 1 : 0) || (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));
        const off = +(q.get("offset") || 0), lim = +(q.get("limit") || 1000);
        list = list.slice(off, off + lim).map((r) => ({ coll: r.coll, item_id: r.item_id, fields: r.fields, field_ts: r.field_ts, del_ts: r.del_ts, updated_at: new Date(r.updated_at).toISOString() }));
        return { status: 200, body: list };
      }
      return { status: 404, body: null };
    }
  };
  return api;
}
// ---------------- a device ----------------
function Device(server, user, seed){
  const mem = new Map(Object.entries(seed || {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  let clock = 50000, phase = "in", who = user; const activity = []; const applied = []; const snaps = [];
  const store = { get: (k) => (mem.has(k) ? mem.get(k) : null), set: (k, v) => mem.set(k, v), remove: (k) => mem.delete(k), keys: () => [...mem.keys()] };
  const cloud = {
    request: (m, p, b) => Promise.resolve(server.handle(who, m, p, b ? JSON.parse(JSON.stringify(b)) : b)),
    activity: (n) => activity.push(n), user: () => who, get: () => ({ phase })
  };
  const timers = []; let netType = "other";
  const eng = X.make({ cloud, store, now: () => clock, network: () => netType,
    setTimeout: (fn, d) => { timers.push({ fn, d, live: true }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].live = false; },
    onApplied: (keys) => applied.push(keys.slice().sort().join(",")), snapshot: (why) => { snaps.push(why); return Promise.resolve(); } });
  const d = {
    eng, mem, activity, applied, snaps,
    get: (k) => { const v = mem.get(k); return v == null ? null : JSON.parse(v); },
    // a write through the app's doorway: the store changes, and sync is told
    put: (k, v) => { mem.set(k, JSON.stringify(v)); eng.note(k); },
    tick: (ms) => { clock += ms || 1; }, at: () => clock,
    settle: () => eng._settle(),
    signOut: () => { phase = "out"; }, switchTo: (u) => { who = u; },
    // the timers the engine has set and not cancelled, by what they're for
    pending: () => timers.filter((x) => x.live).map((x) => x.d),
    setNet: (n) => { netType = n; },
  };
  return d;
}
const look = { layout: "comfortable", tracking: "timer", colorScheme: "bright-pastels", theme: "neon-dream", schemes: {}, fonts: {}, mode: "dark", handedness: "right", headerPos: "top" };
const sched = { mon: { on: true, start: "06:00", end: "14:30" } };
function board(prefix, n){
  return {
    tt_projects: Array.from({ length: n || 2 }, (_, i) => ({ id: prefix + (i + 1), name: prefix + " project " + (i + 1), lane: "Jobs", order: i, updatedAt: 1000 + i })),
    tt_logs: [{ id: prefix + "L1", type: "project", projectId: prefix + "1", startTime: 1, endTime: 2, duration: 1 }],
    tt_settings: Object.assign({}, look, { workSchedule: sched, timeInc: "minutes" }),
    tt_laneorder: ["Jobs"], tt_lanemeta: { Jobs: { color: "blue" } },
    tt_cardcollapse: { [prefix + "1"]: true }, tt_testmode: "false"
  };
}
function names(d){ return (d.get("tt_projects") || []).map((p) => p.name).sort().join(" | "); }

(async () => {
  // ---------------- pure parts ----------------
  t("the look stays on the device: settings travel without it",
    (() => { const f = X.items("tt_settings", Object.assign({}, look, { workSchedule: sched }))["keys|tt_settings"]; return X.LOOK.every((k) => !(k in f)) && f.workSchedule; })());
  t("folded cards, the practice board, reminder lists and sign-in stay put",
    ["tt_cardcollapse", "tt_lanecollapse", "tt_testmode", "tt_test_projects", "tt_remind_away", "tt_remind_last", "ttacct_session", "tt_gone", "ttsync_meta"].every((k) => X.kind(k) === null));
  t("the board, settings, lanes, the clock and module data travel",
    ["tt_projects", "tt_logs", "tt_disruptions", "tt_breaks", "tt_settings", "tt_laneorder", "tt_lanemeta", "tt_session", "tt_remind_fired", "tt_mod_toolroom_items", "tt_mod_tool-tracker_tools"].every((k) => X.kind(k)));
  t("a module key must look like one", X.kind("tt_mod_../../x") === null);
  t("records are keyed by collection and id, without their local change stamp",
    (() => { const it = X.items("tt_projects", [{ id: 7, name: "A", updatedAt: 5 }]); return it["projects|7"] && !("updatedAt" in it["projects|7"]); })());
  let m = X.merge({ a: 1, b: 2 }, { f: { a: [10, X.hash(1)], b: [10, X.hash(2)] }, del: null }, { fields: { a: 9 }, field_ts: { a: 20, b: 5 } });
  t("merge: a later field wins, an older one doesn't", m.fields.a === 9 && m.fields.b === 2 && m.changed);
  m = X.merge({ a: 1 }, { f: { a: [10, X.hash(1)] } }, { fields: {}, field_ts: { a: 20 } });
  t("merge: a field cleared later is cleared", !("a" in m.fields));
  m = X.merge({ a: 1 }, { f: { a: [10, X.hash(1)] } }, { fields: { a: 2 }, field_ts: { a: 10 } });
  t("merge: on a tie the server's copy wins, so every device ends the same", m.fields.a === 2);
  m = X.merge({ a: 1 }, { f: { a: [10, X.hash(1)] } }, { fields: { a: 1 }, field_ts: { a: 10 } });
  t("merge: the same thing again changes nothing", !m.changed);
  m = X.merge({ a: 1 }, { f: { a: [10, X.hash(1)] } }, { fields: {}, field_ts: {}, del_ts: 15 });
  t("merge: a deletion after the last edit removes it", !m.alive);
  m = X.merge({ a: 1 }, { f: { a: [20, X.hash(1)] } }, { fields: {}, field_ts: {}, del_ts: 15 });
  t("merge: an edit after the deletion keeps it", m.alive);
  m = X.merge(null, null, { fields: { a: 1 }, field_ts: { a: 5 }, del_ts: 5 });
  t("merge: an edit at the very moment of deletion leaves it gone", !m.alive);
  t("snapshots: Before sync is its own copy that never overwrites the day's", X.snapIds("before-sync", 5, "mon").some((x) => x.kind === "daily" && /-5$/.test(x.id)) && X.WHY["before-sync"] === "Before sync");

  // ---------------- the first device ----------------
  const S = Server();
  const A = Device(S, "u1", board("A"));
  let pr = await A.eng.probe();
  t("an empty account says so", pr.ok && pr.has === false);
  let r = await A.eng.link("device");
  t("the first device goes up", r.ok && A.eng.status().on && [...S.rows.values()].filter((x) => x.coll === "projects").length === 2);
  t("its settings went up without the look", (() => { const row = S.rows.get("u1|keys|tt_settings"); return row && row.fields.workSchedule && !("theme" in row.fields); })());
  t("folded cards did not go up", ![...S.rows.keys()].some((k) => /cardcollapse|testmode/.test(k)));
  t("the badge was told: busy, then fine", A.activity.indexOf("busy") >= 0 && A.activity[A.activity.length - 1] === "ok");

  // ---------------- the second device: take the account's board ----------------
  const B = Device(S, "u1", Object.assign(board("B", 1), { tt_settings: Object.assign({}, look, { theme: "paper", mode: "light", workSchedule: { mon: { on: false } } }) }));
  pr = await B.eng.probe();
  t("the second device sees the account already holds a board", pr.ok && pr.has === true);
  r = await B.eng.link("account");
  t("Use the account's board: this device now has the account's projects", r.ok && names(B) === "A project 1 | A project 2");
  t("and its own are gone (a Before sync copy was taken first)", !names(B).includes("B project") && B.snaps.includes("before-sync"));
  t("its look stayed its own", B.get("tt_settings").theme === "paper" && B.get("tt_settings").mode === "light");
  t("the schedule came from the account", B.get("tt_settings").workSchedule.mon.on === true);
  t("folded cards stayed as they were on this device", B.get("tt_cardcollapse").B1 === true);

  // ---------------- an edit travels ----------------
  A.tick(1000);
  A.put("tt_projects", A.get("tt_projects").map((p) => (p.id === "A1" ? Object.assign({}, p, { name: "Deck rebuild" }) : p)));
  A.settle();
  t("an edit queues one record, not the board", A.eng.status().waiting === 1);
  await A.eng.sync();
  t("and goes up", A.eng.status().waiting === 0 && S.rows.get("u1|projects|A1").fields.name === "Deck rebuild");
  await B.eng.sync();
  t("the other device gets it", names(B).includes("Deck rebuild"));
  t("and is told which part of the board changed", B.applied[B.applied.length - 1] === "tt_projects");

  // ---------------- offline on both, different fields ----------------
  S.setUp(false);
  A.tick(1000); B.tick(2000);
  A.put("tt_projects", A.get("tt_projects").map((p) => (p.id === "A2" ? Object.assign({}, p, { name: "Renamed on A" }) : p))); A.settle();
  B.put("tt_projects", B.get("tt_projects").map((p) => (p.id === "A2" ? Object.assign({}, p, { lane: "Outside" }) : p))); B.settle();
  r = await A.eng.sync();
  t("offline: nothing is lost, it waits", r === false && A.eng.status().waiting === 1 && A.activity[A.activity.length - 1] === "offline");
  S.setUp(true);
  await A.eng.sync(); await B.eng.sync(); await A.eng.sync();
  const a2 = (d) => d.get("tt_projects").find((p) => p.id === "A2");
  t("back online: a rename on one and a lane change on the other - both kept, on both",
    a2(A).name === "Renamed on A" && a2(A).lane === "Outside" && a2(B).name === "Renamed on A" && a2(B).lane === "Outside");

  // ---------------- the same field: later wins ----------------
  A.tick(10); A.put("tt_projects", A.get("tt_projects").map((p) => (p.id === "A2" ? Object.assign({}, p, { name: "Earlier" }) : p))); A.settle();
  B.tick(5000); B.put("tt_projects", B.get("tt_projects").map((p) => (p.id === "A2" ? Object.assign({}, p, { name: "Later" }) : p))); B.settle();
  await B.eng.sync(); await A.eng.sync(); await B.eng.sync();
  t("the same field edited on both: the later edit wins everywhere, whichever arrives first", a2(A).name === "Later" && a2(B).name === "Later");

  // ---------------- deletion ----------------
  A.tick(100000); B.tick(1);
  A.put("tt_projects", A.get("tt_projects").filter((p) => p.id !== "A1")); A.settle();
  await A.eng.sync(); await B.eng.sync();
  t("a project deleted on one device goes from the other", !B.get("tt_projects").some((p) => p.id === "A1"));
  t("a deletion goes up as a time only, never blanking the record", S.rows.get("u1|projects|A1").fields.name === "Deck rebuild" && S.rows.get("u1|projects|A1").del_ts > 0);
  // B had an older offline edit to A1? it can't: A1 is gone on B. A record deleted on B but edited later on A comes back:
  B.tick(10); B.put("tt_logs", []); B.settle();
  await B.eng.sync();
  A.tick(400000); A.put("tt_logs", [{ id: "AL1", type: "project", projectId: "A2", startTime: 1, endTime: 9, duration: 8 }]); A.settle();
  await A.eng.sync(); await B.eng.sync();
  t("a record deleted on one device but edited later on the other comes back", B.get("tt_logs").some((l) => l.id === "AL1" && l.duration === 8));

  // ---------------- a field taken away ----------------
  A.tick(1000);
  A.put("tt_projects", A.get("tt_projects").map((p) => { if (p.id !== "A2") return p; const c = Object.assign({}, p); delete c.lane; return c; })); A.settle();
  await A.eng.sync(); await B.eng.sync();
  t("a field removed on one device is removed on the other", !("lane" in a2(B)) && a2(B).name === "Later");

  // ---------------- an edit while a push is on its way ----------------
  A.tick(1000);
  A.put("tt_projects", A.get("tt_projects").map((p) => (p.id === "A2" ? Object.assign({}, p, { order: 7 }) : p))); A.settle();
  const flying = A.eng.sync();
  A.tick(10); A.put("tt_projects", A.get("tt_projects").map((p) => (p.id === "A2" ? Object.assign({}, p, { order: 8 }) : p))); A.settle();
  await flying;
  t("an edit made while a push is on its way is not lost: it follows straight after", S.rows.get("u1|projects|A2").fields.order === 8 && A.eng.status().waiting === 0);
  await B.eng.sync();
  t("and reaches the other device", a2(B).order === 8);

  // ---------------- edited, then deleted, before it went up ----------------
  A.tick(1000);
  A.put("tt_logs", (A.get("tt_logs") || []).concat([{ id: "AL9", type: "project", projectId: "A2", startTime: 5, endTime: 6, duration: 1 }])); A.settle();
  await A.eng.sync();
  A.tick(1000); A.put("tt_logs", A.get("tt_logs").map((l) => (l.id === "AL9" ? Object.assign({}, l, { duration: 3 }) : l))); A.settle();
  A.tick(1000); A.put("tt_logs", A.get("tt_logs").filter((l) => l.id !== "AL9")); A.settle();
  await A.eng.sync();
  t("edited then deleted before it went up: the server keeps the record's fields, marked gone", S.rows.get("u1|logs|AL9").del_ts > 0 && S.rows.get("u1|logs|AL9").fields.type === "project" && S.rows.get("u1|logs|AL9").fields.duration === 1);

  // ---------------- a change that landed late ----------------
  const cur = B.eng._state().cursor;
  S.rows.set("u1|logs|late1", { user: "u1", coll: "logs", item_id: "late1", fields: { id: "late1", type: "project", duration: 4 }, field_ts: { id: 1, type: 1, duration: 1 }, del_ts: null, updated_at: cur - 10000 });
  await B.eng.sync();
  t("a change the server stamped a little before the last pull is still picked up", B.get("tt_logs").some((l) => l.id === "late1"));
  S.rows.delete("u1|logs|late1");

  // ---------------- settings ----------------
  A.tick(1000);
  A.put("tt_settings", Object.assign({}, A.get("tt_settings"), { theme: "forest" })); A.settle();
  t("changing the look queues nothing", A.eng.status().waiting === 0);
  A.put("tt_settings", Object.assign({}, A.get("tt_settings"), { timeInc: "tenths" })); A.settle();
  await A.eng.sync(); await B.eng.sync();
  t("a real setting travels; the other device's look stays its own", B.get("tt_settings").timeInc === "tenths" && B.get("tt_settings").theme === "paper" && A.get("tt_settings").theme === "forest");

  // ---------------- the server can only touch what syncs ----------------
  S.rows.set("u1|keys|ttacct_session", { user: "u1", coll: "keys", item_id: "ttacct_session", fields: { v: "stolen" }, field_ts: { v: 9e15 }, del_ts: null, updated_at: 9e12 });
  S.rows.set("u1|keys|tt_testmode", { user: "u1", coll: "keys", item_id: "tt_testmode", fields: { v: true }, field_ts: { v: 9e15 }, del_ts: null, updated_at: 9e12 });
  S.rows.set("u1|keys|tt_projects", { user: "u1", coll: "keys", item_id: "tt_projects", fields: { v: [] }, field_ts: { v: 9e15 }, del_ts: null, updated_at: 9e12 });
  await B.eng.sync();
  t("a row naming a key this app doesn't sync is ignored", B.get("ttacct_session") === null && B.get("tt_testmode") === false && B.get("tt_projects").length > 0);
  ["ttacct_session", "tt_testmode", "tt_projects"].forEach((k) => S.rows.delete("u1|keys|" + k));

  // ---------------- writes that skip the doorway ----------------
  const C = Device(S, "u1", board("C", 1));
  await C.eng.link("account");
  C.mem.set("tt_breaks", JSON.stringify([{ id: "restored", label: "Lunch", startTime: 1, endTime: 2 }]));   // a restore writes storage directly
  C.tick(50);
  t("on start, anything written while closed is found and queued", C.eng.boot() > 0 && C.eng.status().waiting > 0);
  await C.eng.sync(); await A.eng.sync();
  t("and reaches the other devices", A.get("tt_breaks").some((b) => b.id === "restored"));

  // ---------------- combine both ----------------
  const S2 = Server();
  const P = Device(S2, "u2", board("P", 2)); await P.eng.link("device");
  const Q = Device(S2, "u2", board("Q", 1));
  r = await Q.eng.link("combine");
  await P.eng.sync();
  t("Combine both: every project from both boards, on both", r.ok && names(Q) === "P project 1 | P project 2 | Q project 1" && names(P) === names(Q));
  t("combine takes a Before sync copy too", Q.snaps.includes("before-sync"));
  // Q goes off, P renames a project, Q (still holding its older copy) combines again
  Q.eng.off();
  P.tick(5000); P.put("tt_projects", P.get("tt_projects").map((p) => (p.id === "P1" ? Object.assign({}, p, { name: "P renamed" }) : p))); P.settle(); await P.eng.sync();
  Q.tick(9000000);
  r = await Q.eng.link("combine");
  t("combine: where both have the same record, the newer change wins (not this device just because it's later)", r.ok && names(Q).includes("P renamed"));

  // ---------------- use this device's board ----------------
  const R = Device(S2, "u2", board("R", 1));
  r = await R.eng.link("device");
  await P.eng.sync(); await Q.eng.sync();
  t("Use this device's board: the account now holds only it", r.ok && names(P) === "R project 1" && names(Q) === "R project 1");
  t("and its look still stays per device", P.get("tt_settings").theme === "neon-dream");

  // ---------------- the counts for "your account already has a board" ----------------
  let sm = await P.eng.summary();
  t("the account's counts: projects and time entries alive, and when it changed", sm.ok && sm.projects === 1 && sm.logs === 1 && sm.last > 0);
  const ls = P.eng.localSummary();
  t("and this device's, counted the same way", ls.projects === 1 && ls.logs === 1);

  // ---------------- shared projects stay out (ahead of sharing, 11-14) ----------------
  const S5 = Server();
  const G = Device(S5, "u6", { tt_projects: [
    { id: "g1", name: "Mine", lane: "Jobs" },
    { id: "g2", name: "Team job", lane: "Jobs", shareId: "abc" },
    { id: "g3", name: "Task under it", lane: "Jobs", parentId: "g2" },
    { id: "g4", name: "Task under the task", lane: "Jobs", parentId: "g3" } ], tt_settings: look });
  await G.eng.link("device");
  t("a shared project and everything under it never go to personal sync",
    !!S5.rows.get("u6|projects|g1") && !S5.rows.get("u6|projects|g2") && !S5.rows.get("u6|projects|g3") && !S5.rows.get("u6|projects|g4"));
  G.tick(1000); G.put("tt_projects", G.get("tt_projects").map((p) => (p.id === "g1" ? Object.assign({}, p, { shareId: "def" }) : p))); G.settle();
  await G.eng.sync();
  t("a project that becomes shared leaves personal sync (marked gone there, still on the device)",
    S5.rows.get("u6|projects|g1").del_ts > 0 && G.get("tt_projects").some((p) => p.id === "g1"));
  const H = Device(S5, "u6", { tt_projects: [{ id: "g1", name: "Mine, older copy", lane: "Jobs" }, { id: "g2", name: "Team job here", lane: "Jobs", shareId: "abc" }] });
  S5.rows.set("u6|projects|g2", { user: "u6", coll: "projects", item_id: "g2", fields: { id: "g2", name: "stale private copy" }, field_ts: { id: 1, name: 9e15 }, del_ts: null, updated_at: Date.now() });
  await H.eng.link("combine");
  t("a server row for a project this device has as shared never touches it", H.get("tt_projects").find((p) => p.id === "g2").name === "Team job here" && H.get("tt_projects").find((p) => p.id === "g2").shareId === "abc");
  t("and the shared project is never dropped while the rest is applied", H.get("tt_projects").filter((p) => p.id === "g2").length === 1);
  S5.rows.delete("u6|projects|g2");   // the planted stale copy has done its job
  const K = Device(S5, "u6", { tt_projects: [{ id: "k1", name: "Old private", lane: "Jobs" }, { id: "k2", name: "Shared here", lane: "Jobs", shareId: "x" }, { id: "k3", name: "Its task", lane: "Jobs", parentId: "k2" }] });
  await K.eng.link("account");
  t("Use the account's board replaces the private board but keeps shared projects and their tasks",
    !K.get("tt_projects").some((p) => p.id === "k1") && K.get("tt_projects").some((p) => p.id === "k2") && K.get("tt_projects").some((p) => p.id === "k3") && K.get("tt_projects").length === 2);

  // ---------------- clocks that disagree ----------------
  const S4 = Server();
  const Fast = Device(S4, "u5", board("F", 2)); Fast.tick(10 * 3600000); await Fast.eng.link("device");   // this phone's clock is 10 hours ahead
  const Slow = Device(S4, "u5", board("S", 1));
  r = await Slow.eng.link("device");
  await Fast.eng.sync();
  t("Use this device's board works even from a device whose clock runs behind", r.ok && names(Fast) === "S project 1" && names(Slow) === "S project 1");

  // ---------------- the loop found live on 1.5.2 (11-17) ----------------
  // The database rearranges object keys. The app writes its settings back in
  // its own order after every pull. That must not count as a change.
  const SL = Server();
  const appOrder = () => ({ workSchedule: { mon: { on: true, start: "06:00", end: "14:30" }, tue: { on: true, start: "06:00", end: "14:30" }, sat: { on: false, start: "", end: "" } },
    timeInc: "minutes", notifs: { before: 5, missed: true } });
  const LA = Device(SL, "u9", { tt_settings: Object.assign({}, look, appOrder()) }); await LA.eng.link("device");
  const LB = Device(SL, "u9", { tt_settings: Object.assign({}, look) }); await LB.eng.link("account");
  t("the server hands settings back in its own key order (as the real database does)",
    Object.keys(SL.rows.get("u9|keys|tt_settings").fields.workSchedule).join() !== "mon,tue,sat");
  // what the App does after a pull: normalize and save in its own order
  LB.put("tt_settings", Object.assign({}, look, appOrder())); LB.settle();
  t("writing the same settings back in a different order is not a change", LB.eng.status().waiting === 0);
  LA.put("tt_settings", Object.assign({}, look, appOrder())); LA.settle();
  const before = SL.log.length;
  await LA.eng.sync(); await LB.eng.sync(); await LA.eng.sync(); await LB.eng.sync();
  t("so a quiet pair of devices sends nothing back and forth", SL.log.slice(before).filter((x) => /personal_push/.test(x)).length === 0);
  LA.tick(5000); LA.put("tt_settings", Object.assign({}, look, appOrder(), { timeInc: "tenths" })); LA.settle();
  t("while a real change still goes up", LA.eng.status().waiting === 1);

  // ---------------- how often (11-17) ----------------
  const P0 = { now: 0, lastChange: 0 };
  t("Right away: changes up in seconds, a check every minute", JSON.stringify(X.plan("now", P0)) === JSON.stringify({ push: 2000, pull: 60000 }));
  t("Smart, quiet: changes up in seconds, a check every 15 minutes", JSON.stringify(X.plan("smart", { now: 3600000, lastChange: 0 })) === JSON.stringify({ push: 2000, pull: 900000 }));
  t("Smart, busy (a change in the last 10 minutes): a check every minute", X.plan("smart", { now: 3600000, lastChange: 3600000 - 9 * 60000 }).pull === 60000);
  t("Smart slows again once it has been quiet for 10 minutes", X.plan("smart", { now: 3600000, lastChange: 3600000 - 11 * 60000 }).pull === 900000);
  t("Every 15 minutes: nothing sent on its own; sent with the check, four times an hour", JSON.stringify(X.plan("q15", P0)) === JSON.stringify({ push: null, pull: 900000 }));
  t("On app open: nothing on its own at all", JSON.stringify(X.plan("open", P0)) === JSON.stringify({ push: null, pull: null }));
  t("the choice is stored per network - Wi-Fi, mobile, other - Smart to start",
    JSON.stringify(X.normPrefs(null)) === '{"wifi":"smart","cell":"smart","other":"smart"}' && X.normPrefs({ wifi: "now", cell: "bogus" }).cell === "smart");
  t("how often never travels between devices, and isn't in backups", X.kind("ttsync_prefs") === null);

  const S6 = Server();
  const R1 = Device(S6, "u7", board("R", 1)); await R1.eng.link("device");
  t("a device starts on Smart", R1.eng.rate() === "smart" && R1.eng.status().rate === "smart");
  R1.eng.setRate("open");
  t("the web sets all three networks at once", JSON.stringify(R1.eng.prefs()) === '{"wifi":"open","cell":"open","other":"open"}' && R1.get("ttsync_prefs").cell === "open");
  t("On app open: no check is waiting to fire", R1.pending().length === 0);
  R1.tick(1000); R1.put("tt_projects", R1.get("tt_projects").map((p) => Object.assign({}, p, { name: "Quiet edit" }))); R1.settle();
  t("On app open: an edit waits, nothing set to send it", R1.eng.status().waiting === 1 && R1.pending().length === 0);
  await R1.eng.wake();
  t("opening the app (or coming back to it) sends it", R1.eng.status().waiting === 0 && S6.rows.get("u7|projects|R1").fields.name === "Quiet edit");
  R1.eng.setRate("q15");
  R1.tick(1000); R1.put("tt_projects", R1.get("tt_projects").map((p) => Object.assign({}, p, { name: "Q edit" }))); R1.settle();
  t("Every 15 minutes: the edit waits for the check; the only timer is the 15-minute one", R1.eng.status().waiting === 1 && R1.pending().every((d) => d === 900000) && R1.pending().length >= 1);
  R1.eng.setRate("now");
  t("Right away: switching to it sends what's waiting in seconds", R1.pending().includes(2000));
  R1.eng.setRate("smart", "cell"); R1.setNet("cell");
  t("a rule for one network (the native app's future) is honoured when on that network", R1.eng.rate() === "smart" && R1.eng.prefs().wifi === "now");
  R1.setNet("other");
  const by = R1.eng.bytes();
  t("bytes are counted per month on this device", by.n > 0 && by.sent > 0 && by.recv > 0 && /^\d{4}-\d{2}$/.test(by.month));
  t("and per network", by.by.other && by.by.other.sent > 0);
  t("the count never travels either", ![...S6.rows.keys()].some((k) => /ttsync/.test(k)));

  // ---------------- a big board ----------------
  const big = board("Z", 3); big.tt_logs = Array.from({ length: 1234 }, (_, i) => ({ id: "z" + i, type: "project", projectId: "Z1", startTime: i, endTime: i + 1, duration: 1 }));
  const S3 = Server(); const Z = Device(S3, "u3", big);
  r = await Z.eng.link("device");
  t("a board bigger than one push goes up in parts", r.ok && [...S3.rows.values()].filter((x) => x.coll === "logs").length === 1234 && S3.log.filter((x) => /personal_(push|replace)/.test(x)).length >= 3);
  const Y = Device(S3, "u3", {});
  r = await Y.eng.link("account");
  t("and comes down in pages", r.ok && Y.get("tt_logs").length === 1234);

  // ---------------- whose board ----------------
  const W = Device(S3, "u3", board("W", 1)); await W.eng.link("account");
  W.switchTo("u4");
  r = await W.eng.sync();
  t("someone else signs in on the device: sync turns itself off, nothing crosses accounts", r === false && !W.eng.status().on && ![...S3.rows.values()].some((x) => x.user === "u4"));
  const V = Device(S3, "u3", board("V", 1)); await V.eng.link("account"); V.signOut();
  t("signed out: no round is attempted", (await V.eng.sync()) === false);
  V.eng.off();
  t("off: it stays off", !V.eng.status().on);

  let bad = 0;
  res.forEach(([l, p]) => { if (!p) { bad++; console.log("   x " + l); } });
  console.log("sync       : " + (res.length - bad) + "/" + res.length + " passed" + (bad ? "  FAILED" : ""));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("CRASH", e && e.stack); process.exit(1); });
