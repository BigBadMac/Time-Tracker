// account.js - the account layer (10-28): email-code sign-in against the
// Supabase sandbox, the badge's five states, and the Account sheet.
//   node account.js /tmp/app_only.js
// The server is never contacted: every request goes to a fake fetch that
// answers the way Supabase Auth and PostgREST do, so each path - good code,
// wrong code, rate limit, server down, offline, a sign-in that ran out - is
// driven on purpose.
const fs = require("fs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const win = { addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; } };
const mem = new Map();
const localStorage = {
  get length(){ return mem.size; }, key: (i) => Array.from(mem.keys())[i],
  getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null),
  setItem: (k, v) => mem.set(String(k), String(v)), removeItem: (k) => mem.delete(String(k)),
};
const navigator = { vibrate(){}, onLine: true };
const document = { addEventListener(){}, removeEventListener(){}, getElementById: () => null };
const src = fs.readFileSync(process.argv[2] || "/tmp/app_only.js", "utf8");
const out = new Function("React", "window", "localStorage", "navigator", "document", "Event",
  src + "\nreturn { make: ttCloudMake, badgeOf: ttCloudBadgeOf, URL: TT_CLOUD_URL, KEY: TT_CLOUD_KEY," +
        " SES: TT_ACCT_SESSION, EM: TT_ACCT_EMAIL, backup: backupBuild, Sheet: AccountModal, Badge: CloudBadge, Glyph: CloudGlyph," +
        " word: accountWord, Ticker: HeaderTicker, help: helpAll, App: App, sheets: HELP_SHEETS, stageW: HELP_STAGE_W };")(React, win, localStorage, navigator, document, function Event(t){ return { type: t }; });

const res = [];
const t = (label, pass) => res.push([label, !!pass]);

