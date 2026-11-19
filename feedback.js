// feedback.js - About Time Tracker and Developer Feedback (11-17).
//   node feedback.js /tmp/app_only.js
// The release history against APP_VERSION, the app details a person may
// attach (and that nothing of the board rides along), the feedback client
// against a fake signed-in cloud that answers the way PostgREST does for the
// fb_* functions in db/06_support.sql, and the sheets drawn.
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
const document = { addEventListener(){}, removeEventListener(){}, getElementById: () => null, hidden: false };
const src = fs.readFileSync(process.argv[2] || "/tmp/app_only.js", "utf8");
const X = new Function("React", "window", "localStorage", "navigator", "document", "Event",
  src + "\nreturn { V: APP_VERSION, REL: TT_RELEASES, relDate: ttReleaseDate, dev: ttFbDevice, info: ttFbAppInfo, make: ttFeedbackMake," +
        " MAX: TT_FB_MAX, DRAFT: TT_FB_DRAFT, KINDS: TT_FB_KINDS, STATUS: TT_FB_STATUS, title: ttFbTitle, words: ttFbStatusWords, ev: ttFbEventWords," +
        " About: AboutModal, Send: FeedbackSendModal, Mine: MyFeedbackModal, Thread: FeedbackThreadModal, Release: ReleaseModal, Privacy: PrivacyModal," +
        " PRIV: TT_PRIVACY, backup: backupBuild, syncKind: ttSyncKind, App: App," +
        " filt: ttFbFilter, counts: ttFbCounts, swords: ttFbStaffWords, fwords: ttFaqWords, match: ttFaqMatch, topics: ttFaqTopics, faqClient: ttFaqClient," +
        " Inbox: StaffInboxModal, Item: StaffItemModal, Team: StaffTeamModal, SFaq: StaffFaqModal, FEdit: FaqEditModal, Faq: FaqModal, fbObj: ttFeedback, helpAll: helpAll, searchDocs: helpSearchDocs, Modal: Modal };")(React, win, localStorage, navigator, document, function Event(t){ return { type: t }; });

const res = []; const t = (l, p) => res.push([l, !!p]);
const draw = (C, p) => { try { return renderToStaticMarkup(React.createElement(C, p)); } catch (e) { return "ERR:" + e.message; } };

// ---------------- the release history ----------------
t("the newest release is this version", X.REL[0].v === X.V);
t("every version appears once", new Set(X.REL.map((r) => r.v)).size === X.REL.length);
t("every release has a real date", X.REL.every((r) => /^\d{4}-\d\d-\d\d$/.test(r.date) && X.relDate(r.date)));
t("newest first, dates never go forward", X.REL.every((r, i) => i === 0 || r.date <= X.REL[i - 1].date));
t("every release says what changed", X.REL.every((r) => r.items.length >= 1 && r.items.every((s) => typeof s === "string" && s.length > 8 && s.length < 140)));
t("lines are plain: no trailing full stop, no tags", X.REL.every((r) => r.items.every((s) => !/[.]$/.test(s) && !/[<>]/.test(s))));
t("the date reads like Nov 17, 2026", X.relDate("2026-11-17") === "Nov 17, 2026" && X.relDate("junk") === "");

// ---------------- device and app details ----------------
const IPH = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15";
t("an iPhone and its iOS", JSON.stringify(X.dev(IPH)) === JSON.stringify({ device: "iPhone", os: "iOS 18.1" }));
t("an iPad that calls itself a Mac", X.dev("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", true).device === "iPad");
t("a Mac without touch is a Mac", X.dev("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", false).device === "Mac");
t("an Android phone", X.dev("Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari").device === "Android phone");
t("anything else", X.dev("curl/8").device === "Other device");
const settings = { theme: "neon-dream", mode: "light", handedness: "left", projects: "SECRET", schedule: { secret: 1 } };
const a = X.info(settings, { on: true, rate: "q15" }, { ua: IPH, screen: "390×844", standalone: true });
t("details carry the version", a.info.version === X.V);
t("and the device, look and sync", a.info.device === "iPhone" && a.info.mode === "light" && a.info.hand === "left" && a.info.sync === "Every 15 minutes");
t("and nothing of the board", !/SECRET|secret/.test(JSON.stringify(a.info)));
t("the details stay small", JSON.stringify(a.info).length < 600);
t("the words show what is sent", a.words.indexOf(X.V) >= 0 && a.words.indexOf("iPhone") >= 0 && a.words.indexOf("iOS 18.1") >= 0 && /sync Every 15 minutes/.test(a.words));
t("sync off says off", X.info({}, { on: false }, {}).info.sync === "off" && /sync off/.test(X.info({}, { on: false }, {}).words));
t("an unknown theme falls back", X.info({ theme: "nope" }, null, {}).info.theme.length > 0);

