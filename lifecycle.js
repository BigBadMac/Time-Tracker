// lifecycle.js - project types and closing out, driven against the built file.
// The rules are pure, so they run for real here rather than being asserted at
// with a regex: what is a task, what blocks a close, what the board still sees.
const fs = require("fs");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
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
  src + "\nreturn { projKind, isClosed, isOpen, stagesAllDone, readyToClose, closeBlockers," +
        " canClose, openProjects, getChildren, getDescendantIds, buildRollup," +
        " ArchiveModal, CloseProjectModal, ProjectForm, inheritedKind," +
        " mismatchedTasks, MatchTasksModal, findProj," +
        " projDepth, subtreeDepth, canNestUnder, nestTargets, MAX_NEST_DEPTH," +
        " projRole, isTaskRole, isProjectRole, projectStackOrder, stackZ," +
        " projStart, projEnd, joinDateTime, tsDateStr, tsTimeStr," +
        " isPending, isOverdue, schedText, SchedChip, StartAheadModal, ProjectCard," +
        " startAction, " +
        " ModalGlyph, MenuIcon, MENU_GLYPHS, readableInk, contrastOf, hexRGB," +
        " outlineRows, outlineSpan, outlineCommit, outlineApply, newProjectId, uid, ttStamp, saveTracked, ttDbUse, load, TT_TRACKED, TT_GONE_MAX, " +
        " normalizeSchedule, schNetMinutes, breakAllowanceMins, breakDayState, breakOverFor, breakPaidMs, paidBreakLogs, missedBreakDue, breakDueAt, BREAK_DEFAULTS, PRESET_BREAKS, BREAK_RULES_NOTE, logIsOt, " +
        " stepUp, stepDown, stepIn, stepOut, stepOptions, prevSibling, nextSibling, parentIndex, nestRoles, mergeOutline," +
        " worstStatus, stepActual, stepStatus, stepPoint, aggregatePoint, hasMilestonesBeneath, projectLine, projectCurrent," +
        " laneLine, laneCurrent, boardLine, lineSpan, tickUnit, groupMarks, MS_DAY, subtreePoints, tickScale, lineTicks, arcHeight, driftArcs, driftHeadroom, MS_ZOOMS, zoomAt, nextZoom, zoomSpan, panSpan, milestoneReport," +
        " snapIsBoardKey, snapCollect, snapSummary, snapModuleOf, snapIdsFor, snapPrune, snapApplyLoad, snapCloseOpen," +
        " daySummaryTree, resetApply, resetNormalize, resetPickOf, resetFromPick, RESET_PICKS, settingsFactory, ttModules, SNAP_KEEP, SNAP_MANUAL_MAX };")(
  React, win, localStorage, navigator, document, function (t){ return { type: t }; });

const ok = [];
const t = (label, pass) => ok.push([label, pass]);
const has = (h, n, label) => t(label, h.indexOf(n) >= 0);

// ---- an absent field means the old behaviour ----
// Every project that exists today has neither kind nor closedAt. If these
// defaults are wrong, every existing project changes behaviour on upgrade.
const legacy = { id: 1, name: "Label Printing", lane: "Daily Activity", parentId: null, stages: [] };
t("a project with no kind is ongoing", out.projKind(legacy) === "ongoing");
t("a project with no closedAt is open", out.isOpen(legacy) === true);
t("garbage in the kind field is still ongoing", out.projKind({ kind: "banana" }) === "ongoing");
t("and so is a missing project", out.projKind(null) === "ongoing");
t("a non-numeric closedAt does not close anything", out.isOpen({ closedAt: "yes" }) === true);
t("nor does a zero", out.isOpen({ closedAt: 0 }) === true);
t("a real timestamp does", out.isClosed({ closedAt: Date.now() }) === true);

// ---- stages decide when a finite project is done ----
const noStages = { id: 2, kind: "finite", stages: [] };
const part = { id: 3, kind: "finite", stages: [{ done: true }, { done: false }] };
const allDone = { id: 4, kind: "finite", stages: [{ done: true }, { done: true }] };
const ongoingDone = { id: 5, kind: "ongoing", stages: [{ done: true }, { done: true }] };
t("no stages is not the same as all stages done", out.stagesAllDone(noStages) === false);
t("a half-finished checklist is not done", out.stagesAllDone(part) === false);
t("a full one is", out.stagesAllDone(allDone) === true);
t("a finite project with every stage ticked is ready to close", out.readyToClose(allDone) === true);
t("an ongoing project never is, however many stages it has",
  out.readyToClose(ongoingDone) === false);
t("and neither is one already closed",
  out.readyToClose(Object.assign({}, allDone, { closedAt: Date.now() })) === false);
t("a ragged stage entry does not throw",
  out.stagesAllDone({ stages: [null, { done: true }] }) === false);

// ---- open tasks block a close ----
const tree = [
  { id: 10, name: "Safety Report", lane: "Projects", parentId: null, kind: "finite", stages: [] },
  { id: 11, name: "Risk Assessment", lane: "Projects", parentId: 10, kind: "finite", stages: [] },
  { id: 12, name: "Incident Log", lane: "Projects", parentId: 10, kind: "finite", stages: [] },
  { id: 13, name: "Crew Training", lane: "Projects", parentId: null, kind: "ongoing", stages: [] }
];
const parent = tree[0];
t("a parent with two open tasks cannot close", out.canClose(tree, parent).ok === false);
t("and both are named as the reason", out.closeBlockers(tree, parent).length === 2);
const oneClosed = tree.map((p) => (p.id === 11 ? Object.assign({}, p, { closedAt: 1 }) : p));
t("closing one leaves one blocker", out.closeBlockers(oneClosed, parent).length === 1);
const bothClosed = oneClosed.map((p) => (p.id === 12 ? Object.assign({}, p, { closedAt: 1 }) : p));
t("closing both clears the way", out.canClose(bothClosed, parent).ok === true);
t("a project with no tasks was never blocked", out.canClose(tree, tree[3]).ok === true);
t("a task is not blocked by its siblings", out.canClose(tree, tree[1]).ok === true);
t("an already-closed project cannot be closed again",
  out.canClose(bothClosed, Object.assign({}, parent, { closedAt: 1 })).ok === false);

// ---- the board sees open work only; history keeps everything ----
const closedTree = tree.map((p) => (p.id === 13 ? Object.assign({}, p, { closedAt: 1 }) : p));
t("a closed project leaves the board", out.openProjects(closedTree).length === 3);
t("and the ones still open stay", out.openProjects(closedTree).every((p) => p.id !== 13));
t("the full list is untouched", closedTree.length === 4);

// The whole promise of closing out: the logs are still counted.
const range = { start: 0, end: Date.now() + 1000 };
const logs = [
  { id: "a", type: "project", projectId: 13, projectName: "Crew Training", lane: "Projects",
    startTime: 1000, endTime: 2000, duration: 3600000, parentId: null },
  { id: "b", type: "project", projectId: 10, projectName: "Safety Report", lane: "Projects",
    startTime: 1000, endTime: 2000, duration: 1800000, parentId: null }
];
const roll = out.buildRollup({ logs: logs, projects: closedTree, range: range, otDays: [], lanes: ["Projects"] });
t("a closed project's time is still in the rollup", roll.trackedMs === 5400000);

// ---- the archive shows what was closed, with its history ----
let arch = "";
try {
  arch = renderToStaticMarkup(React.createElement(out.ArchiveModal, {
    projects: closedTree, logs: logs, laneMeta: null, onReopen(){}, onClose(){} }));
} catch (e) { arch = "ERR:" + e.message; }
t("the archive renders", arch.indexOf("ERR:") !== 0);
if (arch.indexOf("ERR:") === 0) console.log("   " + arch);
has(arch, "Crew Training", "listing the closed project");
has(arch, "1h 00m", "with the time it accumulated before it closed");
has(arch, "Ongoing", "and what type it was");
has(arch, "Reopen", "and a way back");
t("open projects are not listed", arch.indexOf("Safety Report") < 0);

let empty = "";
try {
  empty = renderToStaticMarkup(React.createElement(out.ArchiveModal, {
    projects: tree, logs: [], laneMeta: null, onReopen(){}, onClose(){} }));
} catch (e) { empty = "ERR:" + e.message; }
has(empty, "Nothing closed out yet", "an empty archive says so");

// ---- the closure sheet asks, rather than refusing ----
// Open children used to be a refusal ("close them first"). The sheet carries
// the decision instead: close them with it, or move them up a level. And it
// asks what happened and when, so a close-out done the next morning can carry
// yesterday's time.
let blocked = "";
try {
  blocked = renderToStaticMarkup(React.createElement(out.CloseProjectModal, {
    proj: parent, blockers: out.closeBlockers(tree, parent), onClose(){}, onConfirm(){} }));
} catch (e) { blocked = "ERR:" + e.message; }
has(blocked, "2 open tasks", "the sheet counts the open children");
has(blocked, "Move", "and offers to move each to a chosen parent");
has(blocked, "Delete", "or to delete it");
has(blocked, "Move all to", "one at a time, or all at once");
has(blocked, "2 still to decide", "and says how many are undecided");
has(blocked, 'disabled=""', "while any are, Complete is disabled");
t("nothing is closed over silently", blocked.indexOf("Close them too") < 0);
t("with no refusal", blocked.indexOf("close them first") < 0);
has(blocked, "Outcome", "it asks what happened");
has(blocked, "Completed", "and when");
has(blocked, "Closure notes", "with somewhere to say why");
let allowed = "";
try {
  allowed = renderToStaticMarkup(React.createElement(out.CloseProjectModal, {
    proj: tree[3], blockers: [], onClose(){}, onConfirm(){} }));
} catch (e) { allowed = "ERR:" + e.message; }
t("with no open children the children section is absent", allowed.indexOf("still to decide") < 0 && allowed.indexOf("data-closekids") < 0);
has(allowed, "Complete", "and the button says Complete");

// ---- the form offers the type ----
let form = "";
try {
  form = renderToStaticMarkup(React.createElement(out.ProjectForm, {
    parents: [], laneMeta: null, defaultLane: "Projects", onSave(){}, onCancel(){} }));
} catch (e) { form = "ERR:" + e.message; }
has(form, "Ongoing", "the form offers ongoing");
has(form, "Has an end", "and finite");
has(form, "never finishes", "explaining which is which");

// ---- a task starts out as whatever its project is ----
const mixed = [
  { id: 20, name: "Safety Report", lane: "Projects", parentId: null, kind: "finite", stages: [] },
  { id: 21, name: "Daily Walk", lane: "Daily Activity", parentId: null, kind: "ongoing", stages: [] },
  { id: 22, name: "Legacy", lane: "Projects", parentId: null, stages: [] }
];
t("a task under a finite project starts finite", out.inheritedKind(mixed, 20) === "finite");
t("a task under an ongoing project starts ongoing", out.inheritedKind(mixed, 21) === "ongoing");
t("a task under a project that predates the field starts ongoing",
  out.inheritedKind(mixed, 22) === "ongoing");
t("a top-level project with no parent starts ongoing", out.inheritedKind(mixed, null) === "ongoing");
t("an unknown parent does not throw", out.inheritedKind(mixed, 999) === "ongoing");
t("and neither does no list at all", out.inheritedKind(null, 20) === "ongoing");

// ---- which tasks disagree with their project ----
const family = [
  { id: 30, name: "Safety Report", lane: "Projects", parentId: null, kind: "finite", stages: [] },
  { id: 31, name: "Risk Assessment", lane: "Projects", parentId: 30, kind: "finite", stages: [] },
  { id: 32, name: "Incident Log", lane: "Projects", parentId: 30, kind: "ongoing", stages: [] },
  { id: 33, name: "Old Task", lane: "Projects", parentId: 30, stages: [] },
  { id: 34, name: "Done Already", lane: "Projects", parentId: 30, kind: "ongoing", closedAt: 1, stages: [] },
  { id: 35, name: "Someone Else", lane: "Projects", parentId: null, kind: "ongoing", stages: [] }
];
const stale = out.mismatchedTasks(family, family[0]);
t("only the tasks that disagree are listed", stale.length === 2);
t("the one explicitly set the other way", stale.some((x) => x.id === 32));
t("and the one with no setting at all, which reads as ongoing", stale.some((x) => x.id === 33));
t("a task already matching is left out", !stale.some((x) => x.id === 31));
t("a closed task is left out - its type is history now", !stale.some((x) => x.id === 34));
t("another project's tasks are not swept in", !stale.some((x) => x.id === 35));
t("a project with no tasks has nothing to reconcile",
  out.mismatchedTasks(family, family[5]).length === 0);
t("and a missing project does not throw", out.mismatchedTasks(family, null).length === 0);

// Flip the project the other way and the disagreement flips with it.
const flipped = family.map((p) => (p.id === 30 ? Object.assign({}, p, { kind: "ongoing" }) : p));
const stale2 = out.mismatchedTasks(flipped, flipped[0]);
t("making the project ongoing makes the finite task the odd one out",
  stale2.length === 1 && stale2[0].id === 31);

let match = "";
try {
  match = renderToStaticMarkup(React.createElement(out.MatchTasksModal, {
    proj: family[0], tasks: stale, onMatch(){}, onLeave(){} }));
} catch (e) { match = "ERR:" + e.message; }
t("the match prompt renders", match.indexOf("ERR:") !== 0);
if (match.indexOf("ERR:") === 0) console.log("   " + match);
has(match, "Has an end", "it says what the project is now");
has(match, "Ongoing", "and what the tasks currently are");
has(match, "Incident Log", "names the tasks that disagree");
has(match, "Old Task", "all of them");
t("offers a select-all row when there is more than one", /select all/i.test(match));
// Everything starts ticked, so that row offers the opposite action.
has(match, "Deselect all", "reading as deselect while everything is ticked");
has(match, "Change 2 Tasks", "and the button counts what is ticked");
has(match, "Cancel", "with a way out");
t("a task that already agrees is not named", match.indexOf("Risk Assessment") < 0);
// Everything starts ticked, so the count on the button equals the task count.
t("every task starts ticked", (match.match(/\u2713/g) || []).length === stale.length + 1);

let one = "";
try {
  one = renderToStaticMarkup(React.createElement(out.MatchTasksModal, {
    proj: flipped[0], tasks: stale2, onMatch(){}, onLeave(){} }));
} catch (e) { one = "ERR:" + e.message; }
has(one, "Change 1 Task", "a single task reads in the singular");
has(one, "is still set", "and so does the sentence");
t("with no select-all row for one task", !/select all/i.test(one));

// ---- adding something new asks what, then where ----
const addable = [
  { id: 40, name: "Label Printing", lane: "Daily Activity", parentId: null, kind: "ongoing" },
  { id: 41, name: "Safety Report", lane: "Projects", parentId: null, kind: "finite" },
  { id: 42, name: "Risk Assessment", lane: "Projects", parentId: 41, kind: "finite" }
];
// The Add New chooser was removed with its menu row (Brent's request): the row
// was its only entry point, so keeping the modal would have left unreachable
// code with state behind it. Adding is still reached from every row menu on
// the board and in the outline.
// ---- nesting a project inside a project ----
// A > B > C, plus a standalone D. Depth is 0,1,2 and 0.
const nest = [
  { id: 50, name: "A", lane: "Projects", parentId: null, order: 0 },
  { id: 51, name: "B", lane: "Projects", parentId: 50, order: 0 },
  { id: 52, name: "C", lane: "Projects", parentId: 51, order: 0 },
  { id: 53, name: "D", lane: "Projects", parentId: null, order: 1 },
  { id: 54, name: "E", lane: "Daily Activity", parentId: null, order: 0 }
];
t("depth is counted from the top", out.projDepth(nest, 50) === 0 && out.projDepth(nest, 52) === 2);
t("a leaf carries nothing below it", out.subtreeDepth(nest, 52) === 0);
t("and a root carries its whole branch", out.subtreeDepth(nest, 50) === 2);
t("an unknown id is depth zero", out.projDepth(nest, 999) === 0);

