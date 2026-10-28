// shift.js - drive the work-day rules across a midnight boundary.
// The static suite proves the engine; boot.js proves the screens render. This
// proves the thing Brent actually reported: a shift that crosses midnight keeps
// its numbers, and the next shift starts clean.
const fs = require("fs");
const React = require("react");
const src = fs.readFileSync(process.argv[2] || "/tmp/app_only.js", "utf8");
const win = { addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return true; } };
const map = new Map();
const localStorage = {
  get length(){ return map.size; }, key: (i) => Array.from(map.keys())[i],
  getItem: (k) => (map.has(String(k)) ? map.get(String(k)) : null),
  setItem: (k, v) => map.set(String(k), String(v)), removeItem: (k) => map.delete(String(k)),
};
const navigator = { vibrate(){} };
const document = { addEventListener(){}, removeEventListener(){}, getElementById: () => null };
const out = new Function("React", "window", "localStorage", "navigator", "document", "Event",
  src + "\nreturn { shiftContext, shiftChoices, autoWorkDay, recordDay, workDayOf," +
        " normalizeGrace, shiftWindow, adjacentShiftDay, normalizeSchedule," +
        " shiftSpan, schMinutes, schNetMinutes, schWraps," +
        " scheduledMinutes, scheduledToDate, logIsOt, buildRollup," +
        " overtimeByWeek, OT_CHOICES };")(
  React, win, localStorage, navigator, document, function (t){ return { type: t }; });

const ok = [];
const t = (label, pass) => ok.push([label, pass]);

// A real night shift: Mon-Fri 21:00 to 05:30, entered exactly as Brent would
// type it. Earlier builds could not store this at all - an end before its start
// read as no shift, so every clock-in got the day-off prompt.
const nights = out.normalizeSchedule({
  mon:{on:true,start:"21:00",end:"05:30"}, tue:{on:true,start:"21:00",end:"05:30"},
  wed:{on:true,start:"21:00",end:"05:30"}, thu:{on:true,start:"21:00",end:"05:30"},
  fri:{on:true,start:"21:00",end:"05:30"}, sat:{on:false}, sun:{on:false}
});
t("the schedule accepts a shift typed as 21:00 to 05:30", out.schMinutes(nights.wed) === 510);
t("and knows it lands on the next day", out.schWraps(nights.wed) === true);
const WED_2100 = new Date(2026, 7, 19, 21, 0).getTime();
const THU_0130 = new Date(2026, 7, 20, 1, 30).getTime();
const THU_0400 = new Date(2026, 7, 20, 4, 0).getTime();

// ---- clocking in at 21:00 Wednesday is inside the window: no question ----
t("a 21:00 start on a night schedule asks nothing",
  out.autoWorkDay(nights, WED_2100, 0) === out.workDayOf(WED_2100));
t("and files under Wednesday",
  out.autoWorkDay(nights, WED_2100, 0) === new Date(2026, 7, 19).toDateString());

// ---- 01:30 Thursday is mid-shift now, so nothing is asked at all ----
const ctx = out.shiftContext(nights, THU_0130, 0);
t("01:30 on Thursday is inside Wednesday's shift", ctx.position === "inside");
t("owned by Wednesday", ctx.owner && ctx.owner.getDate() === 19);
t("so no question is asked",
  out.autoWorkDay(nights, THU_0130, 0) === new Date(2026, 7, 19).toDateString());
t("even though the clock says Thursday",
  out.workDayOf(THU_0130) === new Date(2026, 7, 20).toDateString());

// ---- 06:30, after the shift finished, is where the question belongs ----
const THU_0630 = new Date(2026, 7, 20, 6, 30).getTime();
const late2 = out.shiftContext(nights, THU_0630, 0);
t("06:30 is past the finish and before Thursday's own start", late2.position === "before");
const choices = out.shiftChoices(late2);
t("and the two answers are the shifts either side", choices.length === 2);
t("the previous one being Wednesday",
  new Date(choices[0].when).getDate() === 19 && choices[0].label === "Previous shift");
t("the upcoming one being Thursday", new Date(choices[1].when).getDate() === 20);

// ---- the session carries Wednesday across midnight ----
// This is the crux: records made at 01:30 while the Wednesday session is live
// are stamped Wednesday, so the board keeps showing the shift being worked.
const WED = new Date(2026, 7, 19).toDateString();
const THU = new Date(2026, 7, 20).toDateString();
const sessionDay = WED;
const madeAtHalfOne = { startTime: THU_0130, day: sessionDay, duration: 900000, endTime: THU_0130 + 900000 };
t("a record made after midnight on Wednesday's shift files under Wednesday",
  out.recordDay(madeAtHalfOne) === WED);