// ---- a fake Supabase --------------------------------------------------------
function fakeServer() {
  const S = { calls: [], code: "123456", sendStatus: 200, touch: [], refreshOk: true, down: false, net: true };
  S.fetch = (url, opt) => {
    const path = url.replace(out.URL, ""), body = opt && opt.body ? JSON.parse(opt.body) : {};
    S.calls.push({ path, body, headers: opt.headers });
    if (!S.net) return Promise.reject(new TypeError("Failed to fetch"));
    const reply = (status, b) => Promise.resolve({ status, text: () => Promise.resolve(b == null ? "" : JSON.stringify(b)) });
    if (S.down) return reply(503, { message: "upstream unavailable" });
    if (path === "/auth/v1/otp") return reply(S.sendStatus, S.sendStatus === 429 ? { code: 429, error_code: "over_email_send_rate_limit", msg: "rate" } : {});
    if (path === "/auth/v1/verify") {
      if (body.token !== S.code) return reply(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      return reply(200, { access_token: "A1", refresh_token: "R1", expires_in: 3600, expires_at: Math.floor(S.now() / 1000) + 3600, user: { id: "u-1", email: body.email } });
    }
    if (path.indexOf("/auth/v1/token") === 0) {
      if (!S.refreshOk) return reply(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
      return reply(200, { access_token: "A2", refresh_token: "R2", expires_in: 3600, user: { id: "u-1", email: "brent@example.com" } });
    }
    if (path === "/rest/v1/rpc/touch_active") { const st = S.touch.length ? S.touch.shift() : 204; return reply(st, st === 204 ? null : { message: "x" }); }
    if (path.indexOf("/auth/v1/logout") === 0) return reply(204, null);
    return reply(404, {});
  };
  return S;
}
function memStore() { const m = new Map(); return { m, get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => { m.set(k, v); return true; }, remove: (k) => { m.delete(k); } }; }
function rig(opts) {
  opts = opts || {};
  const S = fakeServer(); let clock = 1_800_000_000_000; S.now = () => clock;
  const store = opts.store || memStore(); const timers = [];
  let online = true;
  const c = out.make({ fetch: S.fetch, store, now: () => clock, online: () => online,
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: () => {} });
  const states = []; c.subscribe((s) => states.push(out.badgeOf(s)));
  return { S, c, store, timers, states, tick: (ms) => { clock += ms; }, setOnline: (v) => { online = v; } };
}
const settle = () => new Promise((r) => setTimeout(r, 0));

(async () => {
  // ---- the badge's meaning (Brent, 10-28) ----
  t("no account on this device: ?", out.badgeOf({ phase: "none", online: true, net: "idle" }) === "none");
  t("signed out, account set up: Zz", out.badgeOf({ phase: "out", online: true, net: "idle" }) === "offline");
  t("signed in but no internet: Zz", out.badgeOf({ phase: "in", online: false, net: "ok" }) === "offline");
  t("talking to the server: arcs", out.badgeOf({ phase: "in", online: true, net: "busy" }) === "syncing");
  t("server not answering: !", out.badgeOf({ phase: "in", online: true, net: "trouble" }) === "trouble");
  t("checked in: tick", out.badgeOf({ phase: "in", online: true, net: "ok" }) === "synced");

  // ---- a fresh device ----
  let R = rig();
  t("a fresh device starts at ?", R.c.badge() === "none");
  t("and checking in does nothing without an account", (await R.c.check()) === false && R.S.calls.length === 0);
  let r = await R.c.sendCode("not an email");
  t("a bad address is refused before any request", !r.ok && /doesn.t look right/.test(r.msg) && R.S.calls.length === 0);
  r = await R.c.sendCode("  Brent@Example.com ");
  t("a good address asks the server for a code", r.ok && R.S.calls[0].path === "/auth/v1/otp");
  t("trimmed, lower-cased, and allowed to create the account", R.S.calls[0].body.email === "brent@example.com" && R.S.calls[0].body.create_user === true);
  t("with only the publishable key - never a secret one", R.S.calls[0].headers.apikey === out.KEY && /^sb_publishable_/.test(out.KEY) && !R.S.calls[0].headers.Authorization);
  t("sending a code does not set up the account yet", R.c.badge() === "none" && !R.store.get(out.EM));
  r = await R.c.verify("brent@example.com", "12345");
  t("a short code is refused before any request", !r.ok && R.S.calls.length === 1);
  r = await R.c.verify("brent@example.com", "654321");
  t("a wrong code says so plainly", !r.ok && /wrong or has expired/.test(r.msg) && R.c.badge() === "none");
  r = await R.c.verify("brent@example.com", "12 34 56");
  await settle(); await settle();
  t("the right code signs in", r.ok && R.c.get().phase === "in");
  t("the session is kept outside tt_ keys", !!R.store.get(out.SES) && out.SES.indexOf("tt_") !== 0 && out.EM.indexOf("tt_") !== 0);
  t("and the email is remembered", R.store.get(out.EM) === "brent@example.com");
  t("signing in checks in at once: arcs, then the tick", R.states.indexOf("syncing") >= 0 && R.c.badge() === "synced");
  const touchCall = R.S.calls.filter((x) => x.path === "/rest/v1/rpc/touch_active")[0];
  t("checking in records last-active as the signed-in person", touchCall && touchCall.headers.Authorization === "Bearer A1");
  t("and stamps when it worked (the tick redraws on it)", R.c.get().okAt > 0);

  // ---- trouble, then recovery ----
  R.S.down = true; R.tick(10 * 60000);
  await R.c.check();
  t("a server that answers badly: !", R.c.badge() === "trouble");
  t("and it tries again on its own in a minute", R.timers.some((x) => x.ms === 60000));
  R.S.down = false;
  await R.timers[R.timers.length - 1].fn(); await settle(); await settle();
  t("when it answers again: the tick", R.c.badge() === "synced");
  R.S.net = false; R.tick(10 * 60000); await R.c.check();
  t("a request that never gets an answer while the phone says online: !", R.c.badge() === "trouble");
  R.S.net = true;

  // ---- offline ----
  R.setOnline(false); R.c.poke();
  t("no internet: Zz", R.c.badge() === "offline");
  const before = R.S.calls.length; await R.c.check();
  t("and nothing is sent while offline", R.S.calls.length === before);
  R.setOnline(true); R.c.poke(); await settle(); await settle();
  t("back online after trouble: it checks in again", R.c.badge() === "synced" && R.S.calls.length > before);
  const n2 = R.S.calls.length; R.tick(30000); R.c.poke(); await settle();
  t("but not again within a couple of minutes of the last time", R.S.calls.length === n2);
  R.tick(3 * 60000); R.c.poke(); await settle(); await settle();
  t("and again once it has been a while", R.S.calls.length > n2);

  // ---- an expired sign-in ----
  R.S.touch.push(401); R.tick(10 * 60000); await R.c.check(); await settle();
  t("a lapsed token is refreshed and the check-in retried", R.S.calls.some((x) => x.path.indexOf("/auth/v1/token") === 0) && R.c.badge() === "synced");
  t("the new token is kept", JSON.parse(R.store.get(out.SES)).access_token === "A2");
  R.S.touch.push(401); R.S.refreshOk = false; R.tick(10 * 60000); await R.c.check(); await settle();
  t("a sign-in the server no longer accepts signs out: Zz, not ?", R.c.get().phase === "out" && R.c.badge() === "offline");
  t("with a sentence saying why", /ran out/.test(R.c.get().note));
  t("the dead session is forgotten, the email kept", !R.store.get(out.SES) && R.store.get(out.EM) === "brent@example.com");
  R.S.refreshOk = true;

  // ---- reopening the app ----
  const kept = R.store;
  let R2 = rig({ store: kept });
  t("an app reopened after signing out shows Zz", R2.c.badge() === "offline" && R2.c.get().email === "brent@example.com");
  await R2.c.sendCode("brent@example.com"); await R2.c.verify("brent@example.com", "123456"); await settle(); await settle();
  let R3 = rig({ store: kept });
  t("reopened while signed in: it remembers", R3.c.get().phase === "in");
  await R3.c.check();
  t("and checks in straight away", R3.c.badge() === "synced");
  // a sign-in about to lapse is refreshed before the check-in
  const nearly = JSON.parse(kept.get(out.SES)); nearly.expires_at = 1_800_000_000_000 + 30000; kept.set(out.SES, JSON.stringify(nearly));
  let R4 = rig({ store: kept }); await R4.c.check();
  t("a sign-in about to run out is renewed first", R4.S.calls[0].path.indexOf("/auth/v1/token") === 0 && R4.c.badge() === "synced");

  // ---- signing out ----
  await R4.c.signOut(); await settle();
  t("sign out: Zz, and the session is gone", R4.c.badge() === "offline" && !kept.get(out.SES));
  t("the server is told too (best effort)", R4.S.calls.some((x) => x.path.indexOf("/auth/v1/logout") === 0));

  // ---- the plain-words errors ----
  R = rig(); R.S.sendStatus = 429;
  r = await R.c.sendCode("brent@example.com");
  t("too many codes: wait a minute", !r.ok && /Wait a minute/.test(r.msg));
  R.S.sendStatus = 200; R.S.net = false;
  r = await R.c.sendCode("brent@example.com");
  t("no connection: says so", !r.ok && /Can.t reach the server/.test(r.msg));
  R.S.net = true; R.S.down = true;
  r = await R.c.sendCode("brent@example.com");
  t("server down: says so", !r.ok && /isn.t answering/.test(r.msg));
  // no fetch at all (the boot harness, an old browser) is just "no answer"
  const R5 = out.make({ fetch: null, store: memStore(), online: () => true });
  r = await R5.sendCode("a@b.co");
  t("without fetch nothing throws", !r.ok);

  // ---- backups never carry the sign-in ----
  localStorage.setItem("tt_projects", "[]"); localStorage.setItem(out.SES, '{"access_token":"x","refresh_token":"y"}'); localStorage.setItem(out.EM, "a@b.co");
  const b = out.backup(localStorage);
  t("a backup file has no sign-in tokens or email in it", !(out.SES in b.data) && !(out.EM in b.data) && ("tt_projects" in b.data));

  // ---- the glyphs ----
  const g = (state, extra) => renderToStaticMarkup(React.createElement(out.Glyph, Object.assign({ state, size: 20 }, extra || {})));
  t("every state is one cloud and one mark", ["none", "synced", "syncing", "trouble", "offline"].every((s) => (g(s).match(/M9 21\.5H19\.5/g) || []).length === 1));
  t("? grows and shrinks", /data-cloudmark="q"/.test(g("none")));
  t("the tick draws only when asked", /data-cloudmark="chk"/.test(g("synced", { check: "chk" })) && !/cloudmark/.test(g("synced")));
  t("arcs turn, ! waggles, Zz drift", /data-cloudmark="spin"/.test(g("syncing")) && /data-cloudmark="nudge"/.test(g("trouble")) && /data-cloudmark="z1"/.test(g("offline")) && /data-cloudmark="z2"/.test(g("offline")));
  t("drawn at the size asked, every state", ["none", "synced", "syncing", "trouble", "offline"].every((s) => /width="20" height="20"/.test(g(s))));

  // ---- the menu row's word ----
  t("menu word: not set up / signed out / signed in / offline / can't connect / syncing",
    out.word({ phase: "none" }) === "Not set up" && out.word({ phase: "out", online: true }) === "Signed out" &&
    out.word({ phase: "in", online: true, net: "ok" }) === "Signed in" && out.word({ phase: "in", online: false }) === "Offline" &&
    /connect/.test(out.word({ phase: "in", online: true, net: "trouble" })) && out.word({ phase: "in", online: true, net: "busy" }) === "Syncing");

  // ---- the sheet ----
  const nop = () => {};
  const sh = (p) => { try { return renderToStaticMarkup(React.createElement(out.Sheet, p)); } catch (e) { return "ERR:" + e.message; } };
  let h = sh({ cloud: { phase: "none", online: true, net: "idle", email: "" }, onClose: nop });
  t("not set up: asks for an email, with Send code and Cancel", /type="email"/.test(h) && />Send code</.test(h) && />Cancel</.test(h));
  t("and promises no password", /no password/.test(h));
  h = sh({ cloud: { phase: "out", online: true, net: "idle", email: "brent@example.com", note: "" }, onClose: nop });
  t("signed out: the email is filled in, and it says signed out", /value="brent@example.com"/.test(h) && /Signed out/.test(h));
  h = sh({ demo: "code", onClose: nop });
  t("the code step: eight boxes (the server sends eight) over one field the phone can fill from Mail", (h.match(/data-codebox/g) || []).length === 8 && /autoComplete="one-time-code"|autocomplete="one-time-code"/.test(h) && /inputMode="numeric"|inputmode="numeric"/.test(h));
  t("the code step: the line above says six or eight", /data-acctcodelabel[^>]*>Input 6 or 8 digit code below</.test(h));
  t("the code step: six solid boxes, then two dashed ones", (h.match(/data-codebox="main"/g) || []).length === 6 && (h.match(/data-codebox="spare"/g) || []).length === 2 && (h.match(/dashed/g) || []).length === 2);
  t("the code step: the dashed pair is as bright as the rest", (h.match(/data-codebox="spare"[^>]*border:2px dashed ([^;"]+)/g) || []).every((x) => !/rgba?\(.*0\.[0-4]/.test(x)) && !/data-codebox="spare"[^>]*opacity/.test(h));
  t("the code step: \"if your code has 8\" under them", /data-acctcodehint="on"[^>]*>if your code has 8</.test(h));
  t("with Sign in, a way back to the email, and a wait before resending", />Sign in</.test(h) && /data-acct="change"/.test(h));
  h = sh({ cloud: { phase: "in", online: true, net: "ok", email: "brent@example.com", okAt: Date.now() }, onClose: nop });
  t("signed in: who, the state in words, Sign out, Close", /brent@example\.com/.test(h) && /Signed in\./.test(h) && /data-acct="signout"/.test(h) && />Close</.test(h));
  h = sh({ cloud: { phase: "in", online: true, net: "trouble", email: "brent@example.com" }, onClose: nop });
  t("in trouble: says the board is safe and the app keeps trying", /safe on this device/.test(h) && /keeps trying/.test(h));
  h = sh({ trail: [{ label: "Board", go: nop }, { label: "Menu", go: nop }], cloud: { phase: "none", online: true, net: "idle" }, onClose: nop });
  t("opened from the menu it carries the trail", /data-trail="Board &gt; Menu"/.test(h));

  // ---- the header: badge at the outer end, long names shorten ----
  const tk = (mirror) => renderToStaticMarkup(React.createElement(out.Ticker, { interrupting: false, activeProj: { name: "Line 4 Hydraulic Press Rebuild" }, intElapsed: 0,
    wsActive: null, elapsed: 60000, onBreak: false, clocked: true, atWorkElapsed: 0, nowTick: Date.now(), bottom: false, statusTag: "Break", onStatusTap: nop, mirror,
    cloud: React.createElement("span", { "data-anchor": "hdr-cloud" }, "C") }));
  let hr = tk(false);
  t("right hand: the badge is last, after the Break tag", (hr.match(/data-anchor="hdr-cloud"/g) || []).length === 1 && hr.lastIndexOf('data-anchor="hdr-cloud"') > hr.indexOf('data-breaktag="Break"'));
  hr = tk(true);
  t("left hand: the badge is first, before the Break tag", hr.indexOf('data-anchor="hdr-cloud"') >= 0 && (hr.match(/data-anchor="hdr-cloud"/g) || []).length === 1 && hr.indexOf('data-anchor="hdr-cloud"') < hr.indexOf('data-breaktag="Break"') && hr.indexOf('data-anchor="hdr-cloud"') < hr.indexOf('data-anchor="hdr-when"'));
  t("a long job name shortens with an ellipsis instead of running under the tag", /data-hdrjob="true" style="[^"]*min-width:0;overflow:hidden;text-overflow:ellipsis/.test(hr));

  // ---- the manual ----
  const H = out.help();
  t("the manual covers the Account row", Object.keys(H.guides).some((k) => (H.guides[k].covers || []).indexOf("Account") >= 0));
  t("and the header picture names the badge", H.pictures.header.parts.some((p) => p.anchor === '[data-anchor="hdr-cloud"]'));
  t("the manual stages the Account sheet as a whole sheet (else it measures zero tall and draws blank)", out.sheets.account === true && out.stageW.account === 390);
  t("no digits in the new help prose", [H.guides.signin].concat(H.pictures.header.parts.filter((p) => /cloud/.test(p.anchor))).every((x) => !/\d/.test(JSON.stringify(x.steps ? x.steps.map((s) => s.text + s.title) : x.text))));

  let bad = 0;
  res.forEach(([l, p]) => { if (!p) { bad++; console.log("   x " + l); } });
  console.log("account    : " + (res.length - bad) + "/" + res.length + " passed" + (bad ? "  FAILED" : ""));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.log("account    : threw " + (e && e.stack)); process.exit(1); });