// The three ways this goes wrong.
t("nothing can be nested inside itself", out.canNestUnder(nest, nest[0], 50) === false);
t("nor inside its own child", out.canNestUnder(nest, nest[0], 51) === false);
t("nor inside its own grandchild - which would cut the branch off the board",
  out.canNestUnder(nest, nest[0], 52) === false);
t("but a sibling is fine", out.canNestUnder(nest, nest[3], 50) === true);
// A shallow pair, where the depth cap has nothing to say and the descendant
// guard is the only thing preventing the loop.
const pair = [
  { id: 60, name: "P", lane: "Projects", parentId: null, order: 0 },
  { id: 61, name: "Q", lane: "Projects", parentId: 60, order: 0 }
];
t("the depth cap would allow P under Q, being shallow enough",
  out.projDepth(pair, 61) + 1 + out.subtreeDepth(pair, 60) <= out.MAX_NEST_DEPTH - 1);
t("but it is still refused, because Q is inside P",
  out.canNestUnder(pair, pair[0], 61) === false);
t("while Q may still be moved out to the top", out.canNestUnder(pair, pair[1], null) === true);
t("and so is moving out to the top", out.canNestUnder(nest, nest[0], null) === true);
t("an unknown target is refused", out.canNestUnder(nest, nest[3], 999) === false);

// The cap counts the subtree that travels with the thing being moved.
t("a leaf can go under C, which is the last legal level",
  out.canNestUnder(nest, nest[3], 52) === true);
const withD = nest.map((p) => (p.id === 53 ? Object.assign({}, p, { parentId: 52 }) : p));
t("but nothing can go below that", out.canNestUnder(withD, nest[4], 53) === false);
t("and a branch two deep cannot go under B, which would put its tail past the cap",
  out.canNestUnder(nest, nest[0], 51) === false);
t("the cap is four levels", out.MAX_NEST_DEPTH === 4);

// The picker.
const targets = out.nestTargets(nest, nest[3], "Projects");
t("the picker walks the tree depth-first", targets.map((x) => x.p.name).join("") === "ABC");
t("indenting each by its depth", targets.map((x) => x.depth).join("") === "012");
t("another lane is not offered", targets.every((x) => x.p.lane === "Projects"));
const selfTargets = out.nestTargets(nest, nest[0], "Projects");
t("a project is never offered itself or its own descendants",
  selfTargets.map((x) => x.p.name).join("") === "D");
const closedOut = nest.map((p) => (p.id === 53 ? Object.assign({}, p, { closedAt: 1 }) : p));
t("a closed project is not offered as a home",
  out.nestTargets(closedOut, nest[0], "Projects").length === 0);
t("a brand new project may go anywhere with room - it excludes nothing",
  out.nestTargets(nest, null, "Projects").map((x) => x.p.name).join("") === "ABCD");

// ---- project or task is its own fact ----
// Inferring it from "has a parent" is what made nesting a project demote it.
t("a root with no role recorded is a project",
  out.projRole({ id: 70, parentId: null }) === "project");
t("a child with no role recorded is a task - which is what it was before",
  out.projRole({ id: 71, parentId: 70 }) === "task");
t("an explicit project stays a project even with a parent",
  out.projRole({ id: 72, parentId: 70, role: "project" }) === "project");
t("an explicit task stays a task", out.projRole({ id: 73, parentId: 70, role: "task" }) === "task");
t("a nonsense role falls back to the old rule",
  out.projRole({ id: 74, parentId: 70, role: "banana" }) === "task");
t("and so does no record at all", out.projRole(null) === "project");
t("the two predicates agree",
  out.isProjectRole({ parentId: null }) && out.isTaskRole({ parentId: 1 }));

// ---- how the cards stack ----
// The order cards appear down the screen is depth-first, and each has to paint
// over everything below it. Depth alone cannot do that: siblings share a depth.
const P = (id, name, parentId, order, role) =>
  ({ id: id, name: name, lane: "Projects", parentId: parentId, order: order || 0,
     role: role || "project" });
const stack = [
  P(80, "Top", null),
  P(81, "First child", 80, 0),
  P(82, "Grandchild", 81, 0),
  P(83, "Second child", 80, 1),
  P(84, "A task", 80, 2, "task")
];
const ord = out.projectStackOrder(stack, 80);
t("the top card ranks first", ord[80] === 0);
t("then its first child", ord[81] === 1);
t("then that child's own nested card, before moving on", ord[82] === 2);
t("and only then the second sibling", ord[83] === 3);
t("a task is not in the stack at all - it draws inside the card", ord[84] === undefined);

t("the top card paints above its first child", out.stackZ(ord, 80) > out.stackZ(ord, 81));
t("which paints above its own grandchild", out.stackZ(ord, 81) > out.stackZ(ord, 82));
t("and an earlier sibling paints above a later one - the case depth got wrong",
  out.stackZ(ord, 81) > out.stackZ(ord, 83));
t("the grandchild still paints above the second sibling, which sits below it",
  out.stackZ(ord, 82) > out.stackZ(ord, 83));
t("every card stays under the lifted-row layer at 70",
  [80, 81, 82, 83].every((id) => out.stackZ(ord, id) < 70));
t("and above the lane behind it", [80, 81, 82, 83].every((id) => out.stackZ(ord, id) > 0));

// A closed project is off the board, so it takes no place in the stack.
const closedMid = stack.map((p) => (p.id === 81 ? Object.assign({}, p, { closedAt: 1 }) : p));
const ord2 = out.projectStackOrder(closedMid, 80);
t("a closed project is skipped", ord2[81] === undefined);
t("and the ranking closes up behind it", ord2[83] === 1);

// The floor, so a very wide tree ties rather than going negative.
const wide = {}; for (let i = 0; i < 200; i++) wide["w" + i] = i;
t("past the range the tail ties instead of falling behind the lane",
  out.stackZ(wide, "w199") === 2 && out.stackZ(wide, "w0") === 60);

// ---- when a project starts, and when it ends ----
// Same rule as kind and closedAt: every project on the board today has neither
// field, and absent has to read as "not recorded" rather than as the epoch.
t("a project with no startAt has no start", out.projStart(legacy) === null);
t("and no end", out.projEnd(legacy) === null);
t("a real timestamp reads back", out.projStart({ startAt: 1755000000000 }) === 1755000000000);
t("zero is not a start", out.projStart({ startAt: 0 }) === null);
t("nor is a string that looks like one", out.projStart({ startAt: "1755000000000" }) === null);
t("nor NaN", out.projStart({ startAt: NaN }) === null);
t("a missing project does not throw", out.projStart(null) === null && out.projEnd(null) === null);
t("the end reads the same way", out.projEnd({ endAt: 1755000000000 }) === 1755000000000);

// ---- a date field and a time field make one moment ----
const jdt = out.joinDateTime;
const mk = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi, 0, 0).getTime();
t("a date and a time join into local wall-clock time",
  jdt("2026-08-26", "14:30") === mk(2026, 8, 26, 14, 30));
t("a date on its own is midnight that morning",
  jdt("2026-08-26", "") === mk(2026, 8, 26, 0, 0));
t("no date is no moment, whatever the time says", jdt("", "14:30") === null);
t("and neither is nothing at all", jdt(null, null) === null);
t("a date the calendar does not have is refused, not rolled into March",
  jdt("2026-02-31", "09:00") === null);
t("February the 29th is fine in a leap year", jdt("2024-02-29", "09:00") === mk(2024, 2, 29, 9, 0));
t("but not in this one", jdt("2026-02-29", "09:00") === null);
t("a malformed date is refused", jdt("26/08/2026", "09:00") === null && jdt("2026-08", "09:00") === null);
t("an out-of-range time falls back to midnight rather than spilling into tomorrow",
  jdt("2026-08-26", "25:00") === mk(2026, 8, 26, 0, 0));
t("and so does a malformed one", jdt("2026-08-26", "banana") === mk(2026, 8, 26, 0, 0));
t("midnight is a real answer, not a missing one", jdt("2026-08-26", "00:00") === mk(2026, 8, 26, 0, 0));

// The round trip the form relies on: a stored moment splits into the two
// fields and joins back to the same moment.
const moment = mk(2026, 8, 26, 6, 5);
t("a stored moment splits into a date string", out.tsDateStr(moment) === "2026-08-26");
t("and a time string, zero-padded", out.tsTimeStr(moment) === "06:05");
t("and joins back to exactly where it started",
  jdt(out.tsDateStr(moment), out.tsTimeStr(moment)) === moment);
t("nothing splits into empty fields", out.tsDateStr(null) === "" && out.tsTimeStr(null) === "");

// ---- the form offers both, and only offers an end when there is one ----
function renderForm(props) {
  try {
    return renderToStaticMarkup(React.createElement(out.ProjectForm,
      Object.assign({ parents: [], laneMeta: null, defaultLane: "Projects",
                      onSave(){}, onCancel(){} }, props)));
  } catch (e) { return "ERR:" + e.message; }
}
const fresh = renderForm({});
t("a new project's form renders", fresh.indexOf("ERR:") !== 0);
if (fresh.indexOf("ERR:") === 0) console.log("   " + fresh);
has(fresh, "Starts", "it asks when the project starts");
has(fresh, "Now", "offering now");
has(fresh, "Pick a date", "or a date picked by hand");
has(fresh, "moment you add it", "and says what Now will stamp");
t("a new project defaults to Now, so no date fields are showing",
  !/type="date"/.test(fresh));
t("and an ongoing project is offered no end at all", fresh.indexOf(">Ends<") < 0);

const finite = renderForm({
  project: { id: 90, name: "Line 4 Rebuild", lane: "Projects", notes: "", parentId: null,
             kind: "finite", role: "project", stages: [],
             startAt: mk(2026, 8, 24, 6, 0), endAt: mk(2026, 9, 4, 14, 30) } });
t("a finite project's form renders", finite.indexOf("ERR:") !== 0);
if (finite.indexOf("ERR:") === 0) console.log("   " + finite);
has(finite, ">Ends<", "a project with an end is asked when");
t("an existing project opens on Pick, never silently restamped",
  (finite.match(/type="date"/g) || []).length === 2);
has(finite, 'value="2026-08-24"', "prefilled with the start it already had");
has(finite, 'value="06:00"', "down to the time");
has(finite, 'value="2026-09-04"', "and with the end it already had");
has(finite, 'value="14:30"', "down to that time too");
t("both fields are pinned at 16px, or iOS zooms and stays zoomed",
  (finite.match(/font-size:16px/g) || []).length >= 4);

// An existing project with nothing recorded must open empty, not on today.
const bare = renderForm({
  project: { id: 91, name: "Daily Walk", lane: "Projects", notes: "", parentId: null,
             kind: "finite", role: "project", stages: [] } });
t("a project with no start on record opens with empty fields",
  bare.indexOf("ERR:") !== 0 && (bare.match(/type="date"[^>]*value=""/g) || []).length === 2);

// ---- what the form hands back ----
// Rendering to markup throws the handlers away, and calling the component bare
// against real React is an invalid hook call. So the payload is evaluated a
// second time against a stub React whose useState just hands back the initial
// value - enough to invoke the component for real and press its own button.
// Rendering to markup throws the handlers away, and calling the component bare
// against real React is an invalid hook call. So the payload is evaluated a
// second time against a stub React with hook cells that survive a re-render -
// enough to type into the form, render it again and press its own button.
let HOOKS = null;
const stubReact = {
  Fragment: "FRAGMENT",
  createElement: function (type, props) {
    const kids = Array.prototype.slice.call(arguments, 2);
    if (typeof type === "function") {
      const p = Object.assign({}, props || {});
      if (kids.length) p.children = kids.length === 1 ? kids[0] : kids;
      return type(p);
    }
    return { type: type, props: props || {}, children: kids };
  },
  useState: (init) => HOOKS.useState(init),
  // Effects are real here: the lane drag registers its scroll-blocking
  // listener from one, and a stub that swallows effects cannot see it.
  useEffect: (fn, deps) => (HOOKS.useEffect ? HOOKS.useEffect(fn, deps) : undefined),
  useRef: (v) => HOOKS.useRef(v)
};
// The payload binds useState/useRef once at the top, so the delegating stubs
// above have to exist before it is evaluated, not after.
const stubOut = new Function("React", "window", "localStorage", "navigator", "document", "Event",
  src + "\nreturn { ProjectForm, StartAheadModal };")(
  stubReact, win, localStorage, navigator, document, function (t){ return { type: t }; });

function mount(props) {
  const cells = [], refs = [];
  let si = 0, ri = 0, got = null;
  HOOKS = {
    useState(init) {
      const k = si++;
      if (cells.length <= k) cells[k] = typeof init === "function" ? init() : init;
      return [cells[k], (v) => { cells[k] = typeof v === "function" ? v(cells[k]) : v; }];
    },
    useRef(v) {
      const k = ri++;
      if (refs.length <= k) refs[k] = { current: v === undefined ? null : v };
      return refs[k];
    }
  };
  const base = Object.assign({ parents: [], laneMeta: null, defaultLane: "Projects",
    onSave(d){ got = d; }, onCancel(){} }, props);
  function render() {
    si = 0; ri = 0;
    const flat = [];
    (function walk(n){
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      flat.push(n);
      walk(n.children);
      walk(n.props && n.props.children);
    })(stubOut.ProjectForm(base));
    return flat;
  }
  return {
    render,
    saved: () => got,
    submit() {
      const btn = render().filter((n) => n.type === "button" && n.props && n.props.onClick &&
        n.children && /^(Add|Save)/.test(String(n.children[0])))[0];
      if (btn) btn.props.onClick();
      return got;
    }
  };
}
function saved(props) { return mount(props).submit(); }
const before = Date.now();
// A brand new project: type a name, leave Starts on its default, add it.
const fresh2 = mount({});
const nameIn = fresh2.render().filter((n) => n.type === "input" &&
  n.props && /Name$/.test(String(n.props.placeholder)))[0];
t("the form has a name field to type into", !!nameIn);
if (nameIn) nameIn.props.onChange({ target: { value: "Line 4 Rebuild" } });
const nowSave = fresh2.submit();
t("a new project saves with the name typed", nowSave && nowSave.name === "Line 4 Rebuild");
t("and with a startAt, because Now is the default",
  nowSave && typeof nowSave.startAt === "number");
t("an ongoing project is saved with no end", nowSave && nowSave.endAt === null);
const withStart = saved({ project: { id: 93, name: "Rebuild", lane: "Projects", notes: "",
  parentId: null, kind: "finite", role: "project", stages: [],
  startAt: mk(2026, 8, 24, 6, 0), endAt: mk(2026, 9, 4, 14, 30) } });