t("and would have been misfiled under Thursday by the timestamp alone",
  out.workDayOf(THU_0130) === THU);

// ---- the next shift starts clean ----
const yesterdays = [
  { startTime: WED_2100, day: WED, endTime: WED_2100 + 1, duration: 600000 },
  { startTime: THU_0130, day: WED, endTime: THU_0130 + 1, duration: 300000 }
];
const todays = yesterdays.filter((d) => out.recordDay(d) === THU);
t("nothing from Wednesday's shift leaks into Thursday's slate", todays.length === 0);
t("while Wednesday still has both of its records",
  yesterdays.filter((d) => out.recordDay(d) === WED).length === 2);

// ---- 04:00 is an hour and a half before the finish: still on shift ----
t("a 04:00 clock-in is mid-shift and asks nothing",
  out.autoWorkDay(nights, THU_0400, 0) === new Date(2026, 7, 19).toDateString());
t("unpaid breaks sit inside the shift, not twenty hours away",
  out.schNetMinutes(out.normalizeSchedule({
    mon:{on:true,start:"21:00",end:"05:30"}, tue:{on:true,start:"21:00",end:"05:30"},
    wed:{on:true,start:"21:00",end:"05:30"}, thu:{on:true,start:"21:00",end:"05:30"},
    fri:{on:true,start:"21:00",end:"05:30"}, sat:{on:false}, sun:{on:false},
    unpaidBreaks:{ enabled:true, weekly:[{id:"b",name:"Lunch",start:"01:00",mins:30}], custom:{} }
  }), "wed") === 480);

// ---- day shift, for contrast ----
const days = out.normalizeSchedule({
  mon:{on:true,start:"06:00",end:"14:30"}, tue:{on:true,start:"06:00",end:"14:30"},
  wed:{on:true,start:"06:00",end:"14:30"}, thu:{on:true,start:"06:00",end:"14:30"},
  fri:{on:true,start:"06:00",end:"14:30"}, sat:{on:false}, sun:{on:false}
});
const WED_0550 = new Date(2026, 7, 19, 5, 50).getTime();
t("arriving ten minutes early asks by default",
  out.autoWorkDay(days, WED_0550, 0) === null);
t("but not once grace is set to fifteen minutes",
  out.autoWorkDay(days, WED_0550, 15) === out.workDayOf(WED_0550));
t("grace is clamped and coerced", out.normalizeGrace(-5) === 0 && out.normalizeGrace("x") === 0
  && out.normalizeGrace(9999) === 240);

// ---- pace against a wrapping shift ----
// scheduledToDate credits a shift as it is worked. On a night shift the hours
// before 21:00 belong to yesterday, and crediting them twice would show the
// day already half done before anyone clocked on.
const WED_0000 = new Date(2026, 7, 19).getTime();
const THU_0000 = new Date(2026, 7, 20).getTime();
t("a night shift contributes its full length to the day it starts on",
  out.scheduledMinutes(nights, WED_0000, THU_0000) === 510);
t("at noon on Wednesday none of it has been worked",
  out.scheduledToDate(nights, WED_0000, THU_0000, new Date(2026, 7, 19, 12, 0).getTime()) === 0);
t("at 23:00 two hours are behind you",
  out.scheduledToDate(nights, WED_0000, THU_0000, new Date(2026, 7, 19, 23, 0).getTime()) === 120);
t("and by the end of the window all of it is",
  out.scheduledToDate(nights, WED_0000, THU_0000, THU_0000) === 510);
// The same figures for a day shift, unchanged by any of this.
const dayPace = out.normalizeSchedule({
  mon:{on:true,start:"06:00",end:"14:30"}, tue:{on:true,start:"06:00",end:"14:30"},
  wed:{on:true,start:"06:00",end:"14:30"}, thu:{on:true,start:"06:00",end:"14:30"},
  fri:{on:true,start:"06:00",end:"14:30"}, sat:{on:false}, sun:{on:false}
});
t("a day shift still paces the way it always did",
  out.scheduledToDate(dayPace, WED_0000, THU_0000, new Date(2026, 7, 19, 10, 0).getTime()) === 240);
t("and shows nothing before it starts",
  out.scheduledToDate(dayPace, WED_0000, THU_0000, new Date(2026, 7, 19, 3, 0).getTime()) === 0);
