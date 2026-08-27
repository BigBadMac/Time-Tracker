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
        " mismatchedTasks, MatchTasksModal, findProj, AddNewModal," +
        " projDepth, subtreeDepth, canNestUnder, nestTargets, MAX_NEST_DEPTH," +
        " projRole, isTaskRole, isProjectRole, projectStackOrder, stackZ };")(
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

// ---- the close modal refuses, and explains ----
let blocked = "";
try {
  blocked = renderToStaticMarkup(React.createElement(out.CloseProjectModal, {
    proj: parent, blockers: out.closeBlockers(tree, parent), onClose(){}, onConfirm(){} }));
} catch (e) { blocked = "ERR:" + e.message; }
has(blocked, "still has 2 open tasks", "the refusal counts them");
has(blocked, "Risk Assessment", "and names them");
has(blocked, "Incident Log", "all of them");
t("with no way to force it through", blocked.indexOf("Close Out") < 0);

let allowed = "";
try {
  allowed = renderToStaticMarkup(React.createElement(out.CloseProjectModal, {
    proj: tree[3], blockers: [], onClose(){}, onConfirm(){} }));
} catch (e) { allowed = "ERR:" + e.message; }
has(allowed, "Close Out", "an unblocked project offers the button");
has(allowed, "kept", "and says the history is kept");
has(allowed, "Closing note", "with somewhere to say why");

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
function addNew(stage, projs) {
  try {
    return renderToStaticMarkup(React.createElement(out.AddNewModal, {
      stage: stage, laneOrder: ["Daily Activity", "Projects"], laneMeta: null,
      projects: projs === undefined ? addable : projs, onPick(){}, onClose(){} }));
  } catch (e) { return "ERR:" + e.message; }
}
const what = addNew("what");
t("the prompt renders", what.indexOf("ERR:") !== 0);
if (what.indexOf("ERR:") === 0) console.log("   " + what);
has(what, "What would you like to add?", "it asks rather than assuming");
has(what, "New Project", "a project");
has(what, "New Task", "a task - which the old menu never offered");
has(what, "New Lane", "or a lane");

const lanes = addNew("lane");
has(lanes, "Daily Activities", "picking a project offers every lane");
has(lanes, "Projects", "all of them");
has(lanes, "1 project", "with what is already in each");

const pick = addNew("project");
has(pick, "Label Printing", "picking a task offers the top-level projects");
has(pick, "Safety Report", "across lanes");
has(pick, "Has an end", "showing each project's type, which the task will inherit");
has(pick, "1 task", "and what it already carries");
t("a task is never offered as a parent", pick.indexOf("Risk Assessment") < 0);

has(addNew("project", []), "No projects yet", "with nothing to hang a task on, it says so");
t("and does not offer an empty list", addNew("project", []).indexOf("New Task Under") < 0);

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

let bad = 0;
ok.forEach(([label, pass]) => { if (!pass) { bad++; console.log("   x " + label); } });
console.log("lifecycle  : " + (ok.length - bad) + "/" + ok.length + " passed" + (bad ? "  FAILED" : ""));
process.exit(bad ? 1 : 0);