t("a finite project keeps the start it was opened with",
  withStart && withStart.startAt === mk(2026, 8, 24, 6, 0));
t("and the end", withStart && withStart.endAt === mk(2026, 9, 4, 14, 30));
// The end belongs to the type. Switching to ongoing must not leave it behind
// to reappear the next time someone flips the toggle back.
const dropped = saved({ project: { id: 94, name: "Rebuild", lane: "Projects", notes: "",
  parentId: null, kind: "ongoing", role: "project", stages: [],
  startAt: mk(2026, 8, 24, 6, 0), endAt: mk(2026, 9, 4, 14, 30) } });
t("an end left over from when it was finite is cleared, not carried",
  dropped && dropped.endAt === null);
t("while the start survives the type change", dropped && dropped.startAt === mk(2026, 8, 24, 6, 0));
t("Now is read off the clock at save, not at open",
  nowSave && nowSave.startAt >= before && nowSave.startAt <= Date.now());

// ---- a start in the future means the project has not begun ----
const HOUR = 3600000;
const NOW = Date.now();
t("a project with no start is never pending", out.isPending({ id: 1 }, NOW) === false);
t("a start an hour out is pending", out.isPending({ startAt: NOW + HOUR }, NOW) === true);
t("a start an hour ago is not", out.isPending({ startAt: NOW - HOUR }, NOW) === false);
t("the moment itself is not pending - it has arrived",
  out.isPending({ startAt: NOW }, NOW) === false);
t("an end in the future is not overdue", out.isOverdue({ endAt: NOW + HOUR }, NOW) === false);
t("an end in the past on an open project is", out.isOverdue({ endAt: NOW - HOUR }, NOW) === true);
t("but a closed project is history, never overdue",
  out.isOverdue({ endAt: NOW - HOUR, closedAt: NOW }, NOW) === false);
t("and a project with no end never is", out.isOverdue({ id: 1 }, NOW) === false);

// ---- the dates, in words ----
t("a project with no dates says nothing at all", out.schedText({ id: 1 }, NOW).length === 0);
const future = out.schedText({ startAt: NOW + HOUR }, NOW);
t("a start ahead reads as Starts", future.length === 1 && /^Starts /.test(future[0]));
t("and carries the time, because that is the bit that decides", / at /.test(future[0]));
const past = out.schedText({ startAt: NOW - HOUR }, NOW);
t("a start behind reads as Started", past.length === 1 && /^Started /.test(past[0]));
const due = out.schedText({ startAt: NOW - HOUR, endAt: NOW + HOUR }, NOW);
t("both dates show when both are set", due.length === 2 && /^Due /.test(due[1]));
t("an end gone by reads as Overdue",
  /^Overdue /.test(out.schedText({ endAt: NOW - HOUR }, NOW)[1 - 1]));
t("unless it is closed",
  /^Due /.test(out.schedText({ endAt: NOW - HOUR, closedAt: NOW }, NOW)[0]));

// ---- the chip renders, and renders nothing when there is nothing ----
const chip = (p) => { try {
  return renderToStaticMarkup(React.createElement(out.SchedChip, { proj: p })) || "";
} catch (e) { return "ERR:" + e.message; } };
t("a project with no dates paints no chip", chip({ id: 1 }) === "");
has(chip({ startAt: NOW + HOUR }), "Starts", "a scheduled project paints one");
has(chip({ endAt: NOW + HOUR }), "Due", "and so does one with an end");

// ---- the Start button greys out, and stays pressable ----
function card(proj, extra) {
  try {
    return renderToStaticMarkup(React.createElement(out.ProjectCard, Object.assign({
      proj, isActive: false, interrupting: false, todayMs: 0, distToday: 0, distTotal: 0,
      projDisruptions: [], subTasks: [], allProjects: [proj], allDist: [], todayLogs: [],
      todayDist: [], laneMeta: null, elapsed: 0, activeId: null,
      onToggle(){}, onEdit(){}, onStages(){}, onStageToggle(){}, onCloseOut(){}
    }, extra)));
  } catch (e) { return "ERR:" + e.message; }
}
const SP = (over) => Object.assign({ id: 70, name: "Line 4 Rebuild", lane: "Projects",
  notes: "", order: 0, parentId: null, role: "project", kind: "finite", stages: [] }, over);

const ready = card(SP({ startAt: NOW - HOUR }));
t("a started project's card renders", ready.indexOf("ERR:") !== 0);
if (ready.indexOf("ERR:") === 0) console.log("   " + ready);
t("and its Start button is not marked disabled", !/aria-disabled="true"/.test(ready));
has(ready, "Started", "the card shows when it started");

const later = card(SP({ startAt: NOW + 48 * HOUR }));
t("a scheduled project's card renders", later.indexOf("ERR:") !== 0);
if (later.indexOf("ERR:") === 0) console.log("   " + later);
t("its Start button reads as disabled", /aria-disabled="true"/.test(later));
has(later, ">Start<", "but still says Start, and is still a button to press");
has(later, "Starts", "with the date it is waiting for on the card");

// Greyed is about starting, never about stopping: a project somehow running
// with a future start must still offer Stop.
const runningEarly = card(SP({ startAt: NOW + 48 * HOUR }), { isActive: true });
t("a running project is never greyed, whatever its start says",
  !/aria-disabled="true"/.test(runningEarly));
has(runningEarly, ">Stop<", "and it still offers Stop");

// ---- the prompt ----
const sched = SP({ startAt: NOW + 48 * HOUR });
let ask = "";
try {
  ask = renderToStaticMarkup(React.createElement(out.StartAheadModal, {
    proj: sched, onStartNow(){}, onReschedule(){}, onWait(){} }));
} catch (e) { ask = "ERR:" + e.message; }
t("the prompt renders", ask.indexOf("ERR:") !== 0);
if (ask.indexOf("ERR:") === 0) console.log("   " + ask);
has(ask, "Line 4 Rebuild", "it names the project");
has(ask, "isn\u2019t scheduled to start till", "and says it is not due yet");
has(ask, "Start It Now", "offering to start it anyway");
has(ask, "Pick a New Date &amp; Time", "or to move the date");
has(ask, "Wait Till Then", "or to leave it alone");
t("all three answers are offered and no more",
  (ask.match(/<button/g) || []).length === 3);

// The three answers, driven for real.
function askMount(props) {
  const cells = [], refs = [];
  let si = 0, ri = 0;
  HOOKS = {
    useState(init) {
      const k = si++;
      if (cells.length <= k) cells[k] = typeof init === "function" ? init() : init;
      return [cells[k], (v) => { cells[k] = typeof v === "function" ? v(cells[k]) : v; }];
    },
    useRef(v) { const k = ri++; if (refs.length <= k) refs[k] = { current: v === undefined ? null : v }; return refs[k]; }
  };
  function render() {
    si = 0; ri = 0;
    const flat = [];
    (function walk(n){
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(walk);
      flat.push(n);
      walk(n.children);
      walk(n.props && n.props.children);
    })(stubOut.StartAheadModal(props));
    return flat;
  }
  return render;
}
let startedNow = false, rescheduledTo = null, waited = false;
const askProps = { proj: sched, onStartNow(){ startedNow = true; },
  onReschedule(ts){ rescheduledTo = ts; }, onWait(){ waited = true; } };
const askRender = askMount(askProps);
const findBtn = (flat, label) => flat.filter((n) => n.type === "button" &&
  n.children && String(n.children[0]) === label)[0];

findBtn(askRender(), "Wait Till Then").props.onClick();
t("Wait leaves the project alone", waited && !startedNow && rescheduledTo === null);
findBtn(askRender(), "Start It Now").props.onClick();
t("Start It Now starts it", startedNow);

// Pick a new date: the second stage, prefilled with the schedule it has now.
findBtn(askRender(), "Pick a New Date & Time").props.onClick();
const stage2 = askRender();
const dateIn = stage2.filter((n) => n.type === "input" && n.props.type === "date")[0];
const timeIn = stage2.filter((n) => n.type === "input" && n.props.type === "time")[0];
t("the second stage offers a date and a time", !!dateIn && !!timeIn);
t("prefilled with the start it is moving away from",
  dateIn && dateIn.props.value === out.tsDateStr(sched.startAt));
dateIn.props.onChange({ target: { value: "2026-09-04" } });
timeIn.props.onChange({ target: { value: "07:15" } });
findBtn(askRender(), "Save").props.onClick();
t("saving hands back the new moment",
  rescheduledTo === out.joinDateTime("2026-09-04", "07:15"));
t("and starts nothing", startedNow === true && rescheduledTo !== null);

// An impossible date cannot be saved. The sentinel is deliberately not null -
// null is what a cleared date legitimately hands back, so using it here would
// pass whether the guard fired or not.
let called = false;
const askRender2 = askMount({ proj: sched, onStartNow(){},
  onReschedule(){ called = true; }, onWait(){} });
findBtn(askRender2(), "Pick a New Date & Time").props.onClick();
askRender2().filter((n) => n.type === "input" && n.props.type === "date")[0]
  .props.onChange({ target: { value: "2026-02-31" } });
findBtn(askRender2(), "Save").props.onClick();
t("a date the calendar does not have is refused rather than saved", called === false);
// and a good one still gets through, so the guard is not just off
askRender2().filter((n) => n.type === "input" && n.props.type === "date")[0]
  .props.onChange({ target: { value: "2026-09-04" } });
findBtn(askRender2(), "Save").props.onClick();
t("while a real one still saves", called === true);

// ---- the rule a press follows ----
const board = [SP({ id: 70, startAt: NOW + 48 * HOUR }), SP({ id: 71, startAt: NOW - HOUR }),
               SP({ id: 72 })];
const act = (id, active, force) => out.startAction(board, active, id, force, NOW);
t("pressing a project not due yet asks", act(70, null, false) === "ask");
t("pressing one already started just runs", act(71, null, false) === "run");
t("and one with no start at all runs", act(72, null, false) === "run");
t("stopping the running project is never gated, even if it is not due",
  act(70, 70, false) === "run");
t("the force flag runs past the gate - it is how Start It Now gets through",
  act(70, null, true) === "run");
t("a project that is not on the board runs rather than wedging",
  act(999, null, false) === "run");
t("and no board at all does not throw",
  out.startAction(null, null, 70, false, NOW) === "run");

// ---- and it is wired into the one place that starts anything ----
// Read from the payload under test, not from the source on disk - reading the
// file would mean these assertions pass no matter what was actually built.
const wiring = src;
function body(name, n) {
  const i = wiring.indexOf("function " + name + "(");
  return i < 0 ? "" : wiring.slice(i, i + (n || 900));
}
const tog = body("toggleProject");
t("toggleProject exists and takes a force flag", /^function toggleProject\(id, force\)/.test(tog));
t("it consults the rule", tog.indexOf('startAction(projects, activeId, id, force)==="ask"') >= 0);
t("and opens the prompt when told to", tog.indexOf("setStartAsk(findProj(projects, id))") >= 0);
// Anchored on the call, not on the old `!clockIn()` shape - the property is
// that the scheduled-start gate runs first, whatever the call looks like.
t("toggleProject reaches the clock-in at all", tog.indexOf("clockIn(") >= 0);
t("the gate runs before the clock-in prompt, so an early tap does not drag the work day in",
  tog.indexOf("startAction(") >= 0 && tog.indexOf("clockIn(") >= 0 &&
  tog.indexOf("startAction(") < tog.indexOf("clockIn("));
// And the tap is handed to the clock-in rather than dropped.
t("the tap is carried through the shift question",
  /clockIn\(function\(at\)\{ runToggle\(id, at\); \}\)/.test(tog));
const early = body("startPendingNow");
t("starting early rewrites the start on record", /startAt:now/.test(early));
t("and then starts it past the gate", /toggleProject\(p\.id, true\)/.test(early));
const resched = body("reschedulePending");
t("rescheduling writes the new moment", /startAt:ts/.test(resched));
t("and starts nothing", !/toggleProject/.test(resched));
t("closing the popups clears the prompt too",
  /setStartAsk\(null\);/.test(body("closeAllPopups", 700)));

// The all-lanes list is gone: a lane is edited in its own form, reached from
// the outline or from a lane header on the board. Lane ORDER is written by
// the outline's commit, covered by the stepping tests above.

// ---- which glyph a modal title actually resolves to ----
// Source-level checks cannot see this: the map, the prefix list and the
// lookup order can each be correct on their own and still resolve wrongly.
const draw = (el) => { try { return renderToStaticMarkup(el); } catch (e) { return "ERR"; } };
const glyphOf = (title) => {
  const html = draw(React.createElement(out.ModalGlyph, { title }));
  if (!html) return null;
  const names = Object.keys(out.MENU_GLYPHS);
  for (const n of names) {
    if (html === draw(React.createElement(out.MenuIcon, { name: n, size: 20 }))) return n;
  }
  return "unknown";
};
t("Edit Project wears the project glyph", glyphOf("Edit Project") === "project");
t("Edit Task wears the task glyph", glyphOf("Edit Task") === "task");
t("Add Task does too - it is the same form", glyphOf("Add Task") === "task");
// Titles that carry a record's name are matched on their opening.
t("a stages sheet is matched by its prefix", glyphOf("Stages - Line 4 Rebuild") === "stages");
t("and so is adding into a lane", glyphOf("Add to Daily Activities") === "project");
t("a different job name still resolves", glyphOf("Stages - Trim pass") === "stages");
// A title in the exact map must not fall through to prefix matching, and a
// title in neither must stay bare.
t("an unmapped title renders nothing at all", glyphOf("Match Tasks?") === null);
t("nor does a confirmation borrow one", glyphOf("Delete lane") === null);
t("a title that is neither exact nor a prefix is bare", glyphOf("Regular or Overtime?") === null);

// The gauge is the one glyph with a solid area; if the fill kind stops
// rendering it quietly becomes an empty box.
const stagesHtml = draw(React.createElement(out.MenuIcon, { name: "stages", size: 28 }));
t("the gauge renders its level", /fill="[^"]*"[^>]*>|fill="/.test(stagesHtml) &&
  stagesHtml.indexOf('stroke="none"') >= 0);
t("and it is a real area, not an outline",
  (stagesHtml.match(/<rect/g) || []).length === 2);
t("while the task glyph has no fill at all",
  draw(React.createElement(out.MenuIcon, { name: "task", size: 28 })).indexOf('stroke="none"') < 0);

// ---- lane accent used as text ----
// The accents are picked to work as borders and fills. Measured on the painted
// result they read at 5.1-5.7:1 on the dark card but only 3.2-3.6:1 on the
// light one, under AA for both title sizes - so the ink is nudged toward the
// surface's text colour until it clears, and not one step further.
const cr = (a, b) => out.contrastOf(out.hexRGB(a), out.hexRGB(b));
const DARK = "#0D0D1A", LIGHTBG = "#F2F2F7", DARKINK = "#E8E8F0", LIGHTINK = "#14141C";
t("an accent already readable is left exactly alone",
  out.readableInk("#4A9C6B", DARK, DARKINK) === "#4A9C6B");