t("pace stops at the length of the shift and does not run on into the evening",
  out.scheduledToDate(dayPace, WED_0000, THU_0000, new Date(2026, 7, 19, 20, 0).getTime()) === 510);

// ---- a Saturday call-out ----
// Saturday is not on the roster, so the prompt offers the day itself alongside
// its neighbours, and then has to ask how it is paid: otDays cannot know about
// a one-off.
const satCtx = out.shiftContext(days, new Date(2026, 7, 22, 8, 0).getTime(), 0);
const satChoices = out.shiftChoices(satCtx);
t("a Saturday call-out offers three answers", satChoices.length === 3);
t("with the day itself leading",
  satChoices[0].label === "This day" && new Date(satChoices[0].when).getDate() === 22);
t("flagged off-roster", satChoices[0].unscheduled === true);
t("and Friday and Monday still available",
  new Date(satChoices[1].when).getDate() === 21 && new Date(satChoices[2].when).getDate() === 24);
t("the pay question has exactly two answers", out.OT_CHOICES.length === 2);
t("regular and overtime",
  out.OT_CHOICES[0].ot === false && out.OT_CHOICES[1].ot === true);

// ---- how that answer reaches the pay figures ----
const SAT = new Date(2026, 7, 22).toDateString();
const FRI = new Date(2026, 7, 21).toDateString();
const satLog = (ot) => ({ id: "x", type: "project", projectId: 1, projectName: "P", lane: "L",
  startTime: new Date(2026, 7, 22, 9, 0).getTime(), endTime: new Date(2026, 7, 22, 13, 0).getTime(),
  duration: 4 * 3600000, day: SAT, ot: ot });

t("an unstamped log still follows the otDays setting",
  out.logIsOt({ startTime: new Date(2026, 7, 22, 9, 0).getTime() }, { sat: 1 }) === true);
t("and is regular when its weekday is not an overtime day",
  out.logIsOt({ startTime: new Date(2026, 7, 22, 9, 0).getTime() }, {}) === false);
t("declaring overtime beats a setting that says otherwise",
  out.logIsOt(satLog(true), {}) === true);
t("and declaring regular beats a setting that says overtime",
  out.logIsOt(satLog(false), { sat: 1 }) === false);
t("null is not an answer and falls through to the setting",
  out.logIsOt({ startTime: new Date(2026, 7, 22, 9, 0).getTime(), ot: null }, { sat: 1 }) === true);

// The weekday now comes off the work day, not the timestamp. A log made at
// 02:00 Saturday on Friday night's shift is a Friday log for pay.
t("a night-shift log after midnight is paid by the shift it belongs to",
  out.logIsOt({ startTime: new Date(2026, 7, 22, 2, 0).getTime(), day: FRI }, { sat: 1 }) === false);
t("and would have been counted as Saturday overtime by its timestamp alone",
  out.logIsOt({ startTime: new Date(2026, 7, 22, 2, 0).getTime() }, { sat: 1 }) === true);

// ---- end to end through the rollup ----
const range = { start: new Date(2026, 7, 17).getTime(), end: new Date(2026, 7, 24).getTime() };
const roll = (logs, otDays) => out.buildRollup({ logs: logs, projects:
  [{ id: 1, name: "P", lane: "L", parentId: null }], range: range, otDays: otDays, lanes: ["L"] });
t("a declared-overtime Saturday shows four hours of overtime",
  roll([satLog(true)], []).otMs === 4 * 3600000);
t("a declared-regular Saturday shows none, even with Saturday set as an OT day",
  roll([satLog(false)], ["sat"]).otMs === 0);
t("and both still count as tracked time either way",
  roll([satLog(true)], []).trackedMs === 4 * 3600000 &&
  roll([satLog(false)], ["sat"]).trackedMs === 4 * 3600000);
t("the weekly overtime split sees the declared hours too",
  out.overtimeByWeek([satLog(true)], range, [], "mon").reduce((a, w) => a + w.otMs, 0) === 4 * 3600000);
t("and excludes the ones declared regular",
  out.overtimeByWeek([satLog(false)], range, ["sat"], "mon").length === 0);

let bad = 0;
ok.forEach(([label, pass]) => { if (!pass) { bad++; console.log("   x " + label); } });
console.log("shift      : " + (ok.length - bad) + "/" + ok.length + " passed" + (bad ? "  FAILED" : ""));
process.exit(bad ? 1 : 0);
