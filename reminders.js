// reminders.js - reminders & nudges (11-12): the engine and its sheets.
//   TZ=America/Los_Angeles node reminders.js /tmp/app_only.js
// Every time below is local wall-clock time; the dates are in November 2026
// (after the clocks went back), Monday 16th onwards.
process.env.TZ = process.env.TZ || "America/Los_Angeles";
const fs = require("fs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const win = { addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; } };
const mem = new Map();
const localStorage = { get length(){ return mem.size; }, key: (i) => Array.from(mem.keys())[i],
  getItem: (k) => (mem.has(String(k)) ? mem.get(String(k)) : null), setItem: (k, v) => mem.set(String(k), String(v)), removeItem: (k) => mem.delete(String(k)) };
const navigator = { vibrate(){}, onLine: true };
const document = { addEventListener(){}, removeEventListener(){}, getElementById: () => null };
const src = fs.readFileSync(process.argv[2] || "/tmp/app_only.js", "utf8");
const X = new Function("React", "window", "localStorage", "navigator", "document", "Event",
  src + "\nreturn { norm: normalizeRemind, chipAt: remindChipAt, deliverAt: remindDeliverAt, chipsOf: remindChipsOf, words: remindWords," +
        " own: ownOccurrences, occ: reminderOccurrences, due: dueReminders, nudges: dueNudges, shiftOnDay: shiftOnDay, shiftBefore: shiftBefore," +
        " inShift: inShift, next: nextShiftStart, reset: resetApply, Block: RemindBlock, Rem: ReminderModal, Timing: RemindTimingModal, Away: AwayModal," +
        " help: helpAll, setCfg: function(c){ REMIND_CFG = c; } };")(React, win, localStorage, navigator, document, function Event(t){ return { type: t }; });

const res = []; const t = (l, p) => res.push([l, !!p]);
const at = (d, hh, mm) => new Date(2026, 10, d, hh, mm || 0, 0, 0).getTime();   // Nov d, local
const H = 3600000, M = 60000, D = 86400000;
const day = (on, s, e) => ({ on, start: s, end: e });
// Monday-Friday 06:00-14:30; weekend off
const SCH = { mon: day(true, "06:00", "14:30"), tue: day(true, "06:00", "14:30"), wed: day(true, "06:00", "14:30"), thu: day(true, "06:00", "14:30"),
  fri: day(true, "06:00", "14:30"), sat: day(false, "06:00", "14:30"), sun: day(false, "06:00", "14:30") };
// a night shift: Monday-Thursday 21:00-05:30
const NIGHT = { mon: day(true, "21:00", "05:30"), tue: day(true, "21:00", "05:30"), wed: day(true, "21:00", "05:30"), thu: day(true, "21:00", "05:30"),
  fri: day(false, "", ""), sat: day(false, "", ""), sun: day(false, "", "") };
const cfg = X.norm(null);

// ---- the defaults ----
t("default timing: start of that shift and 1 day before", JSON.stringify(cfg.due) === '["shift","1d"]');
t("hold is off by default", cfg.hold === false);
t("nudges by default: not clocked in (15 min), running at end, late out (1h) on; long job (4h) off",
  cfg.nudges.noIn.on && cfg.nudges.noIn.mins === 15 && cfg.nudges.runEnd.on && cfg.nudges.lateOut.on && cfg.nudges.lateOut.hrs === 1 && !cfg.nudges.long.on && cfg.nudges.long.hrs === 4);
t("unknown chips are dropped, an empty choice is kept", JSON.stringify(X.norm({ due: ["1d", "bogus"] }).due) === '["1d"]' && X.norm({ due: [] }).due.length === 0);
t("out-of-range amounts fall back", X.norm({ nudges: { long: { hrs: 99 }, noIn: { mins: 1 } } }).nudges.long.hrs === 4 && X.norm({ nudges: { noIn: { mins: 1 } } }).nudges.noIn.mins === 15);

// ---- shifts ----
t("a day shift starts and ends where the schedule says", X.shiftOnDay(SCH, at(16, 12)).start === at(16, 6) && X.shiftOnDay(SCH, at(16, 12)).end === at(16, 14, 30));
t("a day off has no shift", X.shiftOnDay(SCH, at(21, 12)) === null);
t("a night shift ends the next morning", X.shiftOnDay(NIGHT, at(16, 12)).end === at(17, 5, 30));
t("at 03:00 Tuesday you are in Monday's night shift", X.inShift(NIGHT, at(17, 3)) && X.shiftBefore(NIGHT, at(17, 3)).start === at(16, 21));
t("at 12:00 Tuesday you are not", !X.inShift(NIGHT, at(17, 12)));
t("the next shift after Friday's ends is Monday's", X.next(SCH, at(20, 15)) === at(23, 6));

// ---- chips ----
const T = at(18, 12);   // due Wednesday 12:00
t("at the time", X.chipAt("at", T, SCH) === T);
t("1 hour before", X.chipAt("1h", T, SCH) === T - H);
t("1 day before", X.chipAt("1d", T, SCH) === T - D);
t("1 week before", X.chipAt("1w", T, SCH) === T - 7 * D);
t("start of that shift: 06:00 the same day", X.chipAt("shift", T, SCH) === at(18, 6));
t("due before that day's shift starts: the shift before it", X.chipAt("shift", at(18, 5), SCH) === at(17, 6));
t("due on a Saturday: Friday's shift", X.chipAt("shift", at(21, 10), SCH) === at(20, 6));
t("due at 02:00 inside a night shift: that night's start", X.chipAt("shift", at(17, 2), NIGHT) === at(16, 21));
t("no schedule at all: the shift chip simply doesn't fire", X.chipAt("shift", T, null) === null);

// ---- hold until my shift ----
t("held: off-shift waits for the next shift start", X.deliverAt(at(18, 20), SCH, true) === at(19, 6));
t("held: in-shift goes straight out", X.deliverAt(at(18, 9), SCH, true) === at(18, 9));
t("not held: off-shift goes straight out", X.deliverAt(at(18, 20), SCH, false) === at(18, 20));

// ---- a record's rule ----
t("no rule = the default", JSON.stringify(X.chipsOf(null, cfg)) === '["shift","1d"]');
t("off = nothing", X.chipsOf({ off: true, chips: ["1h"] }, cfg) === null);
t("its own chips", JSON.stringify(X.chipsOf({ chips: ["1h"] }, cfg)) === '["1h"]');
t("in words", X.words(["shift", "1d"]) === "start of that shift and 1 day before" && X.words(["at", "1h", "1w"]) === "at the time, 1 hour before and 1 week before" && X.words([]) === "no times picked");

// ---- own reminders ----
const r1 = { id: "a", label: "Call the supplier", when: "at", at: at(19, 9), repeat: "once", created: at(16, 8) };
t("once: just its time", JSON.stringify(X.own(r1, SCH, at(16, 0), at(25, 0))) === JSON.stringify([at(19, 9)]));
let o = X.own(Object.assign({}, r1, { repeat: "daily" }), SCH, at(16, 0), at(23, 0));
t("daily: every day from its first time", o.length === 4 && o[0] === at(19, 9) && o[3] === at(22, 9));
o = X.own(Object.assign({}, r1, { repeat: "workdays" }), SCH, at(16, 0), at(25, 0));
t("workdays: only days with a shift", o.length === 4 && o.indexOf(at(21, 9)) < 0 && o.indexOf(at(22, 9)) < 0 && o.indexOf(at(23, 9)) >= 0);
o = X.own(Object.assign({}, r1, { repeat: "weekly" }), SCH, at(16, 0), at(30, 0));
t("weekly: the same weekday", o.length === 2 && o[1] === at(26, 9));
o = X.own({ id: "b", label: "x", when: "shiftStart", repeat: "once", created: at(16, 8) }, SCH, at(16, 0), at(25, 0));
t("next shift start, once: the first shift after it was made", o.length === 1 && o[0] === at(17, 6));
o = X.own({ id: "b", label: "x", when: "shiftStart", repeat: "daily", created: at(16, 8) }, SCH, at(16, 0), at(23, 23));
t("shift start, every day: every shift (weekends have none)", o.length === 5 && o[4] === at(23, 6));
o = X.own({ id: "c", label: "x", when: "shiftEnd", repeat: "once", created: at(16, 8) }, SCH, at(16, 0), at(25, 0));
t("before shift ends: 30 minutes before today's end", o.length === 1 && o[0] === at(16, 14));
o = X.own({ id: "c", label: "x", when: "shiftEnd", repeat: "once", created: at(16, 8) }, Object.assign({}, SCH, { mon: day(true, "07:00", "16:00") }), at(16, 0), at(25, 0));
t("move the shift and the reminder moves with it", o[0] === at(16, 15, 30));

// ---- the board ----
const P = (o) => Object.assign({ id: 1, name: "Line 4 Rebuild", lane: "Jobs", kind: "finite", endAt: T, milestones: [], reminders: [] }, o);
let occ = X.occ([P({})], cfg, SCH, at(16, 0), at(25, 0));
t("a finite project's end reminds by the default", occ.length === 2 && occ.some((x) => x.at === at(18, 6)) && occ.some((x) => x.at === T - D));
t("with plain words", /Line 4 Rebuild is due 11\/18\/2026 12:00/.test(occ[0].title));
t("an ongoing project has no end to remind about", X.occ([P({ kind: "ongoing" })], cfg, SCH, at(16, 0), at(25, 0)).length === 0);
t("a closed project reminds nobody", X.occ([P({ closedAt: at(15, 9), reminders: [r1] })], cfg, SCH, at(16, 0), at(25, 0)).length === 0);
t("switched off: nothing", X.occ([P({ remindDue: { off: true } })], cfg, SCH, at(16, 0), at(25, 0)).length === 0);
t("its own chips win", X.occ([P({ remindDue: { chips: ["at"] } })], cfg, SCH, at(16, 0), at(25, 0)).map((x) => x.at).join() === String(T));
const step = { id: "s1", label: "Frame up", dueAt: at(20, 17), targets: [], doneAt: null };
occ = X.occ([P({ kind: "ongoing", milestones: [step, Object.assign({}, step, { id: "s2", doneAt: at(19, 9) })] })], cfg, SCH, at(16, 0), at(25, 0));
t("a milestone step reminds by the default; a met step doesn't", occ.length === 2 && occ.every((x) => x.key.indexOf("ms|1|s1|") === 0));
t("a step can be switched off", X.occ([P({ kind: "ongoing", milestones: [Object.assign({}, step, { remind: { off: true } })] })], cfg, SCH, at(16, 0), at(25, 0)).length === 0);
occ = X.occ([P({ kind: "ongoing", reminders: [r1] })], cfg, SCH, at(16, 0), at(25, 0));
t("own reminders come with the project's name", occ.length === 1 && occ[0].title === "Call the supplier" && occ[0].body === "Line 4 Rebuild");

// ---- due now: fresh, late, fired ----
const board = [P({ kind: "ongoing", reminders: [r1] })];
let d = X.due(board, cfg, SCH, at(19, 9, 1), {});
t("found within a few minutes: fires now", d.fresh.length === 1 && d.late.length === 0);
d = X.due(board, cfg, SCH, at(19, 11), {});
t("found later: it came due while the app was closed", d.fresh.length === 0 && d.late.length === 1);
d = X.due(board, cfg, SCH, at(19, 9, 1), { ["rem|1|a|" + at(19, 9)]: 1 });
t("once fired, never again", d.fresh.length + d.late.length === 0);
d = X.due(board, cfg, SCH, at(19, 8, 59), {});
t("not yet due: nothing", d.fresh.length + d.late.length === 0);
d = X.due(board, cfg, SCH, at(27, 9), {});
t("older than a week: dropped, not dredged up", d.fresh.length + d.late.length === 0);
d = X.due(board, cfg, SCH, at(19, 11), {}, at(19, 8));
t("came due since the last look: reported", d.late.length === 1);
d = X.due(board, cfg, SCH, at(19, 11), {}, at(19, 10));
t("came due before the last look (entered already past): not reported as missed", d.fresh.length + d.late.length === 0);
d = X.due(board, cfg, SCH, at(19, 11), {}, null);
t("the first look on a device reports nothing", d.fresh.length + d.late.length === 0);
const evening = [P({ kind: "ongoing", reminders: [Object.assign({}, r1, { at: at(19, 19) })] })];
d = X.due(evening, X.norm({ hold: true }), SCH, at(19, 19, 1), {});
t("held: an evening reminder isn't due in the evening", d.fresh.length + d.late.length === 0);
d = X.due(evening, X.norm({ hold: true }), SCH, at(20, 6, 1), {});
t("it arrives at the next shift start", d.fresh.length === 1 && d.fresh[0].deliverAt === at(20, 6));

// ---- nudges ----
const N = (st, now, c) => X.nudges(st, c || cfg, SCH, now, {});
t("15 minutes into the shift, not clocked in: nudge", N({ clocked: false }, at(16, 6, 15)).some((x) => x.key.indexOf("nudge|noin|") === 0));
t("10 minutes in: not yet", !N({ clocked: false }, at(16, 6, 10)).some((x) => /noin/.test(x.key)));
t("clocked in: no nudge", !N({ clocked: true }, at(16, 7)).some((x) => /noin/.test(x.key)));
t("after the shift: no not-clocked-in nudge", !N({ clocked: false }, at(16, 15)).some((x) => /noin/.test(x.key)));
t("on a day off: none", N({ clocked: false }, at(21, 9)).length === 0);
t("a job still running after the shift ends: nudge", N({ clocked: true, activeId: 1, activeStart: at(16, 13), activeName: "Press" }, at(16, 14, 31)).some((x) => /runend/.test(x.key) && /Press/.test(x.title)));
t("still clocked in an hour after the end: nudge", N({ clocked: true }, at(16, 15, 31)).some((x) => /late/.test(x.key)));
t("half an hour after: not yet", !N({ clocked: true }, at(16, 15)).some((x) => /late/.test(x.key)));
const longOn = X.norm({ nudges: { long: { on: true, hrs: 2 } } });
t("one job over the set hours (when on): nudge, once per run", N({ clocked: true, activeId: 1, activeStart: at(16, 7), activeName: "Press" }, at(16, 9, 1), longOn).some((x) => x.key === "nudge|long|" + at(16, 7)));
t("long-job nudge is off by default", !N({ clocked: true, activeId: 1, activeStart: at(16, 7) }, at(16, 13)).some((x) => /long/.test(x.key)));
t("a nudge fired once isn't repeated", X.nudges({ clocked: false }, cfg, SCH, at(16, 6, 30), { ["nudge|noin|" + at(16, 6)]: 1 }).length === 0);
t("switched off: none", N({ clocked: false }, at(16, 6, 30), X.norm({ nudges: { noIn: { on: false } } })).length === 0);
t("night shift: not clocked in at 21:20 Monday", X.nudges({ clocked: false }, cfg, NIGHT, at(16, 21, 20), {}).some((x) => /noin/.test(x.key)));
t("night shift: still clocked in at 06:31 Tuesday", X.nudges({ clocked: true }, cfg, NIGHT, at(17, 6, 31), {}).some((x) => /late/.test(x.key)));

// ---- resetting the board takes its reminders ----
const st = new Map([["tt_projects", "[]"], ["tt_remind_fired", "{}"], ["tt_remind_away", "[]"]]);
const store = { getItem: (k) => (st.has(k) ? st.get(k) : null), setItem: (k, v) => st.set(k, v), removeItem: (k) => st.delete(k) };
X.reset({ projects: true }, store);
t("start-over clears reminder state with the projects", !st.has("tt_remind_fired") && !st.has("tt_remind_away"));

// ---- the sheets ----
const nop = () => {};
const R = (el) => { try { return renderToStaticMarkup(el); } catch (e) { return "ERR:" + e.message; } };
X.setCfg(cfg);
let h = R(React.createElement(X.Block, { hasDue: true, rule: null, onRule: nop, reminders: [r1], onReminders: nop }));
t("Remind me: the switch is on and says it follows your default", /data-reminddue="on"/.test(h) && /Using your default/.test(h) && /start of that shift and 1 day before/.test(h) && /role="switch" aria-checked="true"/.test(h));
t("with Change, the reminder listed, and + Add", /data-remindchange/.test(h) && /Call the supplier/.test(h) && /once/.test(h) && /\+ Add a reminder/.test(h));
h = R(React.createElement(X.Block, { hasDue: true, rule: { off: true }, onRule: nop, reminders: [], onReminders: nop }));
t("switched off: says so, at the same height", /data-reminddue="off"/.test(h) && /No reminders before it ends/.test(h) && /aria-checked="false"/.test(h));
const hOn = R(React.createElement(X.Block, { hasDue: true, rule: null, onRule: nop, reminders: [], onReminders: nop }));
t("the words box keeps one height on or off", (hOn.match(/min-height:2\.2rem/g) || []).length === 1 && (h.match(/min-height:2\.2rem/g) || []).length === 1);
h = R(React.createElement(X.Block, { hasDue: true, rule: { chips: ["1h"] }, onRule: nop, reminders: [], onReminders: nop }));
t("its own timing reads 'Just this one'", /Just this one/.test(h) && /1 hour before/.test(h));
h = R(React.createElement(X.Block, { hasDue: false, noDueHint: "Set an end date to be reminded before it ends.", rule: null, onRule: nop, reminders: [], onReminders: nop }));
t("no end date: a hint instead of the switch", !/data-reminddue/.test(h) && /Set an end date/.test(h));
h = R(React.createElement(X.Block, { hasDue: true, own: false, rule: null, onRule: nop }));
t("a milestone step: the switch, no own reminders", /data-reminddue/.test(h) && !/Add a reminder/.test(h));
h = R(React.createElement(X.Rem, { reminder: {}, onSave: nop, onCancel: nop }));
t("a new reminder: what, when (three ways), date and time, repeat (four)", /data-reminderlabel/.test(h) && /Date &amp; time/.test(h) && /Shift start/.test(h) && /Shift end/.test(h) && /type="date"/.test(h) && /type="time"/.test(h) && (h.match(/data-chip="(once|daily|workdays|weekly)"/g) || []).length === 4);
t("no Delete on a new one", !/data-reminderdelete/.test(h));
h = R(React.createElement(X.Rem, { reminder: {}, itemName: "Line 4 Rebuild", onSave: nop, onCancel: nop }));
t("a new reminder starts with the item's name, ready to keep or replace", /<input data-reminderlabel="true"[^>]*value="Line 4 Rebuild"/.test(h) && /Keep the name, or type something of your own/.test(h));
h = R(React.createElement(X.Rem, { reminder: { id: "x", label: "Order seals", when: "at", at: at(19, 9), repeat: "once" }, itemName: "Line 4 Rebuild", onSave: nop, onCancel: nop }));
t("an existing reminder keeps its own words", /value="Order seals"/.test(h) && !/Keep the name/.test(h));
h = R(React.createElement(X.Rem, { reminder: { id: "x", label: "Order seals", when: "shiftStart", repeat: "daily" }, onSave: nop, onDelete: nop, onCancel: nop }));
t("a shift reminder says it follows the schedule; Delete is held", /follows your Work Schedule/.test(h) && /data-reminderdelete/.test(h) && /data-holddelete/.test(h) && /data-chip="daily" aria-pressed="true"/.test(h));
h = R(React.createElement(X.Timing, { rule: null, onSave: nop, onCancel: nop }));
t("timing sheet: My default / Just this one, the default in words", /My default/.test(h) && /Just this one/.test(h) && /start of that shift and 1 day before/.test(h) && /min-height:7\.6rem/.test(h));
h = R(React.createElement(X.Away, { items: [{ key: "k2", title: "B", body: "", pid: 1, at: at(19, 11) }, { key: "k1", title: "A", body: "Line 4", pid: 1, at: at(19, 9) }], onOpen: nop, onDone: nop }));
t("While you were away: count, oldest first, Open on each, Done", /While you were away · 2/.test(h) && h.indexOf('data-awayitem="k1"') < h.indexOf('data-awayitem="k2"') && (h.match(/data-awayopen/g) || []).length === 2 && />Done</.test(h) && />Later</.test(h));

// ---- the manual ----
const HA = X.help();
const txt = JSON.stringify(HA);
t("the manual explains reminders", /remind/i.test(txt) && Object.keys(HA.guides).some((k) => (HA.guides[k].covers || []).indexOf("Reminders & nudges") >= 0 || k === "reminders"));
t("no digits in the reminders help prose", HA.guides.reminders && HA.guides.reminders.steps.every((s) => !/\d/.test(s.text + s.title)));

let bad = 0;
res.forEach(([l, p]) => { if (!p) { bad++; console.log("   x " + l); } });
console.log("reminders  : " + (res.length - bad) + "/" + res.length + " passed" + (bad ? "  FAILED" : ""));
process.exit(bad ? 1 : 0);