t("one that is not gets darkened", out.readableInk("#4A9C6B", LIGHTBG, LIGHTINK) !== "#4A9C6B");
["#4A9C6B", "#4B8EC8", "#9B6DD6", "#CC5050", "#C8A030", "#4BC8C4"].forEach((a) => {
  const ink = out.readableInk(a, LIGHTBG, LIGHTINK);
  t(a + " clears AA on the light card once adjusted", cr(ink, LIGHTBG) >= 4.5);
  t(a + " is still recognisably its own colour, not just the text colour",
    ink.toLowerCase() !== LIGHTINK.toLowerCase());
});
// It must stop as soon as it clears, or every lane converges on the same ink
// and the whole point is lost.
const inks = ["#4A9C6B", "#4B8EC8", "#9B6DD6"].map((a) => out.readableInk(a, LIGHTBG, LIGHTINK));
t("adjusted lanes stay distinct from each other", new Set(inks).size === 3);
t("and it does not overshoot far past the target",
  inks.every((i) => cr(i, LIGHTBG) < 8));
// Junk in, original out - never a guess.
t("an unparseable accent is returned untouched", out.readableInk("nope", DARK, DARKINK) === "nope");
t("as is one with a bad surface", out.readableInk("#4A9C6B", "zz", DARKINK) === "#4A9C6B");
t("three-digit hex is understood", out.hexRGB("#abc").join(",") === "170,187,204");
t("contrast is symmetric", Math.abs(cr("#000000", "#ffffff") - cr("#ffffff", "#000000")) < 1e-9);
t("black on white is the full 21:1", Math.abs(cr("#000000", "#ffffff") - 21) < 0.01);
t("a colour against itself is 1:1", Math.abs(cr("#4A9C6B", "#4A9C6B") - 1) < 1e-9);

// A running card is filled with its own accent, so the title must not also be
// that accent - that is why an earlier attempt at lane-coloured titles was
// reverted. Both sites keep the high-contrast colour while active.
const titleSrc = wiring.match(/var titleCol = hint \? S\.textDim : \([^;]+\);/g) || [];
t("both title sites decide their colour the same way", titleSrc.length === 2);
t("and both fall back to high contrast while running",
  titleSrc.every((l) => /isActive \? S\.titleText : LANECOL/.test(l)));