// ---------------- small words ----------------
t("a card title is the first line", X.title("Timer stops\nwhen locked") === "Timer stops");
t("a long first line is cut at a word", X.title("word ".repeat(30)).length <= 64 && /…$/.test(X.title("word ".repeat(30))));
t("fixed names its version", X.words("fixed", "1.5.5") === "Fixed in 1.5.5" && X.words("fixed") === "Fixed");
t("an unknown status reads as sent", X.words("zzz") === "Sent");
t("every status has words and a tone", Object.keys(X.STATUS).every((k) => X.STATUS[k][0] && /^(ok|info|warn|dim)$/.test(X.STATUS[k][1])));
t("every status the server knows is covered", ["new", "open", "waiting", "planned", "fixed", "closed"].every((k) => X.STATUS[k]));
t("the kinds match the server", JSON.stringify(X.KINDS.map((k) => k[0])) === JSON.stringify(["problem", "idea", "question", "praise"]));
t("events read as words", X.ev("status:fixed") === "Now: Fixed" && X.ev("status:open") === "Looking into it" && X.ev("assign:none") === "No longer assigned");
t("the limit matches the server", X.MAX === 4000);

// ---------------- the client ----------------
function fakeCloud(){
  const subs = [];
  const C = { phase: "in", calls: [], replies: {}, net: true,
    get(){ return { phase: C.phase }; },
    subscribe(fn){ subs.push(fn); return () => {}; },
    emit(){ subs.forEach((f) => f({ phase: C.phase })); },
    request(method, path, body){
      C.calls.push({ method, path, body });
      if (!C.net) return Promise.resolve({ status: 0, body: null });
      const name = path.replace("/rest/v1/rpc/", ""), r = C.replies[name];
      return Promise.resolve(typeof r === "function" ? r(body) : (r || { status: 200, body: null }));
    } };
  return C;
}
(async function(){
  let clock = 1e9;
  const c = fakeCloud(), fb = X.make({ cloud: c, now: () => clock });
  c.replies.fb_send = (b) => ({ status: 200, body: "id-1" });
  let r = await fb.send("idea", "   ");
  t("an empty item is not sent", !r.ok && c.calls.length === 0 && /Write something/.test(r.msg));
  r = await fb.send("idea", "x".repeat(4001));
  t("an over-long item is not sent", !r.ok && c.calls.length === 0 && /too long/.test(r.msg));
  r = await fb.send("idea", "  Dark report  ", { version: "1" });
  const s0 = c.calls[0];
  t("a send calls fb_send", r.ok && r.data === "id-1" && s0.method === "POST" && s0.path === "/rest/v1/rpc/fb_send");
  t("with the kind, trimmed words and details", s0.body.kind === "idea" && s0.body.body === "Dark report" && s0.body.app.version === "1");
  await fb.send("problem", "no details");
  t("no details sends null", c.calls[1].body.app === null);

  c.replies.fb_send = { status: 400, body: { code: "54000", message: "too many sent for now" } };
  r = await fb.send("idea", "again");
  t("the server's limit reads plainly", !r.ok && /a lot sent/.test(r.msg));
  c.replies.fb_send = { status: 404, body: { code: "PGRST202", message: "Could not find the function" } };
  r = await fb.send("idea", "again");
  t("a server without feedback says so", /isn’t set up/.test(r.msg));
  c.replies.fb_send = { status: 503, body: null };
  r = await fb.send("idea", "again");
  t("a server in trouble", /isn’t answering/.test(r.msg));
  c.net = false; r = await fb.send("idea", "again"); c.net = true;
  t("offline", /Can’t reach/.test(r.msg));
  c.replies.fb_reply = { status: 400, body: { code: "22023", message: "write something first" } };
  r = await fb.reply("id-1", "x");
  t("a server refusal is capitalised", r.msg === "Write something first.");
  c.replies.fb_thread = { status: 400, body: { code: "P0002", message: "not found" } };
  r = await fb.thread("gone");
  t("a thread that is gone", /isn’t there/.test(r.msg));

  c.phase = "out"; const before = c.calls.length;
  r = await fb.send("idea", "signed out");
  t("signed out, nothing is sent", !r.ok && r.status === 401 && c.calls.length === before && /Sign in/.test(r.msg));
  c.phase = "in";

  // reply, inbox, update: the right function and arguments
  c.replies.fb_reply = { status: 200, body: 7 };
  await fb.reply("id-1", " thanks ", false);
  let last = c.calls[c.calls.length - 1];
  t("a reply calls fb_reply with the id", last.path.endsWith("/fb_reply") && last.body.id === "id-1" && last.body.body === "thanks" && last.body.internal === false);
  await fb.inbox({ status: ["new"] }); last = c.calls[c.calls.length - 1];
  t("the inbox passes its filter as q", last.path.endsWith("/fb_inbox") && last.body.q.status[0] === "new");
  await fb.update("id-1", { status: "fixed" }); last = c.calls[c.calls.length - 1];
  t("an update passes ch", last.path.endsWith("/fb_update") && last.body.ch.status === "fixed");
  await fb.teamSet("a@b.c", null); last = c.calls[c.calls.length - 1];
  t("removing a teammate sends role null", last.path.endsWith("/fb_team_set") && last.body.role === null);

  // the badge
  let calls = 0; c.replies.fb_unread = () => { calls++; return { status: 200, body: { mine: 2, inbox: 3, staff: "owner" } }; };
  const seen = []; fb.subscribe((s) => seen.push(s.mine));
  await fb.refresh(true);
  t("the badge counts replies waiting", fb.status().mine === 2 && fb.status().inbox === 3 && fb.status().staff === "owner" && seen[seen.length - 1] === 2);
  await fb.refresh(false);
  t("and is not asked for again straight away", calls === 1);
  clock += 6 * 60000; await fb.refresh(false);
  t("but is, after a while", calls === 2);
  c.replies.fb_thread = { status: 200, body: { item: {}, messages: [] } };
  await fb.thread("id-1");
  t("reading a thread updates the badge", calls === 3);
  c.phase = "out"; c.emit();
  t("signing out clears the badge", fb.status().mine === 0 && fb.status().staff === null);
  c.phase = "in";

  // the draft
  fb.draft({ kind: "idea", text: "half written" });
  t("a draft is kept", fb.draft().text === "half written" && fb.draft().kind === "idea");
  t("outside backups", !Object.keys(X.backup(localStorage)).some((k) => k.indexOf("ttfb") >= 0) && X.DRAFT.indexOf("tt_") !== 0);
  t("and outside sync", !X.syncKind(X.DRAFT));
  fb.draft({ kind: "idea", text: "   " });
  t("an empty draft is cleared", fb.draft() === null);

  // ---------------- the sheets ----------------
  const about = draw(X.About, { demo: { fb: { mine: 2 } }, onClose(){} });
  t("About draws", about.indexOf("ERR:") !== 0);
  t("with the name, version and studio", about.indexOf("Time Tracker") >= 0 && about.indexOf("Version " + X.V) >= 0 && about.indexOf("Developed at Hiatt Studios") >= 0);
  t("and the five rows in order", ["new", "history", "send", "mine", "privacy"].map((k) => about.indexOf('data-aboutrow="' + k + '"')).every((v, i, arr) => v > 0 && (i === 0 || v > arr[i - 1])));
  t("what's new names this version", about.indexOf("What’s new in " + X.V) >= 0);
  t("replies waiting show on My feedback", about.indexOf('data-fbcount="2"') >= 0 && about.indexOf("2 new replies") >= 0);
  t("none waiting, no count", draw(X.About, { demo: { fb: { mine: 0 } }, onClose(){} }).indexOf("data-fbcount") < 0);
  const hist = draw(X.Release, { onClose(){} }), only = draw(X.Release, { only: true, onClose(){} });
  t("version history lists every release", (hist.match(/data-release=/g) || []).length === X.REL.length);
  t("what's new lists only this one", (only.match(/data-release=/g) || []).length === 1 && only.indexOf("this version") > 0);
  const priv = draw(X.Privacy, { onClose(){} });
  t("privacy draws each part", X.PRIV.every((p) => priv.indexOf('data-privacy="' + p[0] + '"') >= 0));
  t("privacy says the board is never sent with feedback", /Never your board/.test(priv));

  const out = { phase: "out" };
  t("send needs sign-in", draw(X.Send, { cloud: out, onClose(){} }).indexOf("data-fbsignin") > 0);
  t("my feedback needs sign-in", draw(X.Mine, { cloud: out, onClose(){} }).indexOf("data-fbsignin") > 0);
  const form = draw(X.Send, { demo: {}, onClose(){} });
  t("the form has the four kinds", X.KINDS.every((k) => form.indexOf('data-fbkind="' + k[0] + '"') > 0));
  t("problem is picked first", /data-fbkind="problem" aria-pressed="true"/.test(form));
  t("the box asks the right question", form.indexOf(X.STATUS && "What happened, and what did you expect?") > 0);
  t("details on, and shown in words", form.indexOf('data-fbdetails="on"') > 0 && /Never your board/.test(form));
  t("the character count keeps its space", form.indexOf("data-fbleft") > 0);
  t("the message line keeps its space", /min-height:2\.6rem/.test(form));
  const sent = draw(X.Send, { demo: { sent: true }, onClose(){} });
  t("after sending: thanks and the way to My feedback", sent.indexOf("data-fbsent") > 0 && sent.indexOf("data-fbopenmine") > 0);

  const L = [{ id: "a", kind: "problem", body: "Codes only take six\nmore", status: "fixed", fixed_in: "1.5.1", created_at: "2026-11-14T10:00:00Z", replies: 1, unread: true },
             { id: "b", kind: "idea", body: "Wi-Fi only sync", status: "planned", created_at: "2026-11-17T10:00:00Z", replies: 0, unread: false }];
  const mine = draw(X.Mine, { demo: { list: L }, onClose(){} });
  t("my feedback lists each item", mine.indexOf('data-fbitem="a"') > 0 && mine.indexOf('data-fbitem="b"') > 0);
  t("with its status", mine.indexOf("Fixed in 1.5.1") > 0 && mine.indexOf(">Planned<") > 0);
  t("and marks a new reply", /data-fbitem="a" data-fbunread="1"/.test(mine) && mine.indexOf("New reply") > 0 && !/data-fbitem="b" data-fbunread/.test(mine));
  t("the title is the first line only", mine.indexOf("Codes only take six<") > 0);
  t("nothing sent yet", draw(X.Mine, { demo: { list: [] }, onClose(){} }).indexOf("data-fbempty") > 0);

  const TH = { as: "reporter", item: { id: "a", kind: "problem", body: "Codes only take six", status: "fixed", fixed_in: "1.5.1", created_at: "2026-11-14T10:00:00Z",
      app: { version: "1.5", device: "iPhone", os: "iOS 18.1" } },
    messages: [{ id: 1, by_staff: true, who: "Brent", body: "Thanks - fixed in 1.5.1.", at: "2026-11-14T11:00:00Z" },
               { id: 2, by_staff: true, event: "status:fixed", body: "", at: "2026-11-14T11:01:00Z" },
               { id: 3, by_staff: false, who: "You", body: "Works now <b>!</b>", at: "2026-11-14T12:00:00Z" }] };
  const th = draw(X.Thread, { demo: { thread: TH }, id: "a", onClose(){} });
  t("the thread starts with what was sent", th.indexOf("Codes only take six") > 0 && th.indexOf('data-fbmsgrow="you"') > 0);
  t("staff replies carry the name", th.indexOf("Brent · ") > 0 && th.indexOf('data-fbmsgrow="staff"') > 0);
  t("a status change is a line of its own", th.indexOf('data-fbevent="status:fixed"') > 0 && th.indexOf("Now: Fixed") > 0);
  t("what they write is shown as text, never markup", th.indexOf("&lt;b&gt;!&lt;/b&gt;") > 0 && th.indexOf("<b>!</b>") < 0);
  t("the details sent are shown", th.indexOf("data-fbappsent") > 0 && th.indexOf("iPhone") > 0);
  t("and a reply box", th.indexOf("data-fbreply") > 0);


  // ================= the team's inbox and the FAQ (11-18) =================
  const IL=[{ id:"a", kind:"problem", body:"Timer stops when I lock my phone", status:"new", reporter:"sam@shop.co", created_at:"2026-11-17T10:00:00Z", last_at:"2026-11-17T10:00:00Z", replies:0, unread:true, tags:["ios"] },
            { id:"b", kind:"idea", body:"Export the week to Excel", status:"open", reporter:"lee@acme.com", created_at:"2026-11-16T10:00:00Z", last_at:"2026-11-16T12:00:00Z", replies:2, unread:false, assignee_name:"Jon" },
            { id:"c", kind:"question", body:"How do paid breaks count?", status:"fixed", fixed_in:"1.5.5", reporter:"kim@mail.com", created_at:"2026-11-15T10:00:00Z", last_at:"2026-11-15T12:00:00Z", replies:3, unread:false }];
  t("inbox filter: by status", X.filt(IL, "open").length === 1 && X.filt(IL, "all").length === 3 && X.filt(IL, "").length === 3);
  t("inbox filter: words match the body, sender or tags", X.filt(IL, "all", "LOCK phone").length === 1 && X.filt(IL, "all", "acme").length === 1 && X.filt(IL, "all", "ios").length === 1);
  t("inbox filter: every word must match", X.filt(IL, "all", "lock excel").length === 0);
  t("inbox counts per status", (() => { const c = X.counts(IL); return c.all === 3 && c.new === 1 && c.open === 1 && c.fixed === 1 && c.closed === 0; })());
  t("staff words for a status", X.swords("waiting") === "Waiting on them" && X.swords("fixed", "1.6") === "Fixed in 1.6" && X.swords("zzz") === "New");

  const FQ=[{ id:"q1", topic:"Breaks", question:"Do paid breaks count toward overtime?", answer:"Yes, unless Pay & Work Week says otherwise.", guide:"setpay" },
            { id:"q2", topic:"Sync", question:"Does sync use a lot of data?", answer:"About two megabytes a month on Smart.", guide:"sync" },
            { id:"q3", topic:"Sync", question:"Why doesn't my other device show a change?", answer:"Tap Sync now to fetch it straight away." }];
  t("faq words drop filler and repeats", JSON.stringify(X.fwords("Does the sync use the SYNC data?")) === JSON.stringify(["sync","use","data"]));
  t("faq match: a question about paid breaks finds that answer", (X.match("do paid breaks count for overtime", FQ)[0] || {}).id === "q1");
  t("faq match: plurals and -ing still match", (X.match("my devices are not showing changes", FQ)[0] || {}).id === "q3");
  t("faq match: one shared word is not enough", X.match("overtime please", FQ).length === 0);
  t("faq match: a word only in an answer is not enough alone", X.match("megabytes smart", FQ).length === 0);
  t("faq match: at most two", X.match("sync data device change paid breaks overtime", FQ).length <= 2);
  t("faq match: nothing typed, nothing shown", X.match("", FQ).length === 0 && X.match("hi", FQ).length === 0);
  t("faq topics in first-seen order", JSON.stringify(X.topics(FQ)) === JSON.stringify(["Breaks","Sync"]));

  // the FAQ client: signed out reads as the public role; signed in as the person
  {
    mem.clear();
    const calls2 = [];
    const cl = { phase: "out", get(){ return { phase: cl.phase }; },
      request(m, p, b){ calls2.push(["in", p, b]); return Promise.resolve({ status: 200, body: FQ }); },
      publicRequest(m, p, b){ calls2.push(["pub", p, b]); return Promise.resolve({ status: cl.down ? 0 : 200, body: cl.down ? null : FQ.slice(0, 2) }); } };
    const fbx = { rpcRaw(n, a){ calls2.push(["rpc", n, a]); return Promise.resolve({ ok: true, data: [] }); } };
    const fc = X.faqClient(fbx, cl);
    let r = await fc.load(true);
    t("faq client: signed out, the list comes as the public role", calls2[0][0] === "pub" && calls2[0][1] === "/rest/v1/rpc/faq_list" && r.list.length === 2);
    t("faq client: and is kept on the device", fc.cached().length === 2 && /q1/.test(localStorage.getItem("ttfaq_cache")));
    t("faq client: kept outside backups and sync", !Object.keys(X.backup(localStorage)).some((k) => /faq/.test(k)) && !X.syncKind("ttfaq_cache"));
    r = await fc.load(false);
    t("faq client: not asked again straight away", calls2.length === 1 && r.cached);
    cl.phase = "in"; r = await fc.load(true);
    t("faq client: signed in, asked as the person", calls2[1][0] === "in" && r.list.length === 3);
    cl.phase = "out"; cl.down = true; r = await fc.load(true);
    t("faq client: offline, the last copy still answers", !r.ok && r.list.length === 3 && r.offline);
    const before = calls2.length;
    await fc.vote("q1", true);
    t("faq client: signed out, a vote stays on this device", calls2.length === before && JSON.parse(localStorage.getItem("ttfaq_votes")).q1 === true);
    cl.phase = "in"; await fc.vote("q1", false);
    t("faq client: signed in, a vote goes to the server", calls2[calls2.length - 1][0] === "rpc" && calls2[calls2.length - 1][1] === "faq_vote" && calls2[calls2.length - 1][2].helpful === false);
    await fc.dismiss("s1");
    t("faq client: dismissing a suggestion", calls2[calls2.length - 1][1] === "faq_suggestion_set" && calls2[calls2.length - 1][2].status === "dismissed");
  }

  // the manual's search finds FAQ answers the device holds
  mem.set("ttfaq_cache", JSON.stringify({ at: Date.now(), list: FQ }));
  X.fbObj.faq = X.faqClient(X.fbObj, { get(){ return { phase: "out" }; }, publicRequest(){ return Promise.resolve({ status: 0 }); }, request(){ return Promise.resolve({ status: 0 }); } });
  t("manual search holds the FAQ", X.searchDocs().some((d) => d.kind === "faq" && d.id === "q2" && /FAQ/.test(d.where)));
  t("every guide an FAQ links to exists", FQ.filter((f) => f.guide).every((f) => X.helpAll().guides[f.guide]));

  // FAQ, as people see it (layout D)
  const fq = draw(X.Faq, { demo: { list: FQ, open: "q1", votes: { q1: false } }, onClose(){} });
  t("faq: draws", fq.indexOf("ERR:") !== 0);
  t("faq: grouped by topic", (fq.match(/data-faqtopic=/g) || []).length === 2 && fq.indexOf('data-faqtopic="Breaks"') < fq.indexOf('data-faqtopic="Sync"'));
  t("faq: each question once", (fq.match(/data-faqq=/g) || []).length === 3);
  t("faq: the open one shows its answer", /data-faqanswer="q1"/.test(fq) && !/data-faqanswer="q2"/.test(fq));
  t("faq: Show me how names the guide", /data-faqguide="setpay"/.test(fq) && fq.indexOf("Show me how: Set up pay and overtime") > 0);
  t("faq: a No vote offers to say what's missing", /data-faqvote="no"/.test(fq) && /data-faqaskmore="q1"/.test(fq));
  t("faq: Still stuck at the foot", /data-faqstuck/.test(fq) && fq.lastIndexOf("data-faqstuck") > fq.lastIndexOf("data-faqq="));
  t("faq: a search box", /data-faqsearch/.test(fq));
  const fq0 = draw(X.Faq, { demo: { list: [] }, onClose(){} });
  t("faq: empty says so", /data-faqempty/.test(fq0));
  t("faq: the vote line keeps its height", /min-height:2rem/.test(draw(X.Faq, { demo: { list: FQ, open: "q2" }, onClose(){} })));

  // F: answers before sending
  const fs1 = draw(X.Send, { demo: { kind: "question", text: "do paid breaks count for overtime", faq: FQ }, onClose(){} });
  t("send: a matching answer shows under the form", /data-faqhint="1"/.test(fs1) && /data-faqhintq="q1"/.test(fs1));
  t("send: and Send becomes Send anyway", fs1.indexOf(">Send anyway<") > 0);
  t("send: the hint comes last, so nothing below it moves", fs1.lastIndexOf("data-faqhint") > fs1.lastIndexOf("data-fbdetails"));
  const fs2 = draw(X.Send, { demo: { kind: "idea", text: "do paid breaks count for overtime", faq: FQ }, onClose(){} });
  t("send: ideas get no hint", !/data-faqhint/.test(fs2) && fs2.indexOf(">Send<") > 0);

  // About: the inbox row only for the team
  t("about: no inbox row for a reporter", draw(X.About, { demo: { fb: { mine: 0, staff: null } }, onClose(){} }).indexOf('data-aboutrow="inbox"') < 0);
  const ab2 = draw(X.About, { demo: { fb: { mine: 0, staff: "owner", inbox: 3 } }, onClose(){} });
  t("about: the team gets the inbox row, with a count", ab2.indexOf('data-aboutrow="inbox"') > 0 && ab2.indexOf("3 new") > 0);

  // the inbox
  const TEAM=[{ user_id:"s1", role:"owner", name:"Brent", email:"b@x", me:true }, { user_id:"s2", role:"helper", name:"Jon", email:"j@x" }];
  const im = draw(X.Inbox, { demo: { list: IL, view: "mail", team: TEAM }, onClose(){} });
  t("inbox: draws in Mail", im.indexOf("ERR:") !== 0 && /data-fbinbox="mail"/.test(im));
  t("inbox: the title stays, the switch sits beside it", im.indexOf(">Feedback inbox<") > 0 && /data-fbview="mail"/.test(im) && im.indexOf("Feedback inbox<") < im.indexOf('data-fbview'));
  t("inbox: the switch is the app's own toggle", /data-anchor="set-inboxview"/.test(im));
  t("inbox: every item, with quick actions", (im.match(/data-fbinboxitem=/g) || []).length === 3 && (im.match(/data-fbquick="reply"/g) || []).length === 3);
  t("inbox: the button for the status it has is off", /data-fbquick="fixed" disabled=""/.test(im.slice(im.indexOf('data-fbinboxitem="c"'))));
  t("inbox: chips count each status", im.indexOf("New · 1") > 0 && im.indexOf("Fixed · 1") > 0);
  t("inbox: new items stand out", /data-fbinboxitem="a" data-fbunread="1"/.test(im));
  t("inbox: FAQ and Team from the inbox", /data-fbfaq/.test(im) && /data-fbteam/.test(im));
  t("inbox: an owner can see unassigned", /data-fbchip="who-none"/.test(im));
  t("inbox: a helper can't", !/data-fbchip="who-none"/.test(draw(X.Inbox, { demo: { list: IL, view: "mail", role: "helper" }, onClose(){} })));
  const TH2={ b: { as:"owner", item:IL[1], messages:[{ id:1, by_staff:true, internal:false, who:"Jon", body:"Would a .csv do?", at:"2026-11-16T11:00:00Z" },
                                                      { id:2, by_staff:true, internal:true, who:"Brent", body:"Ask about payroll", at:"2026-11-16T11:30:00Z" },
                                                      { id:3, by_staff:true, event:"status:open", body:"", who:"Brent", at:"2026-11-16T11:31:00Z" }] } };
  const ib = draw(X.Inbox, { demo: { list: IL, view: "blog", team: TEAM, threads: TH2 }, onClose(){} });
  t("inbox: Blog draws whole threads", /data-fbinbox="blog"/.test(ib) && (ib.match(/data-fbpost=/g) || []).length === 3);
  t("inbox: with the conversation, notes marked", /data-fbmsgrow="staff"/.test(ib) && /data-fbmsgrow="note"/.test(ib) && ib.indexOf("internal note") > 0);
  t("inbox: and a reply box on each", (ib.match(/data-fbpostreply=/g) || []).length === 3 && /data-fbpostsend="note"/.test(ib));
  t("inbox: shared filters (Blog keeps the chip)", /data-fbinboxcount="1"/.test(draw(X.Inbox, { demo: { list: IL, view: "blog", status: "fixed", threads: {} }, onClose(){} })));
  t("inbox: nothing yet", /data-fbinboxempty/.test(draw(X.Inbox, { demo: { list: [], view: "mail" }, onClose(){} })));
  t("inbox: the view is remembered outside backups and sync", !X.syncKind("ttfb_inboxview") && !Object.keys(X.backup(localStorage)).some((k) => /inboxview/.test(k)));

  // one item, as the team sees it
  const ITH={ as:"owner", item:Object.assign({}, IL[1], { priority:"high", assignee:"s2", app:{ version:"1.5.4", device:"iPhone", os:"iOS 18.1" } }), messages:TH2.b.messages };
  const it1 = draw(X.Item, { demo: { thread: ITH }, team: TEAM, role: "owner", onClose(){} });
  t("item: draws with its four controls", ["status","fixed_in","priority","assignee"].every((k) => it1.indexOf('data-fbset="' + k + '"') > 0));
  t("item: the app details in words", /data-fbitemapp/.test(it1) && it1.indexOf("Version 1.5.4, iPhone, iOS 18.1") > 0);
  t("item: notes show as notes", /data-fbmsgrow="note"/.test(it1));
  t("item: Add to FAQ", /data-fbaddfaq/.test(it1));
  t("item: an owner can assign and delete", !/data-fbset="assignee" disabled/.test(it1) && /data-holddelete="fbitem"/.test(it1));
  const it2 = draw(X.Item, { demo: { thread: ITH }, team: TEAM, role: "helper", onClose(){} });
  t("item: a helper can't reassign or delete", /data-fbset="assignee" disabled/.test(it2) && !/data-holddelete="fbitem"/.test(it2));
  t("item: an assignment line names the teammate", draw(X.Item, { demo: { thread: Object.assign({}, ITH, { messages:[{ id:9, by_staff:true, event:"assign:s2", who:"Brent", body:"", at:"2026-11-16T11:00:00Z" }] }) }, team: TEAM, role: "owner", onClose(){} }).indexOf("Assigned to Jon") > 0);

  // the team, the FAQ list and the editor
  const tm = draw(X.Team, { demo: { team: TEAM }, role: "owner", onClose(){} });
  t("team: owners and helpers", /data-fbteamrow="owner"/.test(tm) && /data-fbteamrow="helper"/.test(tm));
  t("team: a helper is removed with a hold, never the owner", (tm.match(/data-holddelete="helper"/g) || []).length === 1);
  t("team: an owner adds by email", /data-fbteamemail/.test(tm));
  t("team: a helper only looks", !/data-fbteamemail/.test(draw(X.Team, { demo: { team: TEAM }, role: "helper", onClose(){} })));
  const SG=[{ id:"s1", question:"Why does my other device not show a change?", answer:"Tap Sync now.", topic:"Sync", asked:4 }];
  const sf = draw(X.SFaq, { demo: { list: [Object.assign({ published:true, yes:3, no:1 }, FQ[0]), Object.assign({ published:false }, FQ[1])], suggestions: SG }, role: "owner", onClose(){} });
  t("staff faq: Claude's suggestions with how often asked", /data-faqsug="s1"/.test(sf) && sf.indexOf("Asked in 4 messages") > 0 && /data-faqsugact="dismiss"/.test(sf));
  t("staff faq: entries say published or draft, and the votes", /data-faqpub="1"/.test(sf) && /data-faqpub="0"/.test(sf) && sf.indexOf("3 helped · 1 didn") > 0);
  t("staff faq: none waiting tells how to ask Claude", /Ask Claude/.test(draw(X.SFaq, { demo: { list: [], suggestions: [] }, role: "owner", onClose(){} })));
  const fe1 = draw(X.FEdit, { demo: {}, init: { question:"Q here?", answer:"A", source:"a", published:true }, role: "owner", topics: ["Sync"], onClose(){} });
  t("faq editor: an owner publishes", /data-anchor="set-faqpub"|name="faqpub"|faqpub/.test(fe1) && fe1.indexOf(">Publish<") > 0);
  t("faq editor: made from an item, it offers to tell the sender", /faqnotify/.test(fe1));
  t("faq editor: guides to link", /data-faqedg/.test(fe1) && fe1.indexOf("Set up pay and overtime") > 0);
  const fe2 = draw(X.FEdit, { demo: {}, init: { question:"Q here?", answer:"A" }, role: "helper", onClose(){} });
  t("faq editor: a helper saves a draft; an owner publishes", fe2.indexOf("An owner publishes it") > 0 && fe2.indexOf(">Save draft<") > 0 && !/faqpub/.test(fe2));
  t("faq editor: only an owner deletes, and with a hold", /data-holddelete="faq"/.test(draw(X.FEdit, { demo: {}, id: "q1", init: FQ[0], role: "owner", onClose(){} })) &&
    !/data-holddelete/.test(draw(X.FEdit, { demo: {}, id: "q1", init: FQ[0], role: "helper", onClose(){} })));

  // the menu: About Time Tracker sits under User Manual
  const appSrc = src;
  t("the manual group offers Guides, FAQ, then About Time Tracker", /label:"Guides"[\s\S]{0,200}label:"FAQ"[\s\S]{0,400}label:"About Time Tracker"/.test(appSrc));
  t("closing everything closes About", /function closeAllPopups\(\)\{[\s\S]{0,600}setShowAbout\(false\)/.test(appSrc));

  const bad = res.filter((x) => !x[1]);
  bad.forEach((x) => console.log("FAIL", x[0]));
  console.log("feedback   : " + (res.length - bad.length) + "/" + res.length + " passed");
  process.exit(bad.length ? 1 : 0);
})().catch((e) => { console.log("CRASH", e && e.stack); process.exit(1); });