t("the lane colour goes through readableInk, never raw",
  (wiring.match(/var LANECOL=readableInk\(/g) || []).length === 2);

// ---- the outline ----
// One list of lanes, their projects and tasks, and the stages under those.
// A row's parent is the nearest row above it with a smaller indent, so the
// tree is read back out of position and indent rather than from a field that
// could drift out of step with them.
const OL_LANES = ["Daily Activity", "Projects"];
const OL_META = { "Daily Activity": { label: "Daily Activities", accent: "#4A9C6B" },
                  "Projects": { label: "Projects", accent: "#4B8EC8" } };
const OL_PROJ = [
  { id: 1, name: "Label Printing", lane: "Daily Activity", parentId: null, order: 0, role: "project",
    stages: [{ id: "s1", label: "Set up", done: true }, { id: "s2", label: "Run", done: false }] },
  { id: 2, name: "Trim pass", lane: "Daily Activity", parentId: 1, order: 0, role: "task", stages: [] },
  { id: 3, name: "Laminating", lane: "Daily Activity", parentId: null, order: 1, role: "project", stages: [] },
  { id: 4, name: "Crew Training", lane: "Projects", parentId: null, order: 0, role: "project", stages: [] }
];
const R = out.outlineRows(OL_LANES, OL_META, OL_PROJ);
const shape = (rs) => rs.map((r) => r.level + ":" + r.kind + ":" + (r.name || r.id)).join(" | ");
t("the outline opens with a lane", R[0].kind === "lane" && R[0].level === 0);
t("lanes carry their display label", R[0].name === "Daily Activities");
t("a project sits one level inside its lane",
  R[1].kind === "node" && R[1].name === "Label Printing" && R[1].level === 1);
t("its stages come before its children",
  R[2].kind === "stage" && R[3].kind === "stage" && R[4].name === "Trim pass");
t("and a nested task is indented past its parent", R[4].level === 2);
t("a second lane follows its own subtree",
  R.filter((r) => r.kind === "lane").map((r) => r.id).join(",") === OL_LANES.join(","));
t("every row is accounted for", R.length === 2 + 4 + 2);

// A row owns everything indented under it, and carries it when moved.
t("a project owns its stages and children", out.outlineSpan(R, 1) === 4);
t("a leaf owns only itself", out.outlineSpan(R, 4) === 1);
t("a lane owns its whole subtree", out.outlineSpan(R, 0) === 6);

// ---- reading the tree back out ----
const C = out.outlineCommit(R);
t("lane order comes back in order", C.laneOrder.join(",") === OL_LANES.join(","));
t("a top-level project has no parent", C.parentOf[1] === null);
t("a nested task points at its parent", C.parentOf[2] === 1);
t("lanes are assigned from the heading above", C.laneOf[4] === "Projects");
// Order is what the board sorts on, so the commit has to hand it back.
t("the commit returns a sibling order at all", !!C.orderOf);
t("top-level projects in a lane are numbered from zero",
  C.orderOf[1] === 0 && C.orderOf[3] === 1);
t("a nested task is numbered within its own parent", C.orderOf[2] === 0);
t("and a project in another lane starts again at zero", C.orderOf[4] === 0);
const dense = (ids) => ids.map((i) => C.orderOf[i]).join(",");
t("numbering is dense, with no gaps", dense([1, 3]) === "0,1");
// The running tally is keyed "<lane>/<parent>". Sharing one map with the
// answer would collide the moment a record id looked like one of those keys -
// harmless with numeric ids, wrong the day an id is a string.
const collide = out.outlineCommit([
  { key: "L:Bay", kind: "lane", id: "Bay", level: 0 },
  { key: "P:c", kind: "node", id: "Bay/root", name: "collider", level: 1 },
  { key: "P:x", kind: "node", id: "x", name: "second", level: 1 }
]);
t("an id shaped like a tally key is still numbered from zero",
  collide.orderOf["Bay/root"] === 0);
t("and does not corrupt the row after it", collide.orderOf["x"] === 1);
// Parentage is read from indent. Without popping the stack every later row
// would hang off whatever came before it, however shallow it is.
t("a project after a deeper task still has no parent", C.parentOf[3] === null);
t("and stays in its own lane", C.laneOf[3] === "Daily Activity");
t("stages come back under their own node",
  (C.stagesOf[1] || []).map((r) => r.name).join(",") === "Set up,Run");
t("a node with no stages has none", !C.stagesOf[3]);
// Moving between lanes, and promoting a task out of its parent, are now the
// business of the stepping tests below - stepDown into the next lane, and
// stepOut - which assert the same properties against the model that ships.

// ---- stepping the outline by buttons ----
// Rows move by up/down/in/out rather than dragging. Up and down move among
// siblings; at the edge one more step leaves the parent, which is the only
// move that asks. In and out change indent, and type follows depth.
const N = (rs) => rs.map((r) => r.name).join("|");
// R: lane DA | Label Printing(1) | Set up(s2) | Run(s2) | Trim pass(2) | Laminating(1) | lane P | Crew Training(1)
t("siblings share level and kind", out.prevSibling(R, 5) === 1 && out.nextSibling(R, 1) === 5);
t("a stage's siblings are stages, not the child node beside them",
  out.nextSibling(R, 2) === 3 && out.nextSibling(R, 3) === -1);
t("the first child has no previous sibling", out.prevSibling(R, 1) === -1);
t("and a lane's parent is nothing", out.parentIndex(R, 0) === -1);
t("a nested task's parent is its project", out.parentIndex(R, 4) === 1);

// up / down among siblings, no crossing
const dn = out.stepDown(R, 1);
t("a project steps down past its sibling, subtree and all",
  !!dn && N(dn.rows) === "Daily Activities|Laminating|Label Printing|Set up|Run|Trim pass|Projects|Crew Training");
t("and that is not a crossing", !!dn && dn.crossed === null);
const upBack = out.stepUp(dn.rows, 2);
t("stepping it back up restores the order", !!upBack && N(upBack.rows) === N(R));
t("a stage steps among its own stages only",
  !!out.stepDown(R, 2) && N(out.stepDown(R, 2).rows).indexOf("Run|Set up") > 0);
t("but never out of its host", out.stepDown(R, 3) === null && out.stepUp(R, 2) === null);
// lanes
const ldn = out.stepDown(R, 0);
t("a lane steps down past the next lane with everything inside it",
  !!ldn && N(ldn.rows) === "Projects|Crew Training|Daily Activities|Label Printing|Set up|Run|Trim pass|Laminating");
t("lanes never cross into anything", !!ldn && ldn.crossed === null && out.stepUp(R, 0) === null);
t("the last lane cannot step down", out.stepDown(R, 6) === null);

// crossing: a task at the edge of its parent
const noWhere = out.stepUp(R, 4);
t("the only task in the first project has nowhere to go up", noWhere === null);
const cross = out.stepDown(R, 4);
t("stepping down past the last sibling leaves the parent", !!cross && !!cross.crossed);
t("and says where it went",
  !!cross && cross.crossed.from.name === "Label Printing" && cross.crossed.into.name === "Laminating");
t("landing as the first child of the next project",
  !!cross && N(cross.rows) === "Daily Activities|Label Printing|Set up|Run|Laminating|Trim pass|Projects|Crew Training");
t("at the same depth", !!cross && cross.rows[5].level === 2);
// a top-level project at the edge of its lane crosses into the next lane
const laneCross = out.stepDown(R, 5);
t("the last project in a lane steps into the next lane",
  !!laneCross && laneCross.crossed && laneCross.crossed.into.kind === "lane");
t("as its first project",
  !!laneCross && N(laneCross.rows) === "Daily Activities|Label Printing|Set up|Run|Trim pass|Projects|Laminating|Crew Training");
const laneCrossUp = out.stepUp(R, 7);
t("and the first project in a lane steps up into the previous lane's end",
  !!laneCrossUp && N(laneCrossUp.rows) === "Daily Activities|Label Printing|Set up|Run|Trim pass|Laminating|Crew Training|Projects");
t("and that crossing is reported too, with the lane it entered",
  !!laneCrossUp && !!laneCrossUp.crossed && laneCrossUp.crossed.into.name === "Daily Activities"
  && laneCrossUp.crossed.from.name === "Projects");
// Crossing into a node that has stages must land AFTER those stages: stages
// read before children, and a task dropped ahead of them would break that.
const R2 = out.outlineRows(["L"], { L: { label: "L", accent: "#888" } }, [
  { id: 1, name: "A", lane: "L", parentId: null, order: 0, role: "project", stages: [] },
  { id: 2, name: "a1", lane: "L", parentId: 1, order: 0, role: "task", stages: [] },
  { id: 3, name: "B", lane: "L", parentId: null, order: 1, role: "project", stages: [{ id: "s", label: "prep", done: false }] },
  { id: 4, name: "b1", lane: "L", parentId: 3, order: 0, role: "task", stages: [] }
]);
const intoB = out.stepDown(R2, 2);
t("a task crossing into a project with stages lands after them",
  !!intoB && N(intoB.rows) === "L|A|B|prep|a1|b1");
const c1 = out.outlineCommit(laneCrossUp.rows);
t("which the commit records as a lane change", c1.laneOf[4] === "Daily Activity");

// in / out
const inned = out.stepIn(R, 5);
t("a project stepped in nests under the project above it",
  !!inned && N(inned.rows) === "Daily Activities|Label Printing|Set up|Run|Trim pass|Laminating|Projects|Crew Training"
  && inned.rows[5].level === 2);
t("and becomes a task, since it is now nested", !!inned && inned.rows[5].role === "task");
t("after the existing children", !!inned && inned.rows[4].name === "Trim pass");
t("the first project in a lane has nothing above it to nest under", out.stepIn(R, 1) === null);
t("a stage cannot be nested", out.stepIn(R, 2) === null);
const outed = out.stepOut(R, 4);
t("a task stepped out sits beside its old parent",
  !!outed && N(outed.rows) === "Daily Activities|Label Printing|Set up|Run|Trim pass|Laminating|Projects|Crew Training"
  && outed.rows[4].level === 1);
t("and becomes a project", !!outed && outed.rows[4].role === "project");
t("its old parent keeps its stages", !!outed && out.outlineCommit(outed.rows).stagesOf[1].length === 2);
t("a stage cannot step out", out.stepOut(R, 2) === null);

// conversions
const laneToProj = out.stepIn(R, 6);
t("a lane stepped in becomes a project in the lane above",
  !!laneToProj && laneToProj.converted && laneToProj.rows[6].kind === "node" && laneToProj.rows[6].level === 1);
t("its projects nest one deeper", !!laneToProj && laneToProj.rows[7].level === 2);
t("and it is flagged fresh, from the lane it was", !!laneToProj && laneToProj.rows[6].fresh && laneToProj.rows[6].fromLane === "Projects");
const c2 = out.outlineCommit(laneToProj.rows);
t("the commit creates the project and retires the lane",
  c2.newProjects.length === 1 && c2.dropLanes.join() === "Projects" && c2.laneOrder.join() === "Daily Activity");
t("the first lane cannot step in", out.stepIn(R, 0) === null);
const projToLane = out.stepOut(R, 5);
t("a top-level project stepped out becomes its own lane",
  !!projToLane && projToLane.converted && projToLane.rows[5].kind === "lane" && projToLane.rows[5].level === 0);
// Brent, 10-20 (option A): the project is KEPT - it moves into its new lane
// as that lane's first project, with everything under it.
t("placed after the lane it was in, with the project inside it",
  !!projToLane && N(projToLane.rows) === "Daily Activities|Label Printing|Set up|Run|Trim pass|Laminating|Laminating|Projects|Crew Training"
  && projToLane.rows[6].kind === "node" && projToLane.rows[6].id === 3 && projToLane.rows[6].level === 1
  && projToLane.rows[7].kind === "lane");
const c3 = out.outlineCommit(projToLane.rows);
t("the commit creates the lane and keeps the project",
  c3.newLanes.length === 1 && c3.newLanes[0].label === "Laminating" && c3.dropProjects.length === 0
  && c3.laneOf[3] === "new-lane-3" && c3.parentOf[3] === null);
const withStages = out.stepOut(R, 1);
t("a project carrying stages moves whole, stages and children too",
  !!withStages && out.outlineCommit(withStages.rows).stagesOf[1].length === 2
  && out.outlineCommit(withStages.rows).laneOf[2] === "new-lane-1" && out.outlineCommit(withStages.rows).parentOf[2] === 1);

// every row survives every step
[[0,"down"],[1,"down"],[4,"down"],[5,"in"],[4,"out"],[6,"in"],[5,"out"],[7,"up"]].forEach(([i, k]) => {
  const fn = { up: out.stepUp, down: out.stepDown, in: out.stepIn, out: out.stepOut }[k];
  const res = fn(R, i);
  // A project given its own lane adds exactly one row: the new lane.
  const extra = (k === "out" && res && res.converted) ? 1 : 0;
  t("step " + k + " on row " + i + " keeps every row", !res || res.rows.length === R.length + extra);
  t("and duplicates none", !res || new Set(res.rows.map((r) => r.key)).size === res.rows.length);
});
// options mirror the functions, so a button is disabled rather than dead
const o = out.stepOptions(R, 2);
t("a stage offers only up/down within its run", !o.up && o.down && !o.in_ && !o.out);
const o2 = out.stepOptions(R, 0);
t("the first lane can only step down", !o2.up && o2.down && !o2.in_ && !o2.out);

// ---- how a row nests is chosen, not inferred ----
// A project can hold projects or tasks; a task holds only tasks. The
// controller offers exactly the roles that exist and greys the rest, so the
// caller never picks one and gets corrected afterwards.
t("a project above offers both roles", out.nestRoles(R, 5).join() === "task,project");
t("a task above offers only task",
  out.nestRoles(out.stepIn(R, 5, "task").rows, 5) !== null);
const underTask = out.outlineRows(["L"], { L: { label: "L", accent: "#888" } }, [
  { id: 1, name: "A", lane: "L", parentId: null, order: 0, role: "project", stages: [] },
  { id: 2, name: "a1", lane: "L", parentId: 1, order: 0, role: "task", stages: [] },
  { id: 3, name: "a2", lane: "L", parentId: 1, order: 1, role: "task", stages: [] }
]);
t("a row whose sibling above is a task may only become a task",
  out.nestRoles(underTask, 3).join() === "task");
t("and nesting it as a project is refused outright",
  out.stepIn(underTask, 3, "project") === null);
t("while nesting it as a task works",
  !!out.stepIn(underTask, 3, "task") && out.stepIn(underTask, 3, "task").rows[3].role === "task");
t("a row with nothing above it to nest under has no roles", out.nestRoles(R, 1).join() === "");
t("a lane offers none - it converts instead", out.nestRoles(R, 0).join() === "");
t("nor does a stage", out.nestRoles(R, 2).join() === "");
// The role actually takes effect.
const asProj = out.stepIn(R, 5, "project");
t("nesting as a project keeps it a project", !!asProj && asProj.rows[5].role === "project");
const asTask = out.stepIn(R, 5, "task");
t("nesting as a task makes it a task", !!asTask && asTask.rows[5].role === "task");
t("either way it lands at the same depth",
  asProj.rows[5].level === 2 && asTask.rows[5].level === 2);
t("and the commit records the same parent for both",
  out.outlineCommit(asProj.rows).parentOf[3] === 1 && out.outlineCommit(asTask.rows).parentOf[3] === 1);
t("with no role given, the first available is used",
  !!out.stepIn(R, 5) && out.stepIn(R, 5).rows[5].role === "task");
t("a role that does not exist is refused rather than substituted",
  out.stepIn(R, 5, "lane") === null);
// stepOptions reports the roles alongside the directions, so one call drives
// the whole controller.
const opt = out.stepOptions(R, 5, "project");
t("options carry the roles", opt.roles.join() === "task,project");
t("and in_ reflects the role asked for", opt.in_ === true);
t("an impossible role makes in_ false",
  out.stepOptions(underTask, 3, "project").in_ === false);
t("while the possible one leaves it true",
  out.stepOptions(underTask, 3, "task").in_ === true);

// ---- editing a row's details without losing the arrangement ----
// The outline stays mounted while a child editor sits on top of it, so its
// unsaved moves survive. When the board comes back changed, the new content
// is folded in: content from the fresh read, sequence and indent from what is
// already on screen.
const arranged = out.stepIn(R, 5, "task").rows;   // Laminating nested, unsaved
const renamed = out.outlineRows(OL_LANES, OL_META, OL_PROJ.map((p) =>
  p.id === 3 ? Object.assign({}, p, { name: "Laminating II" }) : p));
const M = out.mergeOutline(arranged, renamed);
t("a rename made in a child editor shows through",
  M.map((r) => r.name).indexOf("Laminating II") >= 0);
t("without undoing the move that was not saved yet",
  M.find((r) => r.name === "Laminating II").level === 2);
t("and without disturbing the rest",
  M.map((r) => r.key).join() === arranged.map((r) => r.key).join());
// A record deleted in the child editor leaves the outline.
const deleted = out.outlineRows(OL_LANES, OL_META, OL_PROJ.filter((p) => p.id !== 3));
const M2 = out.mergeOutline(arranged, deleted);
t("a deleted record drops out of the outline", !M2.some((r) => r.name === "Laminating"));
t("taking nothing else with it", M2.length === arranged.length - 1);
// A stage added while the sheet was open appears, next to its own kind.
const gained = out.outlineRows(OL_LANES, OL_META, OL_PROJ.map((p) =>
  p.id === 1 ? Object.assign({}, p, { stages: p.stages.concat([{ id: "s3", label: "Pack", done: false }]) }) : p));
const M3 = out.mergeOutline(arranged, gained);
t("a stage added elsewhere appears", M3.some((r) => r.name === "Pack"));
t("after the stages it joins",
  M3.map((r) => r.name).join("|").indexOf("Set up|Run|Pack") >= 0);
t("and the arrangement still holds",
  M3.find((r) => r.name === "Laminating").level === 2);
// A row created by a conversion has no counterpart in a fresh read yet.
const converted = out.stepOut(R, 5).rows;         // Laminating -> its own lane
const M4 = out.mergeOutline(converted, out.outlineRows(OL_LANES, OL_META, OL_PROJ));
t("a row made by a conversion is kept on its own account",
  M4.some((r) => r.fresh && r.kind === "lane"));
t("and the project it came from appears once, as a project inside it",
  M4.filter((r) => r.name === "Laminating" && r.kind === "node").length === 1 &&
  M4.filter((r) => r.name === "Laminating" && r.kind === "lane").length === 1);

// ---- a saved outline, applied (outlineApply) ----
// What Save actually writes. Until 10-20 the board applied moves only, so
// conversions were lost or left orphans. Every rule here is about the RESULT.
let laneSeq = 0;
const newKey = () => "custom_t" + (++laneSeq);
const ids = (ps) => new Set(ps.map((p) => p.id));
const orphans = (ps) => ps.filter((p) => p.parentId != null && !ids(ps).has(p.parentId));
// project -> lane
const A1 = out.outlineApply(out.stepOut(R, 5).rows, OL_PROJ, OL_META, newKey);
const lam = A1.projects.find((p) => p.id === 3);
t("a project given its own lane: the lane gets a real key", A1.laneOrder.join() === "Daily Activity,custom_t1,Projects");
t("labelled with the project's name", A1.laneMeta.custom_t1 && A1.laneMeta.custom_t1.label === "Laminating");
t("in a colour no other lane is using", A1.laneMeta.custom_t1 &&
  ["#4A9C6B", "#4B8EC8"].indexOf(A1.laneMeta.custom_t1.accent.toUpperCase()) < 0 && /^#[0-9A-F]{6}$/i.test(A1.laneMeta.custom_t1.accent));
t("the project is kept, as the first project in the new lane", !!lam && lam.lane === "custom_t1" && lam.parentId === null && lam.order === 0);
t("no record is lost", A1.projects.length === OL_PROJ.length);
t("no temporary id reaches the board", A1.laneOrder.concat(A1.projects.map((p) => p.lane)).every((k) => String(k).indexOf("new-") !== 0));
t("and every lane a project names exists", A1.projects.every((p) => A1.laneOrder.indexOf(p.lane) >= 0));
// project with stages and a child -> lane
const A2 = out.outlineApply(out.stepOut(R, 1).rows, OL_PROJ, OL_META, newKey);
const lp = A2.projects.find((p) => p.id === 1), tp = A2.projects.find((p) => p.id === 2);
t("moving whole: the project keeps its stages", !!lp && lp.stages.length === 2 && lp.stages[0].label === "Set up");
t("and its child comes with it, still under it", !!tp && tp.parentId === 1 && tp.lane === lp.lane);
// lane -> project
const A3 = out.outlineApply(out.stepIn(R, 6).rows, OL_PROJ, OL_META, newKey);
const made = A3.projects.find((p) => p.name === "Projects");
const crew = A3.projects.find((p) => p.id === 4);
t("a lane turned into a project: a real project is made", !!made && made.role === "project" && !ids(OL_PROJ).has(made.id));
t("with a long id from the same place Add takes them", !!made && typeof made.id === "string" && made.id.length >= 24);
t("in the lane above", !!made && made.lane === "Daily Activity" && made.parentId === null);
t("its projects nest under the new project", !!made && !!crew && crew.parentId === made.id && crew.lane === "Daily Activity");
t("nothing points at a parent that does not exist", orphans(A3.projects).length === 0);
t("the old lane is retired, and its colour entry with it", A3.laneOrder.join() === "Daily Activity" && !A3.laneMeta.Projects);
// plain moves are unchanged
const A4 = out.outlineApply(R, OL_PROJ, OL_META, newKey);
t("a save with no change writes the same board back",
  A4.laneOrder.join() === OL_LANES.join() && A4.projects.every((p, i) => p.lane === OL_PROJ[i].lane && p.parentId === OL_PROJ[i].parentId && p.order === OL_PROJ[i].order));
// one place makes project ids
// ---- long ids (10-20): ids made on different phones must never meet ----
const many = Array.from({ length: 2000 }, () => out.uid());
t("uid() makes long ids", many.every((x) => typeof x === "string" && x.length >= 24));
t("and two thousand of them never repeat", new Set(many).size === many.length);
const np = [out.newProjectId(OL_PROJ), out.newProjectId(OL_PROJ)];
t("a new project id is long and random, not highest + 1", np.every((x) => typeof x === "string" && x.length >= 24) && np[0] !== np[1]);
t("and lives beside the old numbered ones without clashing", np.every((x) => !ids(OL_PROJ).has(x)));

// ---- change tracking: what changed, and what went (10-20) ----
const T0c = 1700000000000;
const recs = [{ id: 1, name: "A" }, { id: 2, name: "B", updatedAt: 111 }, { id: 3, name: "C" }];
const st1 = out.ttStamp(recs, [{ id: 1, name: "A" }, { id: 2, name: "B2", updatedAt: 111 }, { id: 4, name: "D" }], T0c);
t("an unchanged record is written back exactly as stored", st1.list[0] === recs[0] && st1.list[0].updatedAt === undefined);
t("a changed record is stamped now", st1.list[1].updatedAt === T0c && st1.list[1].name === "B2");
t("a new record is stamped now", st1.list[2].updatedAt === T0c);
t("a record that went leaves a tombstone", st1.gone.length === 1 && st1.gone[0].id === 3 && st1.gone[0].at === T0c);
t("the stamp alone is not a change", out.ttStamp([{ id: 5, n: 1, updatedAt: 1 }], [{ id: 5, n: 1, updatedAt: 9 }], T0c).list[0].updatedAt === 1);
t("ids match whether stored as a number or as text", out.ttStamp([{ id: 7, n: 1 }], [{ id: "7", n: 1 }], T0c).gone.length === 0);
t("nothing in, nothing out", out.ttStamp([], [], T0c).list.length === 0 && out.ttStamp(null, null, T0c).gone.length === 0);
t("only the real board is tracked", out.TT_TRACKED.join() === "tt_projects,tt_logs,tt_disruptions,tt_breaks" &&
  out.TT_TRACKED.every((k) => k.indexOf("tt_test") < 0));
// saveTracked, end to end, on a store of its own (the doorway)
{
  const m = new Map();
  const be = { get length(){ return m.size; }, key: (i) => Array.from(m.keys())[i], getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  out.ttDbUse(be);
  out.saveTracked("tt_projects", [{ id: 1, name: "A" }]);
  const a = out.load("tt_projects", []);
  t("the first save of a board stamps what is new", a.length === 1 && typeof a[0].updatedAt === "number");
  const stampA = a[0].updatedAt;
  out.saveTracked("tt_projects", [{ id: 1, name: "A" }]);
  t("saving the same board again stamps nothing", out.load("tt_projects", [])[0].updatedAt === stampA);
  out.saveTracked("tt_projects", [{ id: 2, name: "B" }]);
  const g = out.load("tt_gone", {});
  t("a removed project is remembered as gone", Array.isArray(g.tt_projects) && g.tt_projects.length === 1 && g.tt_projects[0].id === 1);
  t("and other collections are untouched", g.tt_logs === undefined);
  out.saveTracked("tt_logs", Array.from({ length: out.TT_GONE_MAX + 5 }, (_, i) => ({ id: "l" + i })));
  out.saveTracked("tt_logs", []);
  const gl = out.load("tt_gone", {}).tt_logs || [];
  t("the gone list is capped, oldest dropped", gl.length === out.TT_GONE_MAX && gl[0].id === "l5" && gl[gl.length - 1].id === "l" + (out.TT_GONE_MAX + 4));
  be.setItem("tt_gone", "[not json");
  out.saveTracked("tt_breaks", [{ id: "b1" }]); out.saveTracked("tt_breaks", []);
  t("a corrupt gone list is replaced, not fatal", Array.isArray(out.load("tt_gone", {}).tt_breaks));
  out.ttDbUse(null);
}
t("merging with nothing yields nothing", out.mergeOutline([], []).length === 0);
t("merging an empty screen adopts the fresh read",
  out.mergeOutline([], R).length === R.length);

// ---- milestones: the model, before any of it is drawn ----
// A step is a point in time with an expectation. Its status falls out of its
// target, its actual, and now. Lanes and the board roll up from projects.
const MD = out.MS_DAY, MNOW = 20 * MD;                       // "now" is day 20
const at = (day) => day * MD;
const closedRec = (id, name, lane, parentId, day) =>
  ({ id, name, lane, parentId, order: 0, role: parentId ? "task" : "project", kind: "finite", stages: [],
     closedAt: day == null ? undefined : at(day) });
const MP = [
  // Install: three steps. Fit expects tasks 12 and 13 closed.
  { id: 10, name: "Install", lane: "Projects", parentId: null, order: 0, role: "project", kind: "finite", stages: [],
    milestones: [
      { id: "m1", label: "Measure",  dueAt: at(5),  targets: [{ kind: "project", id: 11 }], doneAt: null, note: "" },
      { id: "m2", label: "Order",    dueAt: at(10), targets: [],                            doneAt: at(12), note: "" },
      { id: "m3", label: "Fit",      dueAt: at(30), targets: [{ kind: "project", id: 12 }, { kind: "project", id: 13 }], doneAt: null, note: "" },
      { id: "m4", label: "Sign-off", dueAt: at(15), targets: [{ kind: "project", id: 14 }], doneAt: null, note: "" }
    ] },
  closedRec(11, "Measure up",  "Projects", 10, 4),    // closed day 4: Measure met early
  closedRec(12, "Build",       "Projects", 10, null), // open
  closedRec(13, "Wire",        "Projects", 10, 9),
  closedRec(14, "Inspect",     "Projects", 10, null), // open, and Sign-off was due day 15: missed
  // a sub-project with its own tracker under Install
  { id: 15, name: "Electrics", lane: "Projects", parentId: 10, order: 1, role: "project", kind: "finite", stages: [],
    milestones: [ { id: "e1", label: "Rough-in", dueAt: at(25), targets: [], doneAt: null, note: "" } ] },
  // a second top-level project, everything met
  { id: 20, name: "Bench", lane: "Projects", parentId: null, order: 1, role: "project", kind: "ongoing", stages: [],
    milestones: [ { id: "b1", label: "Done", dueAt: at(8), targets: [], doneAt: at(7), note: "" } ] },
  // one with none, in another lane
  { id: 30, name: "Sweep", lane: "Daily Activity", parentId: null, order: 0, role: "project", kind: "ongoing", stages: [] }
];
t("worst wins, in the agreed order",
  out.worstStatus(["met", "upcoming", "late", "missed"]) === "missed" && out.worstStatus(["met", "late"]) === "late"
  && out.worstStatus(["upcoming", "met"]) === "upcoming" && out.worstStatus([]) === "met");
// actual
t("a step is actual when its last target closes", out.stepActual(MP[0].milestones[0], MP) === at(4));
t("a hand-marked step is actual at the mark", out.stepActual(MP[0].milestones[1], MP) === at(12));
t("a step with an open target is not actual yet", out.stepActual(MP[0].milestones[2], MP) === null);
t("hand mark and targets: the earlier wins",
  out.stepActual({ dueAt: at(9), targets: [{ id: 11 }], doneAt: at(2) }, MP) === at(2));
// status
t("closed before target: met", out.stepStatus(MP[0].milestones[0], MP, MNOW) === "met");
t("closed after target: late", out.stepStatus(MP[0].milestones[1], MP, MNOW) === "late");
t("open past target: missed", out.stepStatus(MP[0].milestones[3], MP, MNOW) === "missed");
t("open before target: upcoming", out.stepStatus(MP[0].milestones[2], MP, MNOW) === "upcoming");
const mpt = out.stepPoint(MP[0].milestones[1], MP, MNOW);
t("a point carries its variance", mpt.variance === 2 * MD && mpt.status === "late");
t("an open point has none", out.stepPoint(MP[0].milestones[2], MP, MNOW).variance === null);
// roll-up
const mline = out.projectLine(MP, 10, MNOW);
t("a project's line has its own steps", mline.own.length === 4);
t("plus one mark per child with milestones", mline.children.length === 1 && mline.children[0].id === 15);
t("and not for a child without any", !mline.children.some((c) => c.id === 11));
const mcur = out.projectCurrent(MP, 10, MNOW);
t("its current point sits at the earliest outstanding target", mcur.at === at(15));
t("coloured by the worst outstanding", mcur.status === "missed");
t("and counts what is open", mcur.open === 3 && mcur.total === 5);
t("a project with everything met rests at its last target, met",
  (() => { const c = out.projectCurrent(MP, 20, MNOW); return c.at === at(8) && c.status === "met" && c.open === 0; })());
t("a project with no milestones beneath it has no current point", out.projectCurrent(MP, 30, MNOW) === null);
t("hasMilestonesBeneath sees through a child", out.hasMilestonesBeneath(MP, 10) && !out.hasMilestonesBeneath(MP, 30));
t("either way round - a target closing before the hand mark wins too",
  out.stepActual({ dueAt: at(9), targets: [{ id: 11 }], doneAt: at(9) }, MP) === at(4));
// A done tracker with SEVERAL steps rests at the LAST of them, not the first.
const MP2 = MP.concat([{ id: 40, name: "Two done", lane: "Projects", parentId: null, order: 5, role: "project", kind: "ongoing", stages: [],
  milestones: [ { id: "x1", label: "A", dueAt: at(3), targets: [], doneAt: at(2), note: "" },
                { id: "x2", label: "B", dueAt: at(9), targets: [], doneAt: at(8), note: "" } ] }]);
t("a done tracker with several steps rests at its LAST target", out.projectCurrent(MP2, 40, MNOW).at === at(9));
// Milestones two levels down still count.
const MP3 = MP.concat([
  { id: 50, name: "Grand", lane: "Projects", parentId: null, order: 6, role: "project", kind: "ongoing", stages: [] },
  { id: 51, name: "Middle", lane: "Projects", parentId: 50, order: 0, role: "project", kind: "ongoing", stages: [] },
  { id: 52, name: "Leaf", lane: "Projects", parentId: 51, order: 0, role: "task", kind: "ongoing", stages: [],
    milestones: [ { id: "l1", label: "L", dueAt: at(40), targets: [], doneAt: null, note: "" } ] }]);
t("milestones two levels down are seen from the top", out.hasMilestonesBeneath(MP3, 50));
t("and the top's line carries the middle child at the leaf's point",
  out.projectLine(MP3, 50, MNOW).children.length === 1 && out.projectCurrent(MP3, 50, MNOW).at === at(40));
// lane and board
// A parent line shows the FULL extent of what is beneath it - every step,
// not one mark per child. Collapsing to a child's current point hid most of
// the future, which is the whole reason to look at a lane's line.
const mll = out.laneLine(MP, "Projects", MNOW);
t("a lane's line carries every step beneath it", mll.length === 6);
t("its own projects' steps and their children's alike",
  mll.some((p) => p.label === "Fit") && mll.some((p) => p.label === "Rough-in") && mll.some((p) => p.label === "Done"));
// Guarded: without the child's steps this find returns undefined, and an
// exception stops the suite instead of failing this one check.
t("each marked with who owns it",
  mll.every((p) => p.owner) && (mll.find((p) => p.label === "Rough-in") || {}).owner === "Electrics");
t("in time order", mll.every((p, i) => i === 0 || mll[i - 1].at <= p.at));
t("and the aggregate is still the summary, not the line",
  out.laneCurrent(MP, "Projects", MNOW).at === at(15));
const msub = out.subtreePoints(MP, 10, MNOW);
t("a subtree's points include the record's own", msub.filter((p) => p.own).length === 4);
t("and its descendants', flagged as not its own", msub.filter((p) => !p.own).length === 1);
t("a lane without any has an empty line", out.laneLine(MP, "Daily Activity", MNOW).length === 0);
t("the lane's current point is the worst of its projects",
  out.laneCurrent(MP, "Projects", MNOW).status === "missed");
const mbl = out.boardLine(MP, ["Daily Activity", "Projects"], { "Projects": { label: "Jobs" } }, MNOW);
t("the board's line carries every step in every lane", mbl.length === 6);
t("in time order across lanes", mbl.every((p, i) => i === 0 || mbl[i - 1].at <= p.at));
t("and a closed-out project takes its steps off the lane's line",
  out.laneLine(MP.map((p) => p.id === 20 ? Object.assign({}, p, { closedAt: at(9) }) : p), "Projects", MNOW).length === 5);
// layout
const msp = out.lineSpan(mline.own, MNOW);
t("the span covers the points and now, with room either side", msp.lo < at(5) && msp.hi > at(30));
t("a short span is widened to a week so ticks have room",
  (() => { const s2 = out.lineSpan([{ at: at(10) }], at(10)); return s2.hi - s2.lo >= 7 * MD; })());
t("ticks are days under a month", out.tickUnit({ lo: 0, hi: 20 * MD }) === "day");
t("and weeks past it", out.tickUnit({ lo: 0, hi: 60 * MD }) === "week");
const mg = out.groupMarks([{ at: at(5), status: "met" }, { at: at(5.1), status: "missed" }, { at: at(20), status: "upcoming" }],
  { lo: 0, hi: 30 * MD }, 300, 10);
t("marks within a few px share one signpost", mg.length === 2 && mg[0].members.length === 2);
t("which takes the worst colour", mg[0].status === "missed");
t("keeping every member for the dots", mg[0].members.map((m) => m.status).join() === "met,missed");

// ---- zoom and pan ----
// Fit shows everything; the other levels are a fixed window clamped to the
// line, so panning can never leave it showing nothing.
const zpts = [{ at: at(0) }, { at: at(120) }];
t("the levels are Fit, months, weeks, days, one day", out.MS_ZOOMS.map((z) => z.id).join() === "fit,months,weeks,days,day");
t("each narrower than the last", out.MS_ZOOMS.slice(1).every((z, i, a) => i === 0 || a[i - 1].ms > z.ms));
t("and tapping wraps back to Fit", out.nextZoom(4) === 0 && out.nextZoom(0) === 1);
t("the tightest level is a single day", out.MS_ZOOMS[4].ms === MD);
const zFit = out.zoomSpan(zpts, at(60), 0, null);
t("Fit spans the whole line", zFit.hi - zFit.lo > 119 * MD);
const zW = out.zoomSpan(zpts, at(60), 2, at(60));
t("a level is a window of its own width", Math.round((zW.hi - zW.lo) / MD) === 28);
t("centred where you are", Math.abs((zW.lo + zW.hi) / 2 - at(60)) < MD);
const zEdge = out.zoomSpan(zpts, at(60), 2, at(0));
t("clamped at the start of the line", zEdge.lo >= out.lineSpan(zpts, at(60)).lo - 1);
t("keeping its full width", Math.round((zEdge.hi - zEdge.lo) / MD) === 28);
t("a window wider than the line falls back to Fit",
  (() => { const tiny = [{ at: at(0) }, { at: at(3) }]; const z = out.zoomSpan(tiny, at(1), 1, at(1));
           return z.hi - z.lo === out.lineSpan(tiny, at(1)).hi - out.lineSpan(tiny, at(1)).lo; })());
const pan = out.panSpan(zW, zpts, at(60), -100, 300);
t("dragging left moves the window later", pan.lo > zW.lo);
t("by a proportion of the window's width", Math.abs((pan.lo - zW.lo) - (28 * MD / 3)) < MD);
t("and it never pans past the end", out.panSpan(zW, zpts, at(60), -99999, 300).hi <= out.lineSpan(zpts, at(60)).hi + 1);
t("nor past the start", out.panSpan(zW, zpts, at(60), 99999, 300).lo >= out.lineSpan(zpts, at(60)).lo - 1);
t("and Fit cannot be panned at all", out.panSpan(zFit, zpts, at(60), -500, 300).lo === zFit.lo);

// ---- the milestone report ----
// A wider fixture: several late and several missed steps, and more than three
// ahead - one of each is not enough to tell ordering or a limit from nothing.
const RP = MP.concat([{ id: 60, name: "Fitout", lane: "Projects", parentId: null, order: 9, role: "project", kind: "finite", stages: [],
  milestones: [
    { id: "r1", label: "Late small", dueAt: at(6),  targets: [], doneAt: at(7),  note: "" },   // late 1d
    { id: "r2", label: "Late big",   dueAt: at(9),  targets: [], doneAt: at(14), note: "" },   // late 5d
    { id: "r3", label: "Missed A",   dueAt: at(18), targets: [], doneAt: null,   note: "" },
    { id: "r4", label: "Missed B",   dueAt: at(12), targets: [], doneAt: null,   note: "" },
    { id: "r5", label: "Soon",       dueAt: at(24), targets: [], doneAt: null,   note: "" },
    { id: "r6", label: "Later",      dueAt: at(26), targets: [], doneAt: null,   note: "" },
    { id: "r7", label: "Latest",     dueAt: at(28), targets: [], doneAt: null,   note: "" },
    { id: "r8", label: "Beyond",     dueAt: at(35), targets: [], doneAt: null,   note: "" },
    { id: "r9", label: "Done ahead", dueAt: at(50), targets: [], doneAt: at(3),  note: "" }   // met, far ahead
  ] }]);
const rep2 = out.milestoneReport(RP, ["Projects"], at(0), at(20), MNOW);
t("a step is matched by its TARGET, not when it was met",
  rep2.lateList.some((p) => p.label === "Late big") && !rep2.points.some((p) => p.label === "Done ahead"));
t("the worst slip is the largest of several", rep2.worstSlip === 5 * MD);
t("and the average sits between them", rep2.avgSlip > MD && rep2.avgSlip < 5 * MD);
t("late steps are listed worst-first",
  rep2.lateList.map((p) => p.label).slice(0, 2).join() === "Late big,Order");
t("missed steps earliest-first", rep2.missedList.map((p) => p.label).join() === "Missed B,Sign-off,Missed A");
t("what is next is capped at three", rep2.next.length === 3);
// Across every project, not just this one: Rough-in (25) belongs between
// Soon (24) and Later (26).
t("soonest first, across every project", rep2.next.map((p) => p.label).join() === "Soon,Rough-in,Later");
t("and a step already met is never listed as next", !rep2.next.some((p) => p.status === "met"));
// A met step dated inside the "next" window would otherwise crowd out real
// work: three met steps at 21, 22, 23 must not fill the list.
const RP3 = RP.concat([{ id: 61, name: "Already done", lane: "Projects", parentId: null, order: 10, role: "project", kind: "ongoing", stages: [],
  milestones: [
    { id: "q1", label: "Met A", dueAt: at(21), targets: [], doneAt: at(20), note: "" },
    { id: "q2", label: "Met B", dueAt: at(22), targets: [], doneAt: at(20), note: "" },
    { id: "q3", label: "Met C", dueAt: at(23), targets: [], doneAt: at(20), note: "" } ] }]);
t("three met steps just past the window do not crowd out what is still to do",
  out.milestoneReport(RP3, ["Projects"], at(0), at(20), MNOW).next.every((p) => p.status !== "met"));


// Steps belong to the period their TARGET fell in, so a step met late still
// counts against the period that was supposed to deliver it.
const rep = out.milestoneReport(MP, ["Projects"], at(0), at(20), MNOW);
// Due in days 0-20: Measure (met early), Order (late by 2d), Sign-off (open
// past its target = missed), Done (met early). Fit (30) and Rough-in (25) are
// outside the window.
t("it counts what was due in the window", rep.due === 4);
t("split by how each one went", rep.met === 2 && rep.late === 1 && rep.missed === 1 && rep.open === 0);
t("on-time is measured against what was actually met, not what is still open", rep.onTimePct === 67);
t("the worst slip is the largest overrun", rep.worstSlip === 2 * MD);
t("and an early finish is reported as a gain, not a negative slip", rep.avgGain === MD);
t("missed steps are listed, earliest first", rep.missedList.length === 1 && rep.missedList[0].label === "Sign-off");
t("late ones worst-first", rep.lateList.length === 1 && rep.lateList[0].label === "Order");
t("and what is coming after the window, soonest first",
  rep.next.length > 0 && rep.next.every((p, i) => i === 0 || rep.next[i - 1].at <= p.at) && rep.next[0].at > at(20));
t("no more than three of those", rep.next.length <= 3);
t("with the window's own points kept for the line", rep.points.length === rep.due);
t("a window with nothing due reports nothing, not a division by zero",
  (() => { const r = out.milestoneReport(MP, ["Projects"], at(200), at(210), MNOW);
           return r.due === 0 && r.onTimePct === null && r.worstSlip === null && r.avgSlip === null; })());

// ---- tick scale ----
// Two sizes at every zoom, and what they mean slides with the window, so the
// line never becomes a comb or a bare rule.
t("over a month, minor ticks are weeks", out.tickScale({lo:0,hi:90*MD}).minor === "week");
t("and majors are months", out.tickScale({lo:0,hi:90*MD}).major === "month");
t("a week to a month, minor ticks are days", out.tickScale({lo:0,hi:20*MD}).minor === "day");
t("with the week start as the major", out.tickScale({lo:0,hi:20*MD}).major === "week");
t("under two days, minor ticks are hours", out.tickScale({lo:0,hi:MD}).minor === "hour");
t("with the day as the major", out.tickScale({lo:0,hi:MD}).major === "day");
const dayTicks = out.lineTicks({ lo: at(3), hi: at(17) }, "mon");
// 14 or 15: at() counts from the epoch in UTC, so whether the window opens
// exactly on a local midnight depends on the machine's timezone. The rule
// being proved is one tick per day, not which end is inclusive.
t("a fortnight of days gives a tick per day", dayTicks.length === 14 || dayTicks.length === 15);
t("spaced a day apart", dayTicks.every((k, i) => i === 0 || Math.round((k.at - dayTicks[i - 1].at) / MD) === 1));
t("of which two are week starts", dayTicks.filter((k) => k.major).length === 2);
// The week boundary follows the user's own pay week, not an assumed Monday.
const monMajors = out.lineTicks({ lo: at(0), hi: at(21) }, "mon").filter((k) => k.major).map((k) => new Date(k.at).getDay());
const sunMajors = out.lineTicks({ lo: at(0), hi: at(21) }, "sun").filter((k) => k.major).map((k) => new Date(k.at).getDay());
t("week majors land on the configured first day", monMajors.every((d) => d === 1) && sunMajors.every((d) => d === 0));
t("and changing that day moves them", monMajors.join() !== sunMajors.join());
const hourTicks = out.lineTicks({ lo: at(5), hi: at(5) + 12 * 3600000 }, "mon");
t("a half day gives a tick per hour", hourTicks.length === 13);
t("with midnight as the only major", hourTicks.filter((k) => k.major).length <= 1);
t("and a huge window never floods the line", out.lineTicks({ lo: 0, hi: 4000 * MD }, "mon").length < 2000);

// The extent covers actual dates as well as targets, or a step finished before
// the earliest target falls off the left edge and shows as a lone ghost.
t("an early finish before every target still fits on the line",
  out.lineSpan([{ at: at(20), actual: at(2), status: "met" }, { at: at(30), actual: null, status: "upcoming" }], at(25)).lo <= at(2));
t("and a late one past every target does too",
  out.lineSpan([{ at: at(10), actual: at(60), status: "late" }], at(20)).hi >= at(60));

// ---- drift arcs ----
// The arc's height IS the overrun, sqrt-compressed so a small drift still
// bows and a huge one stays inside the ceiling.
t("a tiny drift still bows visibly", out.arcHeight(8) > 12);
t("a big one is taller", out.arcHeight(400) > out.arcHeight(40));
t("but never past the ceiling", out.arcHeight(100000) === 34);
t("and growth slows as it goes", (out.arcHeight(40) - out.arcHeight(10)) > (out.arcHeight(200) - out.arcHeight(170)));
const dspan = { lo: at(0), hi: at(40) }, dpx = 400;
const dpts = [
  { id: "a", at: at(2),  actual: at(3),  status: "met",  variance: MD },        // 10px: drawn
  { id: "b", at: at(10), actual: at(30), status: "late", variance: 20 * MD },   // wide
  { id: "c", at: at(20), actual: at(20.2), status: "met", variance: 0 },        // 2px: too small
  { id: "d", at: at(25), actual: null, status: "missed", variance: null },      // nothing to join
  { id: "e", at: at(30), actual: null, status: "upcoming", variance: null }
];
const arcs = out.driftArcs(dpts, dspan, dpx);
t("a missed step draws no arc - there is nothing to connect to", !arcs.some((a) => a.id === "d"));
t("nor does one still to come", !arcs.some((a) => a.id === "e"));
t("a drift too small to bow is left as one mark", !arcs.some((a) => a.id === "c"));
t("the real ones are drawn", arcs.length === 2);
t("widest first, so short arcs sit on top", arcs[0].id === "b");
t("each knows which way it went", arcs.find((a) => a.id === "b").late === true);
t("an early finish reads as not late", out.driftArcs(
  [{ id: "f", at: at(20), actual: at(10), status: "met", variance: -10 * MD }], dspan, dpx)[0].late === false);
// An arc is kept whenever any PART of it crosses the window: dropping it when
// the TARGET was off-screen made arcs wink out as you panned towards them.
t("an arc whose target is off the left edge is still drawn",
  out.driftArcs([{ id: "g", at: at(5), actual: at(25), status: "late", variance: 20 * MD }],
                { lo: at(15), hi: at(35) }, dpx).length === 1);
t("and one whose actual is off the right edge",
  out.driftArcs([{ id: "h", at: at(20), actual: at(60), status: "late", variance: 40 * MD }],
                { lo: at(15), hi: at(35) }, dpx).length === 1);
t("one that spans straight across the window is kept too",
  out.driftArcs([{ id: "i", at: at(0), actual: at(90), status: "late", variance: 90 * MD }],
                { lo: at(40), hi: at(50) }, dpx).length === 1);
t("but one entirely outside it is not",
  out.driftArcs([{ id: "j", at: at(1), actual: at(3), status: "met", variance: 2 * MD }],
                { lo: at(40), hi: at(50) }, dpx).length === 0);
// The "all" flag ignores the window: that is what measures the line's height,
// so panning cannot make it jump.
// The all flag ignores WINDOW membership only - the too-small-to-bow rule
// still applies, and it is scale-dependent, so a tight window promotes a
// drift that was invisible at Fit.
t("the all flag keeps every drift, wherever it sits",
  out.driftArcs(dpts, { lo: at(35), hi: at(40) }, dpx, true).length === 3);
t("and at a wide zoom the tiny one is still left out",
  out.driftArcs(dpts, dspan, dpx, true).length === 2);
// The headroom the line needs is the tallest arc - so a line with small
// drifts grows a little, and one with none does not grow at all.
// The peak plus the 9px the arc starts above the axis: reserve exactly what
// is drawn, or a tall arc clips out of the box.
t("headroom is the tallest arc plus its lift-off", out.driftHeadroom(arcs) === Math.max(arcs[0].h, arcs[1].h) + 9);
t("and never more than the ceiling allows", out.driftHeadroom(arcs) <= 34 + 9);
t("a line with no drift asks for none", out.driftHeadroom([]) === 0);
t("and small drifts ask for less than big ones",
  out.driftHeadroom(out.driftArcs([dpts[0]], dspan, dpx)) < out.driftHeadroom(arcs));

// ---- Backup & Saves: what a copy holds, how tiers roll, what a reset clears ----
function mkSnapStore(obj){
  const m=new Map(Object.entries(obj||{}));
  return { get length(){ return m.size; }, key:(i)=>Array.from(m.keys())[i], getItem:(k)=>m.has(k)?m.get(k):null,
           setItem:(k,v)=>m.set(k,String(v)), removeItem:(k)=>m.delete(k), _m:m };
}
const SNOW=Date.now();
const seedBoard=()=>mkSnapStore({
  tt_projects:JSON.stringify([
    { id:1, name:"Rebuild", lane:"Daily Activity", parentId:null, role:"project", kind:"ongoing",
      stages:[{ id:"a", label:"Strip", done:true, doneAt:SNOW-5e6 }],
      milestones:[{ id:"m1", label:"Parts", dueAt:SNOW+8e7, targets:[{ kind:"project", id:2 }, { kind:"project", id:1 }], doneAt:SNOW-1e6 }] },
    { id:2, name:"Old bench", lane:"Daily Activity", parentId:null, role:"project", kind:"finite", closedAt:SNOW-2e6, stages:[] },
    { id:3, name:"Bench task", lane:"Daily Activity", parentId:2, role:"task", stages:[] }]),
  tt_logs:JSON.stringify([{ id:"l1", type:"project", startTime:SNOW-4e6, endTime:SNOW-1e6, duration:3e6 },
                          { id:"l2", type:"atwork", startTime:SNOW-9e6, endTime:null }]),
  tt_disruptions:"[]", tt_breaks:"[]", tt_laneorder:JSON.stringify(["Daily Activity"]),
  tt_settings:JSON.stringify(Object.assign(out.settingsFactory(), { theme:"forest", workSchedule:{ mine:true } })),
  tt_distpresets:JSON.stringify(["Phone"]), tt_modules:JSON.stringify({ tools:true }),
  tt_mod_tools_tools:JSON.stringify([{ id:"t1" }]),
  tt_test_projects:"[]", tt_testmode:"true", tt_session:JSON.stringify({ atWorkStart:SNOW })
});
{
  const st=seedBoard(), data=out.snapCollect(st);
  t("a copy holds the real board", "tt_projects" in data && "tt_logs" in data && "tt_mod_tools_tools" in data && "tt_settings" in data);
  t("never the practice board", !Object.keys(data).some(k=>k.indexOf("tt_test")===0));
  t("and never the running clock", !("tt_session" in data));
  const sm=out.snapSummary(data);
  t("its summary counts open projects, not closed ones or tasks", sm.projects===1);
  t("and the time logged against projects", sm.loggedMs===3e6);
  t("a module key names its module", out.snapModuleOf("tt_mod_tool-room_items")==="tool-room" && out.snapModuleOf("tt_logs")===null);
}
{
  const at=new Date(2026,9,7,17,0).getTime();
  const ids=out.snapIdsFor("clockout", at, "mon").map(x=>x.id);
  t("a clock-out files Latest and the day, week and month it falls in",
    ids.join(",")==="latest,daily-2026-10-07,weekly-2026-10-05,monthly-2026-10");
  const ids2=out.snapIdsFor("before-reset", at, "mon").map(x=>x.id);
  t("a before-reset copy gets Latest and its own daily entry, so a clock-out never overwrites it",
    ids2.length===2 && ids2[0]==="latest" && ids2[1]==="daily-2026-10-07-"+at);
  t("a manual save is its own slot", out.snapIdsFor("manual", at)[0].id==="save-"+at);
  const recs=[];
  for(let d=0; d<10; d++) recs.push({ id:"daily-"+d, kind:"daily", day:"2026-10-"+String(10+d), at:d });
  recs.push({ id:"daily-x", kind:"daily", day:"2026-10-19", at:99 });
  for(let w=0; w<6; w++) recs.push({ id:"weekly-"+w, kind:"weekly", at:w });
  for(let m=0; m<14; m++) recs.push({ id:"monthly-"+m, kind:"monthly", at:m });
  for(let s=0; s<5; s++) recs.push({ id:"save-"+s, kind:"manual", at:-s });
  recs.push({ id:"latest", kind:"latest", at:1 });
  const drop=out.snapPrune(recs);
  t("daily keeps every copy from its seven newest days", drop.filter(x=>x.indexOf("daily")===0).sort().join()==="daily-0,daily-1,daily-2");
  t("weekly keeps four, monthly twelve", drop.filter(x=>x.indexOf("weekly")===0).sort().join()==="weekly-0,weekly-1" &&
    drop.filter(x=>x.indexOf("monthly")===0).sort().join()==="monthly-0,monthly-1");
  t("saves and Latest never roll off", !drop.some(x=>x.indexOf("save-")===0 || x==="latest"));
  t("the numbers Brent set", out.SNAP_KEEP.daily===7 && out.SNAP_KEEP.weekly===4 && out.SNAP_KEEP.monthly===12 && out.SNAP_MANUAL_MAX===5);
}
{
  // Reset state: time and ticks go; projects, the Archive, settings and modules stay.
  const st=seedBoard(); out.resetApply(out.resetFromPick("state", out.ttModules()), st);
  const ps=JSON.parse(st.getItem("tt_projects"));
  t("reset state clears every entry", st.getItem("tt_logs")==="[]" && st.getItem("tt_disruptions")==="[]" && st.getItem("tt_breaks")==="[]");
  t("keeps every project, closed ones included", ps.length===3);
  t("and opens every stage and milestone again", ps[0].stages[0].done===false && ps[0].milestones[0].doneAt===null);
  t("but leaves settings, presets and modules alone", JSON.parse(st.getItem("tt_settings")).theme==="forest" &&
    st.getItem("tt_distpresets")!==null && st.getItem("tt_mod_tools_tools")!==null);
  t("and never touches the practice board or the clock", st.getItem("tt_test_projects")==="[]" && st.getItem("tt_session")!==null);
}
{
  const st=seedBoard(); out.resetApply({ archive:true, modules:{} }, st);
  const ps=JSON.parse(st.getItem("tt_projects"));
  t("clearing the Archive deletes closed projects and what sits under them", ps.length===1 && ps[0].id===1);
  t("and a milestone stops pointing at a project that is gone", ps[0].milestones[0].targets.length===1 && ps[0].milestones[0].targets[0].id===1);
  t("its time stays: the Archive is not the time", JSON.parse(st.getItem("tt_logs")).length===2);
}
{
  const st=seedBoard(); out.resetApply({ projects:true, modules:{} }, st);
  t("clearing projects takes the time and the lanes with them",
    st.getItem("tt_projects")===null && st.getItem("tt_laneorder")===null && st.getItem("tt_logs")==="[]");
  t("projects locks time, ticks and the Archive on", (function(){ const n=out.resetNormalize({ projects:true }); return n.time&&n.ticks&&n.archive; })());
}
{
  const st=seedBoard(); out.resetApply({ look:true, modules:{} }, st);
  const s2=JSON.parse(st.getItem("tt_settings"));
  t("resetting the look keeps the work schedule", s2.theme==="neon-dream" && s2.workSchedule && s2.workSchedule.mine===true);
  const st2=seedBoard(); out.resetApply({ schedule:true, modules:{} }, st2);
  const s3=JSON.parse(st2.getItem("tt_settings"));
  t("and resetting the schedule keeps the look", s3.theme==="forest" && !("workSchedule" in s3));
  const st3=seedBoard(); out.resetApply(out.resetFromPick("factory", out.ttModules()), st3);
  t("factory reset clears settings, presets and every module's data", st3.getItem("tt_settings")===null &&
    st3.getItem("tt_distpresets")===null && st3.getItem("tt_mod_tools_tools")===null);
  t("but leaves which modules are switched on", st3.getItem("tt_modules")!==null);
  const mods=out.ttModules();
  t("the two picks are recognised back from their ticks",
    out.resetPickOf(out.resetFromPick("state", mods), mods)==="state" && out.resetPickOf(out.resetFromPick("factory", mods), mods)==="factory");
  t("and any other mix is custom", out.resetPickOf(Object.assign(out.resetFromPick("state", mods), { presets:true }), mods)==="custom");
}
{
  // Loading: settings and each module can be kept as they are.
  const copy=out.snapCollect(seedBoard());
  const st=mkSnapStore({ tt_projects:"[]", tt_logs:"[]", tt_settings:JSON.stringify({ theme:"mine" }), tt_mod_tools_tools:"[\"now\"]",
                     tt_extra:"1", tt_test_logs:"[9]", tt_session:"{}" });
  out.snapApplyLoad(copy, st, { keepSettings:true, modules:{ tools:false } });
  t("a load puts the copy's board back", JSON.parse(st.getItem("tt_projects")).length===3);
  t("drops what the copy did not have", st.getItem("tt_extra")===null);
  t("keeps my settings when asked", JSON.parse(st.getItem("tt_settings")).theme==="mine");
  t("and a module left unticked keeps its data", st.getItem("tt_mod_tools_tools")==="[\"now\"]");
  t("never touches the practice board or the clock", st.getItem("tt_test_logs")==="[9]" && st.getItem("tt_session")==="{}");
  t("a timer running when the copy was made is dropped, not resumed", JSON.parse(st.getItem("tt_logs")).length===1);
  const st2=mkSnapStore({ tt_settings:JSON.stringify({ theme:"mine" }) });
  out.snapApplyLoad(copy, st2, { keepSettings:false, modules:{} });
  t("or takes the copy's settings and modules", JSON.parse(st2.getItem("tt_settings")).theme==="forest" && st2.getItem("tt_mod_tools_tools")!==null);
}

// ---- Day Summary: each job once, under its own parent, adding up ----
{
  const H=3600e3, L=(pid,name,pp,ppn,ms)=>({ type:"project", projectId:pid, projectName:name, parentId:pp, parentName:ppn, duration:ms });
  const projs=[{id:1,name:"Line 4 Rebuild",parentId:null},{id:2,name:"Strip old line",parentId:1},
    {id:10,name:"Bench install",parentId:null},{id:11,name:"Order parts",parentId:10},{id:12,name:"Call supplier",parentId:11},
    {id:20,name:"Paint booth",parentId:null},{id:21,name:"Mask panels",parentId:20}];
  const logs=[L(1,"Line 4 Rebuild",null,null,2*H),L(2,"Strip old line",1,"Line 4 Rebuild",H),L(10,"Bench install",null,null,1.5*H),
    L(11,"Order parts",10,"Bench install",0.5*H),L(12,"Call supplier",11,"Order parts",0.25*H),L(21,"Mask panels",20,"Paint booth",0.75*H)];
  const lines=out.daySummaryTree(logs, projs);
  const names=lines.map(x=>x.replace(/\s+\S+( \S+)?$/,"").trim());
  t("every job appears exactly once", ["Strip old line","Order parts","Call supplier","Mask panels"].every(n=>names.filter(x=>x.endsWith(n)).length===1));
  t("under its own parent", lines.indexOf(lines.find(x=>/Strip old line/.test(x)))===lines.indexOf(lines.find(x=>/^Line 4 Rebuild/.test(x)))+1);
  t("deeper levels indent further", /^    > Call supplier/.test(lines.find(x=>/Call supplier/.test(x))) && /^  > Order parts/.test(lines.find(x=>/Order parts/.test(x))));
  t("a parent that logged nothing still holds its children", /^Paint booth\s+45m/.test(lines.find(x=>/^Paint booth/.test(x))||""));
  const mins=x=>{ const m=x.match(/(\d+)h (\d+)m\s*$/), m2=x.match(/(\d+)m \d+s\s*$/); return m ? +m[1]*60+ +m[2] : m2 ? +m2[1] : 0; };
  const top=lines.filter(x=>!/^\s/.test(x)).reduce((a,x)=>a+mins(x),0);
  t("and the top-level lines add up to the day's total", top===6*60);
  t("each line includes what sits under it", /^Bench install\s+2h 15m/.test(lines.find(x=>/^Bench install/.test(x))));
  const flat=out.daySummaryTree([L(21,"Mask panels",20,"Paint booth",0.75*H)], []);
  t("without the project list, the log's own parent name is used", /^Paint booth/.test(flat[0]) && /^  > Mask panels/.test(flat[1]));
}

// ---- breaks: paid and unpaid, the allowance, the pay maths (10-22) ----
{
  const MIN = 60000, H = 3600000;
  const day = new Date(2026, 9, 21);                       // a Wednesday
  const D = day.toDateString(), PREV = new Date(2026, 9, 20).toDateString();
  const at = (h, m) => new Date(2026, 9, 21, h, m).getTime();
  const sch = (ub, pr) => out.normalizeSchedule(Object.assign({
    mon:{on:true,start:"06:00",end:"14:30"}, tue:{on:true,start:"06:00",end:"14:30"}, wed:{on:true,start:"06:00",end:"14:30"},
    thu:{on:true,start:"06:00",end:"14:30"}, fri:{on:true,start:"06:00",end:"14:30"}, sat:{on:false}, sun:{on:false},
    unpaidBreaks: Object.assign({ enabled:true, weekly:[
      { id:"m", name:"Morning Break", start:"09:00", mins:15, paid:true },
      { id:"l", name:"Lunch", start:"11:00", mins:30 },
      { id:"a", name:"Afternoon Break", start:"13:00", mins:15, paid:true } ], custom:{} }, ub||{}) }, pr ? { payroll:pr } : {}));
  const S0 = sch();
  t("the usual breaks: morning and afternoon paid, lunch unpaid",
    out.BREAK_DEFAULTS.map((b) => b.label + ":" + b.paid).join() === "Morning Break:true,Lunch:false,Afternoon Break:true");
  t("and End of Day is no longer a break", out.PRESET_BREAKS.indexOf("End of Day") < 0);
  t("a saved schedule keeps each break's paid flag", S0.unpaidBreaks.weekly[0].paid === true && !S0.unpaidBreaks.weekly[1].paid);
  t("and gains the allowance settings with safe defaults", S0.unpaidBreaks.allowMode === "scheduled" && S0.unpaidBreaks.allowMins === 0 &&
    S0.unpaidBreaks.carryOver === false && S0.unpaidBreaks.overStyle === "float" && S0.payroll.paidBreaksOt === true);
  t("only UNPAID scheduled breaks come off scheduled time", out.schNetMinutes(S0, "wed") === 510 - 30);
  t("an old schedule (no paid flags) still nets everything out, as before",
    out.schNetMinutes(out.normalizeSchedule({ wed:{on:true,start:"06:00",end:"14:30"}, unpaidBreaks:{ enabled:true,
      weekly:[{ id:"x", name:"Lunch", start:"11:00", mins:30 }, { id:"y", name:"Coffee", start:"09:00", mins:15 }] } }), "wed") === 510 - 45);
  t("the allowance is the paid scheduled breaks added up", out.breakAllowanceMins(S0, "wed") === 30);
  t("or the person's own amount", out.breakAllowanceMins(sch({ allowMode:"own", allowMins:20 }), "wed") === 20);
  t("an own amount works with scheduled breaks switched off",
    out.breakAllowanceMins(sch({ enabled:false, allowMode:"own", allowMins:25 }), "wed") === 25);
  t("and no paid breaks means no allowance", out.breakAllowanceMins(sch({ weekly:[] }), "wed") === 0);

  const rec = (id, h, m, mins, extra) => Object.assign({ id, day:D, label:"x", startTime:at(h, m), endTime:at(h, m) + mins*MIN, duration:mins*MIN, paid:true }, extra||{});
  let st = out.breakDayState(S0, [], D);
  t("a fresh day has all of it left", st.totalMs === 30*MIN && st.leftMs === 30*MIN);
  st = out.breakDayState(S0, [rec("b1", 9, 0, 15), rec("b2", 11, 0, 30, { paid:false })], D);
  t("paid breaks use it; unpaid ones do not", st.usedMs === 15*MIN && st.leftMs === 15*MIN);
  t("the break being measured is left out", out.breakDayState(S0, [rec("b1", 9, 0, 15)], D, "b1").leftMs === 30*MIN);
  let ov = out.breakOverFor(st, 24*MIN);
  t("a break past what is left runs over by the difference", ov.overMs === 9*MIN && !ov.usedCarry);
  t("within it, not over", out.breakOverFor(st, 10*MIN).overMs === 0);
  st = out.breakDayState(S0, [rec("b1", 9, 0, 15), rec("b3", 13, 0, 24, { overMs:9*MIN, overCovered:true })], D);
  t("'Just today' adds the overage to the day's allowance", st.extraMs === 9*MIN && st.leftMs === 0 && st.totalMs === 39*MIN);
  // No paid breaks scheduled and no own amount: nothing to count against.
  const SN = sch({ weekly:[{ id:"l", name:"Lunch", start:"11:00", mins:30 }] });
  st = out.breakDayState(SN, [], D);
  t("with no paid break time set, nothing is measured", st.limited === false && out.breakOverFor(st, 90*MIN).overMs === 0);
  st = out.breakDayState(sch({ enabled:false }), [], D);
  t("nor with scheduled breaks switched off (an untouched schedule)", st.limited === false);
  st = out.breakDayState(sch({ weekly:[], allowMode:"own", allowMins:0 }), [], D);
  t("an own amount of none IS a limit: every paid minute counts", st.limited === true && out.breakOverFor(st, 5*MIN).overMs === 5*MIN);
  t("and a set allowance is a limit", out.breakDayState(S0, [], D).limited === true);
  t("a missed break uses none of it", out.breakDayState(S0, [rec("mz", 9, 0, 0, { missed:true, duration:0 })], D).usedMs === 0);
  // carry-over: one day back, only when switched on
  const SC = sch({ carryOver:true });
  const yday = Object.assign(rec("y1", 9, 0, 10), { day:PREV, startTime:at(9,0) - 24*H, endTime:at(9,10) - 24*H });
  t("carry-over off: yesterday's unused time does not roll on", out.breakDayState(S0, [yday], D).carryMs === 0);
  st = out.breakDayState(SC, [yday], D);
  t("carry-over on: yesterday's unused paid time rolls into today", st.carryMs === 20*MIN && st.totalMs === 50*MIN);
  t("and a break that leans on it is flagged (a personal record)", out.breakOverFor(st, 40*MIN).usedCarry === true &&
    out.breakOverFor(st, 25*MIN).usedCarry === false);

  // what a break record is worth
  t("a paid break is worth its whole length", out.breakPaidMs(rec("p", 9, 0, 15)) === 15*MIN);
  t("an unpaid one, nothing", out.breakPaidMs(rec("u", 9, 0, 15, { paid:false })) === 0);
  t("an old record with no paid flag, nothing - as before", out.breakPaidMs({ duration:15*MIN, endTime:1 }) === 0);
  t("an overage made unpaid comes off", out.breakPaidMs(rec("o", 13, 0, 24, { overMs:9*MIN, overUnpaid:true })) === 15*MIN);
  t("an overage covered stays paid", out.breakPaidMs(rec("c", 13, 0, 24, { overMs:9*MIN, overCovered:true })) === 24*MIN);
  t("a missed break is worth nothing", out.breakPaidMs(rec("m", 9, 0, 15, { missed:true })) === 0);
  const pbl = out.paidBreakLogs([rec("p", 9, 0, 15), rec("u", 11, 0, 30, { paid:false }), rec("o", 13, 0, 24, { overMs:9*MIN, overUnpaid:true })], true);
  t("paid breaks become pay entries: the paid ones only, at their paid length",
    pbl.length === 2 && pbl[0].duration === 15*MIN && pbl[1].duration === 15*MIN && pbl.every((l) => l.type === "paidbreak"));
  t("an open break is not paid yet", out.paidBreakLogs([{ id:"open", paid:true, startTime:at(9,0), endTime:null, duration:0 }], true).length === 0);
  t("with paid breaks set not to count toward overtime, they are declared regular",
    out.paidBreakLogs([rec("p", 9, 0, 15)], false)[0].ot === false);

  // the pay rollup
  const range = { start: new Date(2026, 9, 19).getTime(), end: new Date(2026, 9, 26).getTime() };
  const satD = new Date(2026, 9, 24).toDateString();
  const job = { id:"j", type:"project", projectId:1, projectName:"P", lane:"L", startTime:at(7,0), endTime:at(15,0), duration:8*H, day:D };
  const satBreak = { id:"s", day:satD, label:"x", paid:true, startTime:new Date(2026,9,24,9,0).getTime(), endTime:new Date(2026,9,24,9,15).getTime(), duration:15*MIN };
  const roll = (brs, extra) => out.buildRollup(Object.assign({ logs:[job], projects:[{ id:1, name:"P", lane:"L", parentId:null }], range, otDays:["sat"], lanes:["L"], breaks:brs }, extra||{}));
  let r = roll([rec("p", 9, 0, 15), rec("u", 11, 0, 30, { paid:false })]);
  t("tracked time is still the jobs", r.trackedMs === 8*H);
  t("a paid weekday break adds to regular pay time", r.regMs === 8*H + 15*MIN && r.otMs === 0);
  t("an unpaid one does not", r.paidBreakMs === 15*MIN && r.unpaidBreakMs === 30*MIN && r.breakMs === 45*MIN);
  r = roll([satBreak]);
  t("a paid break on an overtime day is overtime", r.otMs === 15*MIN && r.regMs === 8*H);
  r = roll([satBreak], { paidBreaksOt:false });
  t("unless paid breaks are set not to count toward overtime - then regular", r.otMs === 0 && r.regMs === 8*H + 15*MIN);
  t("and the rollup flags that as a personal setting", r.paidBreaksOtOff === true);
  r = roll([rec("o", 13, 0, 24, { overMs:9*MIN, overUnpaid:true, personal:true }), rec("mz", 9, 0, 0, { missed:true, duration:0 })]);
  t("an overage made unpaid leaves only the allowance paid", r.paidBreakMs === 15*MIN && r.overMs === 9*MIN && r.overUnpaidMs === 9*MIN);
  t("personal records are counted", r.personalCount === 1);
  t("a missed break is counted, but not as a break taken", r.missedCount === 1 && r.breakCount === 1);
  t("an old record with no paid flag pays nothing, so old reports are unchanged",
    roll([{ id:"old", day:D, startTime:at(11,0), endTime:at(11,30), duration:30*MIN }]).regMs === 8*H);

  // the missed-break check
  const dayStr = D;
  t("a scheduled break's due time is that clock time on the work day", out.breakDueAt(S0, dayStr, { start:"11:00" }) === at(11, 0));
  const nights = out.normalizeSchedule({ wed:{on:true,start:"21:00",end:"05:30"}, unpaidBreaks:{ enabled:true, weekly:[{ id:"n", name:"Lunch", start:"01:00", mins:30 }] } });
  t("on a night shift, a break after midnight is due the next morning",
    out.breakDueAt(nights, dayStr, { start:"01:00" }) === new Date(2026, 9, 22, 1, 0).getTime());
  t("nothing is due before its time", out.missedBreakDue(S0, dayStr, at(8, 59), [], {}) === null);
  const due = out.missedBreakDue(S0, dayStr, at(9, 10), [], {});
  t("once its time has passed and it was not taken, it is due", !!due && due.name === "Morning Break" && due.paid === true && due.key === dayStr + "|m");
  t("a break started around then counts as taken", out.missedBreakDue(S0, dayStr, at(9, 20), [rec("t", 8, 50, 15)], {}) === null);
  t("snoozed, it waits", out.missedBreakDue(S0, dayStr, at(9, 20), [], { [dayStr + "|m"]: at(9, 40) }) === null);
  t("and comes back when the snooze runs out", !!out.missedBreakDue(S0, dayStr, at(9, 45), [], { [dayStr + "|m"]: at(9, 40) }));
  t("skipped, it is quiet for the day", out.missedBreakDue(S0, dayStr, at(9, 45), [], { [dayStr + "|m"]: "skip" }) === null);
  t("recorded as missed, it is quiet too",
    out.missedBreakDue(S0, dayStr, at(9, 45), [{ id:"mm", day:D, missed:true, missedKey:dayStr + "|m", startTime:at(9,0), endTime:at(9,0), duration:0 }], {}) === null);
  t("more than two hours on, it stops asking", out.missedBreakDue(S0, dayStr, at(11, 30), [{ id:"l", day:D, startTime:at(11,0), endTime:at(11,30), duration:30*MIN }], {}) === null);
  t("a day off asks nothing", out.missedBreakDue(S0, new Date(2026, 9, 24).toDateString(), new Date(2026, 9, 24, 9, 30).getTime(), [], {}) === null);
  t("the rules note says to check, and decides nothing", /HR department/.test(out.BREAK_RULES_NOTE) && /doesn.t decide what you.re owed/.test(out.BREAK_RULES_NOTE));
}
let bad = 0;
ok.forEach(([label, pass]) => { if (!pass) { bad++; console.log("   x " + label); } });
console.log("lifecycle  : " + (ok.length - bad) + "/" + ok.length + " passed" + (bad ? "  FAILED" : ""));
process.exit(bad ? 1 : 0);
