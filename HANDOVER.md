# Time Tracker — session handover

Current build: **`10-08 splash timing`**

```
tt-tests.js  1541 assertions   182 cases   (static, no browser)
boot.js        71 checks                    (renders the built file)
shift.js       46 checks                    (work days, shifts, overtime)
lifecycle.js  496 checks                    (projects, nesting, archive, scheduling)
```

## Container resets lose the toolchain

A conversation that outlives its container comes back with only what was
staged. `shift.js`, `paint.js`, `build.py` and `extract.py` are NOT written to
outputs by the normal loop - re-attach them, or there is no way to build or
run the full suite. Everything else (source, index.html, tt-tests, lifecycle,
e2e, boot) is staged each time.

Two environment assumptions that have already broken fixtures:
- **The container timezone is not always UTC.** A fixture built from
  `days * 86400000` is only local midnight in UTC; assert the RULE (one tick
  per day, spacing) rather than an exact inclusive count.
- **No network egress.** The app links Google Fonts, and every page load sat
  waiting on it until e2e launched Chromium with
  `--host-resolver-rules=MAP fonts.googleapis.com 127.0.0.1`.

## Start of every session

The container is wiped between conversations. Attach all nine files below, then:

```
python3 extract.py index.html /tmp/app_only.js
node tt-tests.js time-tracker.jsx
node boot.js /tmp/app_only.js
node shift.js /tmp/app_only.js
node lifecycle.js /tmp/app_only.js
```

All four must pass before anything is changed. If they don't, the attachments are
out of sync with each other — fix that first.

## Build

```
python3 build.py --src time-tracker.jsx --shell index.html \
        --out index.html --stamp "MM-DD short descriptor"
```

`build.py` splices the JSX into the PWA shell in place. Keep a copy of the shell
if you are rebuilding repeatedly — the script reads and writes the same file.

`paint.js` renders App's first paint to stdout. Diff it before and after a change
to prove the board is untouched. Render both in the same minute: the header shows
a wall clock and a stale comparison will differ on that alone.

## The files

| File | What it is |
|---|---|
| `time-tracker.jsx` | The whole app. Source of truth. |
| `index.html` | Built PWA. What GitHub Pages serves. |
| `build.py` | Splices the JSX into the shell. |
| `extract.py` | Pulls the app payload back out for the harnesses. |
| `paint.js` | First-paint markup, for diffing builds. |
| `tt-tests.js` | Static suite. Contract, reference module, host wiring, Extensions, Tool Tracker. |
| `boot.js` | Evaluates the built file with real React and a stub DOM. |
| `shift.js` | Work-day resolution, overnight shifts, overtime. |
| `lifecycle.js` | Project types, closing out, nesting, the archive, scheduled starts. |
| `MODULES.md` | Module platform contract and Tool Tracker. |

## Architecture in one paragraph

Vanilla React via `React.createElement` — no JSX compilation, no build step beyond
the splice. Everything inlines into one `index.html`. A module platform (`TT`)
sits between the core and optional modules; Tool Tracker is the only one shipped
and is off until switched on in Extensions. Storage is `localStorage` under `tt_`,
which is what makes Backup & Restore whole.

## Rules that keep biting

- **No direct `localStorage` in a module.** Only `ctx.storage`.
- **Tokens are live.** `S` read per render, never cached at load.
- **Durations through `fmt.dur`**, or the Tenths setting silently stops working.
- **Modals are siblings via `React.Fragment`**, never nested inside a
  backdrop-filter surface.
- **Stacking:** project cards 60 down, lifted rows 70, lane 90, header dropdowns
  200, below-header 300, modals 900, toast 950.
- **Form fields are pinned at 16px.** Under that, iOS Safari zooms on focus and
  never zooms back — the app is left larger after a modal closes.
- **Declare before the early return.** `ProjectCard` returns early when collapsed;
  `var` hoists the name but not the value, so anything declared below it is
  `undefined` up there.
- **Select values are strings; project ids are numbers.** Every child lookup is a
  strict `===`. Resolve a picked id back to the real one or the record is orphaned.
- **Fit a glyph by measuring it, not by eye, and look at a render before
  shipping it.** A composition of rotated or arced pieces has a bounding box
  nowhere near the numbers in its path data: the tap icon measured 28.1 x 23.3
  units in a 28 box and built clipped, with all four suites green. Rasterise the
  glyph from the *built payload* and check it. `tt-tests` now bounds the ripples
  analytically, but nothing covers the hand.
- **The header runs opposite to the page.** The root mirrors on handedness via
  `dir`; the header bar adds `row-reverse` unconditionally on top, which
  inverts it under both `dir` values because a reversed row in RTL already
  reads left to right. Anything anchored to a header button must key off
  `hdrMenuRight`, not `isLeft`, or it opens off screen on both settings.
- **Action rows are written Save first, Cancel second, always.** The mirroring
  is done by `ACTION_DIR()`, so source order never depends on the hand. A row
  that hardcodes its own `flexDirection` will mirror the wrong way on one hand
  while the shared bar mirrors the right way.
- **React registers `touchmove` at the root as passive, so `preventDefault`
  inside an `onTouchMove` does nothing.** `touch-action:none` alone did not stop
  the page scrolling under a drag. Anything that needs to cancel a touch gesture
  must add its own native listener with `{ passive:false }` and remove it after.
- **Bind that listener synchronously in the touchstart handler, never from an
  effect.** An effect runs after the render the gesture schedules, by which time
  the first touchmove has landed and the browser has committed to a scroll -
  after that every event arrives `cancelable:false` and refuses preventDefault.
  The symptom was direction-dependent: the row dragged one way, where the
  scroller had nowhere to go, and not the other.
- **A harness assertion that reads a listener must be guarded.** Calling
  `liveOn(x)[0].fn` when the binding is gone throws and takes the rest of the
  suite with it, so the mutation reports a crash rather than a clean failure and
  every later check goes unrun.
- **Regenerate the payload after every source edit.** The harnesses test the
  file they are handed, so testing a stale `/tmp/app_*.js` reports the old
  behaviour - it showed this fix missing when it was already written.
- **Inside the board, `dir` already mirrors a flex row - do not mirror again.**
  The root is `dir=rtl` when left-handed, so writing a glyph before its title is
  all that is needed for it to land after the title on that hand. An explicit
  `UI.left` conditional cancels the mirror and pins the glyph to one side on
  both, which is what the modal header was doing.
- **`e2e.js` drives the built file in a real browser** (`node e2e.js index.html`).
  It is NOT part of the mandatory four: it needs Playwright and a browser
  binary, which a fresh container may not have. Run it when a change touches
  something only a real layout or a real click can show. The off-shift bug was
  invisible to all four suites - the code read correctly and the board simply
  came back with nothing running.
- **Playwright's `hasText` is a case-insensitive substring match.** `'Start'`
  also matches the header's "Clock In / start day", which made an e2e test
  click the wrong button and report a working fix as broken. Anchor to a
  container and match exactly: `.filter({hasText:/^Start$/})`.
- **Why buttons, not dragging.** Five fixes over two sessions failed to make
  drag work on iOS: effect-vs-touchstart binding, panel overscroll, document
  rubber-band, 44px handle, press-and-hold. The on-device trace finally showed
  Safari committing the touch to scrolling before the first touchmove, with
  `touch-action:none` ignored, first on the page and then on the sheet. There
  is no event-level fix. Buttons have no gesture to lose. Do not reintroduce
  dragging here.
- **Placement belongs to the outline, details to the panel.** `ProjectForm`
  takes `structure` (default true). From the outline it is false: the three
  placement controls are hidden AND `lane`/`parentId`/`role` are left out of
  the payload, so the panel cannot write over an arrangement the outline is
  still holding. That last part is a safety property with no failing case
  today - it is guarded in `tt-tests`, not `e2e`.
- **The outline must stay mounted while a child editor is open.** Its moves
  live in local state, so closing and reopening would discard them. That means
  three things together: the child editors are declared AFTER the outline so
  they paint above it at the same z-index; the controller takes `suspended` so
  it does not float over them; and `mergeOutline` folds a changed board back
  in - content from the fresh read, sequence and indent from what is on screen.
  A row made by an unsaved conversion has no counterpart in the fresh read, so
  it is kept on its own account and its source record suppressed, or the
  outline shows both.
- **The outline's rules.** A row's parent is the nearest row above with a
  smaller indent. Up/down move among siblings; at the edge one more step
  leaves the parent and ASKS first. Left/right change indent; a lane stepped
  in becomes a project, a top-level project stepped out becomes a lane, and
  both ask. `nestRoles` decides what a row may become: a project holds either,
  a task holds only tasks. The role is chosen in the controller, never
  inferred - `stepIn` refuses a role the host cannot hold.
- (superseded) Why press-and-hold. With the body pinned, the second trace still read
  "N moves, N uncancelable": Safari had claimed the SHEET's own scroll before
  the first move. Nothing can be won at the first move. But while the finger
  is still no gesture exists, so the lift and the panel's overflow flip both
  happen during the hold - and by the time the finger moves there is nothing
  for Safari to claim. Flipping overflow mid-drag cancels the touch; flipping
  it during the hold does not. This is how iOS reorders its own lists.
- **iOS Safari does not honour `touch-action:none` on the drag handle.** The
  on-device trace (Test Mode, Edit..., drag) read "start on handle" then "260
  moves, 260 uncancelable": the gesture was committed to scrolling before the
  first touchmove was dispatched. No listener, passive or not, can get in
  first, and four fixes at the event level (effect timing, touchstart
  binding, panel overscroll, document rubber-band) were therefore all
  irrelevant. The fix is to leave the browser nothing to scroll: `freezePage`
  pins the body while a drag sheet is open. Chromium reproduces none of this.
  The trace stays in Test Mode; read it before theorising about any drag bug.
- **`preventDefault` on touchmove cancels ordinary scrolling but NOT WebKit's
  rubber-band at the document's top edge.** That bounce is handled outside the
  event pipeline. Dragging a row DOWN from near the top ran into it and moved
  the whole window; UP hit ordinary scrolling and was cancelled - hence the
  direction-dependence that three earlier fixes (effect timing, touchstart
  binding, panel overscroll) each got half right. The lock has to be on the
  document: `overscroll-behavior:none` on html/body, and a class applied to
  `<html>` from inside touchstart. Chromium touch emulation does NOT reproduce
  any of this - it has no rubber-band - so an iPhone is the only real test.
- **In an e2e drag, aim at the row, not its handle.** The handle is an 18px
  glyph centred in a 36px row; "10% down the handle" lands 7px from the row's
  centre and reads as a drop-onto. `locator('..')` for the row's box.
- **An `addInitScript` re-seeds storage on every navigation**, so writing
  storage and reloading restores the old fixture. New fixture, new page.
- **The outline has no parent field.** A row's parent is the nearest row above
  it with a smaller indent, and `outlineCommit` reads lane, parent and order
  back out of position and indent alone. Nothing to keep in step, so position
  and parentage cannot disagree.
- **The drag is free; the drop is checked.** The hierarchy is typed - a lane
  cannot sit inside a project, a stage needs a node to hang off, a node needs
  a lane - so `moveOutline` returns null and the row springs back with a
  message. Refusing visibly beats silently correcting to something legal.
- **A drop on a row's own index is a pure indent change, not a move into
  itself.** Guarding `to >= from` instead of `to > from` made sideways
  dragging do nothing at all; only the browser test caught it.
- **A lane accent is not automatically readable as text.** The accents are
  chosen as borders and fills; measured on the painted result they sit at
  5.1-5.7:1 on the dark card but 3.2-3.6:1 on the light one, under AA for both
  title sizes. `readableInk` nudges the accent toward the surface's text colour
  and stops the moment it clears 4.5:1 - stopping matters, or every lane
  converges on the same ink and the colour coding is lost.
- **Playwright is available and is the only way to settle a layout question.**
  `dir`, `flex-direction` and `justify-content` interact, and static markup
  cannot show where anything lands. Seed settings with `addInitScript` on
  `localStorage`, then `goto file://`, then read `getBoundingClientRect`.
  Reasoning about it in the abstract produced a confident wrong answer.
- **`UI.left` is assigned inside App's render, not by `applyTokens`.** A
  harness that renders a component in isolation gets `left:false` whatever the
  settings say, so a handedness check there silently passes. Set `UI.left`
  directly when testing a mirrored layout.
- **Measure a row, never assume its height.** `dropIndex` divides the drag
  distance by a measured row pitch; the field height moves with the theme, so a
  hardcoded guess drops on the wrong index. Before the first measurement the
  pitch is 0, and dividing by it would send every drop to index 0 and reshuffle
  the board - `dropIndex` guards that explicitly.
- **All four suites were green while every add in the app crashed.** None of
  them added a record through the outline and then re-rendered it - the
  hook-count mismatch only shows when a list gets longer. A feature that
  changes the length of a rendered list needs a test that changes it.
- **`tt-tests` reads source, so it CANNOT see a deleted definition.** A build
  in which the entire outline model had been cut passed 1200/1200: every call
  site still matched. Only the evaluated harness caught it, as a bare
  ReferenceError. There is now a test asserting each key function is DEFINED
  exactly once (`^function <name>`), not merely referenced. When removing a
  block, cut by exact function boundaries - section headers lie, because later
  work gets inserted under them.
- **`tt-tests` reads `MENU_GLYPHS` as a literal, not with a regex.** The last
  number in an entry is a stroke width for some kinds and a corner radius for
  others; a regex read a fill's rx as a 0.6 stroke and failed a correct glyph.
  Kinds and their arity: `p` 3, `c` 5, `r` 7, `f` 6.
- **`f` is the only filled kind, and only the gauge uses it.** Everything else
  in the set is an outline. A level cannot be drawn as a stroke.
- **Glyph resolution is tested in `lifecycle`, not `tt-tests`.** The map, the
  prefix list and the lookup order can each be right in source and still
  resolve wrongly; three mutations survived the source-level checks.
- **Glyph work is a two-stage render.** Show the options in Neon Dream dark
  only; once one is settled, re-render it in BOTH themes and BOTH modes before
  committing. `frosted` has `modalBg:"transparent"` - it is a glass theme with
  a backdrop filter - so a mock that treats that as a colour renders black and
  will look like a contrast bug that is not there.
- **New menu glyphs go in `MENU_GLYPHS`, never hand-written at the call site.**
  A local `<svg>` carries its own size and weight and answers to nothing, which
  is how the set drifted apart before. Entries are geometry only: `["p",d,w]`,
  `["c",cx,cy,r,w]`, `["r",x,y,w,h,rx,w]`. A weight under 2.5 means that part
  should recede behind the main shape; everything else sits on 2.5.
- **Icons: offer options before refining.** Four or five distinct candidates,
  rendered at true size as well as large, then refine the one chosen. Stroked
  line art, 28-unit grid, 2.5 weight, round caps and joins, no fills - the clock
  is the reference. Where a glyph is scaled, pre-divide its stroke so it lands
  back on 2.5, and keep the scale in a named constant the transform also reads.
- **Menu sizing goes through `MENU_FONT` and `MENU_ICON`.** A row that sets its
  own size drifts away from the header buttons the menu drops out of.
- **A group in the settings menu is a modal, never an accordion.** Expanding
  inline pushes the rest of the menu past the bottom of a 72vh scroller, so
  choosing a group hides everything else. Add groups via `MenuGroupModal`.
- **Scope a source-level assertion to the region it means.** Both new menu
  tests passed against a mutant at first: one searched the whole file for text
  that also appears in a sibling function, the other bounded a slice with a
  comment marker that matches 17k characters earlier. Slice by function or by
  block, and anchor `indexOf` searches from the start of that slice.
- **A harness must assert against the payload it was handed**, never against
  `time-tracker.jsx` on disk. Source-level checks that read the file pass no
  matter what was actually built. `lifecycle.js` had this bug; it is fixed, but
  the same shape is worth watching for anywhere else.
- **Absent fields mean the old behaviour.** `kind`, `role`, `closedAt`, `startAt`
  and `endAt` are all read through functions so projects that predate them keep
  behaving exactly as they did. Nothing migrates.

## Recent work, newest first

- The outline's Save/Cancel are `position:sticky` at the foot of the sheet,
  so an edit at the top of a long list saves without scrolling down. The
  controller FLOATS OVER them while a row is selected - moving and saving are
  separate moments, and DONE (now a bordered button, like EXIT) puts the
  controller away with Save underneath it. The sheet does not shrink; the list
  keeps 11rem under it while the controller is up so a selected row near the
  foot can still scroll clear. `Modal` keeps an unused `shrinkBy` prop.
- **FIXED: every add in the app crashed** (React #310, seen on the phone as
  "Script error"). Cause: `useTaps(...)` called inside `rows.map()` in the
  outline - a hook in a loop. It held until the row count changed, which is
  what adding a record does, then React threw and the app was dead until
  reload. The name is now its own component, `OutlineName`, with the hook at
  its top level. `tt-tests` has a guard for the class: no `use*` call inside
  any `.map(`/`.forEach(`/`.filter(` callback. That guard fails the exact build
  that shipped. e2e adds through every outline route and watches the row count.
- **Leaving the tutorial resets it** (`leaveTutorial`): every `tt_test_*`
  store goes back to its shipped seed. The exit dialog always claimed this and
  never did it - leaving only flipped the mode flag - so a device kept whatever
  the last visit left behind, including a seed from an older version. Both ways
  out (banner EXIT, menu row) go through the same confirm, and `tt-tests`
  asserts `setTestMode(false)` appears exactly once, inside the reset.
- A project's row menu leads with **Add a project here** (a nested PROJECT,
  not a task) above Add a task here. Nesting alone cannot say which is wanted,
  so `showAdd.role` carries the request and `ProjectForm` honours it via
  `defaultRole`; the sheet titles itself "Add Nested Project" or "Add Task".
- **A render crash now names itself.** The phone reported `Uncaught Error:
  Script error.` at line 0:0 - window.onerror cannot see inside a React render.
  `TTBoundary` wraps the app (the exported `App` is the wrapper; the board is
  `TTBoard`) and prints message, stack and component stack into a `data-crash`
  block. It degrades to a pass-through when `React.Component` is missing, so
  the stub-React harnesses still run.
- **Two baselines, and they are the shipping defaults.** FIRST RUN: two lanes
  (`First Lane`, `Second Lane`) holding First Project / First Stage and Second
  Project / Second Task / Second Stage - skeletal, and every name says what the
  thing IS, so the vocabulary arrives before any example. TUTORIAL: three lanes
  (`Daily Routine`, `Current Jobs`, `When Time Allows`), seven records covering
  task vs project, finite vs ongoing, a scheduled start, an end date and a
  part-done stage run, plus seeded logs, disruptions and a break.
- **Tutorial times are RELATIVE to today** (`tutAt(daysAgo,h,m)`), so it always
  looks current. Help pages must not quote specific figures - they move daily.
- **LANES WERE SHARED BETWEEN THE TWO MODES.** Renaming, recolouring,
  reordering or deleting a lane inside the tutorial did it to the real board.
  Now `tt_test_laneorder` / `tt_test_lanemeta` mirror the project stores, and
  `laneOrder`/`laneMeta`/their setters switch on `testMode` like everything
  else. The switch MUST be declared after the four useStates - `var` hoists the
  name but not the value, and putting it first rendered a blank board.
- **Test mode is now the Interactive Tutorial.** The 24px frame on all four
  sides is replaced by ONE bar at the head with an EXIT button. `FW` is 0, so
  the tutorial and the real board lay out identically - which matters because
  help-page screenshots have to match what a user sees.
- The tutorial bar is `dir="ltr"` and pinned `top:0`: it never mirrors with
  handedness and never follows the header to the bottom. It is a state you are
  in, not a control you reach for, and the head is where a thumb does not land
  while working the board - so EXIT cannot be hit by accident. EXIT goes
  through the existing confirm, because leaving clears the tutorial's data.
- The Add New chooser shows the lane / project / task glyphs instead of
  coloured dots, as do its pick-a-lane and pick-a-project lists. `dotOf` is
  gone.
- **MILESTONES - model only so far, nothing drawn.** A tracker is a
  `milestones` array on a PROJECT record, beside `stages`. A step:
  `{ id, label, dueAt, targets:[{kind,id}], doneAt|null, note }`. Its ACTUAL
  is when its expectation was met - the last target's `closedAt`, or a hand
  mark, whichever came first. Status from target, actual and now: met / late /
  missed / upcoming; worst wins in that order (`MS_RANK`). Lanes and the board
  OWN NOTHING: `laneLine`/`boardLine` roll up from the level beneath, one mark
  per child at its `projectCurrent` - earliest outstanding target, worst
  outstanding colour; rests at the last target, met, once nothing is open.
  `lineSpan` widens short spans to a week; `tickUnit` is days under a month,
  weeks past; `groupMarks` merges marks within N px, keeping every member so
  the dots above a shared sign can show each colour. All pure, all in
  lifecycle; twelve mutations caught.
- **MILESTONE EDITOR built.** `MilestoneEditModal` (the line at full width
  with labels, steps as rows in the line's order, + Add step, Save writes
  `milestones` on the project and nowhere else), `MilestoneStepModal` (label,
  due date + time, targets picked from the records beneath the project,
  NOTES, Mark met now, Delete at the far corner), `LaneMilestonesModal` (the
  roll-up line, projects with their standing, tap one to edit; Done, no Save).
  `MilestoneLine` is the ONE drawing every line uses. Menu entry "Milestones"
  last on a lane and on a project via the shared builder; never on a task.
- **Gotchas from the build.** (1) `applyTokens` copies tokens BY NAME - the
  five `ms*` tokens drew black until copied there; guarded now. (2) The work
  schedule is `settings.workSchedule`, not a local; `tt-tests` cannot see an
  undefined reference. (3) A card popup auto-scrolls into view with a SMOOTH
  scroll, and a tap during it is dropped as scrolling - e2e must settle
  ~1200ms after opening one, and tap popup rows at coordinates, because
  Playwright's own pre-click scroll trips the same close-on-scroll. That
  dropped-tap window exists for a real thumb too.
- **MILESTONES IN THE REPORT.** `milestoneReport(projects, laneOrder, from,
  to, now)` - pure, in lifecycle, 8 mutations caught. Steps belong to the
  period their TARGET fell in (a step met in June against a May target is
  May's, counted late). Returns due/met/late/missed/open, on-time % (measured
  against what was MET, not what is still open), worst and average slip,
  average early, missed list (earliest first), late list (worst first), next
  three ahead, and the window's points for the line. The section sits between
  the stats and the project breakdown, with `MilestoneLine` at full width and
  labels, and it is in the copy-out too. GOTCHA: a range carries
  `start`/`end` (end exclusive), NOT `from`/`to` - passing those made the
  window undefined and the section silently never appeared.
- e2e GOTCHA: pages from the same browser SHARE one storage profile, so a
  test that depends on a store starting from its seed needs its own
  `b.newContext()`, not just `b.newPage()`.
- e2e GOTCHA, cost an hour: a milestone fixture built from `now - N days`
  drifts. Which steps land inside a report window depends on the weekday AND
  on which side of midnight the clock is - it passed in the afternoon and
  failed after the container rolled past midnight. Anchor fixtures to
  MIDNIGHT TODAY (`mid.setHours(0,0,0,0)`), put "already due" steps a few
  seconds after it, and read the **Day** period, whose window is exactly
  today. Verified identical at five clock positions including a Monday
  rollover and month-end.
- **The tutorial ships a tracker**: five steps on Install new workbench in
  every state at once (met-because-its-target-closed, met late, missed, two
  upcoming) plus two on the nested Electrical hookup so the roll-up has
  something to gather. "Clear the old bench" is closed out in the baseline,
  which is what makes "Bay cleared" read as met without touching a milestone.
- **A PROJECT line now expands fully too** (`subtreePoints` on the card, the
  outline and the editor's line). It used to collapse each child to one
  aggregate mark, which hid the children's own steps - inconsistent with lanes.
- **LEAVING THE TUTORIAL KEEPS YOUR WORK.** It used to reset on the way out,
  which is wrong for somewhere you come back to and carry on building.
  `leaveTutorial()` now only leaves; `resetTutorial()` is reached by a HELD
  "Reset tutorial" in the exit sheet (`data-tutorialreset`), which says what
  it throws away. Fourth held destructive control in the app.
- **TUTORIAL BASELINE IS VERSIONED - `TUTORIAL_SEED`. BUMP IT whenever any
  TEST_* data changes.** The tutorial's stores persist and were only seeded
  when EMPTY, so any device that had ever run the tutorial kept its first copy
  forever and saw NONE of the later baseline work - milestones, the completed
  pill, the tick scale. On load, a stored `tt_test_seed` that does not match
  re-runs `resetTutorial()` - but ONLY while `tt_test_touched` is unset.
  Once someone has built something in the tutorial it is theirs, and a version
  bump must never take it; they get the Reset button instead. This
  is what "I'm not seeing it in the tutorial" was; the feature was fine, the
  data was stale. The old advice about clearing it by hand is obsolete.
- **OPENING SCREEN.** `SplashScreen`: the app glyph, "Time Tracker", and
  `APP_VERSION` ("1.0"). Held `SPLASH_SHOW_MS` (2500ms - Brent's pacing), faded over
  `SPLASH_FADE_MS` (320ms), and a tap dismisses it at once. It is a SIBLING of
  `TTBoundary`, not inside it, so a crash in the board shows the crash report
  rather than a frozen splash; `pointerEvents` goes to none the moment it
  starts fading; its timers are cleared on unmount. zIndex 1000, above modals.
  APP_VERSION is the public number - **bump it by hand on a release**. The
  build stamp in the boot div is untouched and is still what proves which
  deploy landed.
- NOTE: a constant named `*HOLD_MS` trips the drag-apparatus guard in
  tt-tests (`HOLD_MS` is a banned identifier). Hence `SPLASH_SHOW_MS`.
- **e2e: every page load calls `dropSplash(pg)`.** The splash covers the board
  for 2.5s and its first tap is consumed dismissing it, so a test that starts
  tapping before then loses its first click. `dropSplash` taps the corner and
  waits for the overlay to go. Applied after every goto/reload except the
  splash's own test. Lengthening the hold broke the suite until this existed -
  if a new e2e page hangs waiting for something to open, this is why.
- **DRIFT: the bright sign sits on the date it ACTUALLY happened**, a ghost
  (hollow head, dashed post, 0.42 opacity) stays at the target, and a dashed
  arc joins them. `driftArcs` / `arcHeight` / `driftHeadroom`, pure, in
  lifecycle. Height is the overrun, sqrt-compressed AND capped
  (`DRIFT_MAX_H` 34): straight-proportional let a six-week slip eat the panel,
  a flat cap made every long drift look alike. Drifts under `DRIFT_MIN_PX` (7)
  are left as one mark. Widest arc first, so short ones sit on top. Missed and
  upcoming steps have no actual, so they get neither arc nor ghost.
- **The height is LOCKED while panning.** Headroom is measured over EVERY
  drift at the current zoom (`driftArcs(..., true)` ignores window
  membership), not just the arcs on screen, or the line jumped each time one
  scrolled in or out. It still changes between zoom LEVELS, because the arcs
  genuinely resize there.
- **An arc is kept when any PART of it crosses the window**, not only when its
  target does: arcs used to wink out as you panned towards them. Off-screen
  ends are clipped by the viewBox, which reads as a line heading out of view.
- **The line GROWS BY EXACTLY the tallest arc** (`driftHeadroom` = peak + 9)
  and by nothing at all when there is no drift: 34px clean, ~68 with short
  drifts, ~77 at the ceiling. A quadratic Bezier peaks at HALF its control
  offset, so the control is 2h and the peak is h - reserve h, not 2h.
- `lineSpan` counts ACTUAL dates as well as targets, or a step finished before
  the earliest target falls off the left edge and shows as a lone ghost.
- e2e: drift made the strips taller and broke an older test's scroll maths.
  Use `scrollIntoView({block:"center"})` + settle before tapping anything on a
  crowded board - "into view" alone can leave it under a bottom header.
- **TICKS SLIDE WITH THE ZOOM** (`tickScale` / `lineTicks`, pure, in
  lifecycle): over a month → minor = week, major = month; a week to a month →
  minor = day, major = week start; under two days → minor = hour, major = day.
  Major ticks are taller (8 vs 3) AND thicker (2 vs 1) so they read as
  boundaries. `data-tick="major|minor"`. A 2000-tick guard stops a bad span
  flooding the line.
- **Week boundaries follow the user's own pay week** (`weekStartOf(schedule)`
  → `payroll.weekStart`, default mon), not an assumed Monday. The schedule is
  threaded board → lane → card → nested card, and into every MilestoneLine.
  GOTCHA: a blanket regex added `props.schedule` inside `TTBoard`, which has
  no `props` - "props is not defined" took the whole board down. Check the
  scope of every site a bulk edit touches.
- **Add New removed from the settings menu** (Brent). It was the chooser's
  ONLY entry point, so `AddNewModal`, its state and its mount went too rather
  than leave unreachable code with state behind it; its lifecycle block went
  with it. Adding is still reached from every row menu on the board and in the
  outline. **Interactive Tutorial moved to the TOP of that menu.**
- **A parent line shows the FULL extent beneath it.** `subtreePoints` gathers
  every step under a record; `laneLine` concatenates its projects' subtrees,
  `boardLine` its lanes'. Each point carries `owner`/`ownerId`/`own`. The
  aggregates (`projectCurrent`, `laneCurrent`) are still the SUMMARY - what
  colours a collapsed lane and what the report quotes - not the line.
- **ZOOM: tap to step, hold for Fit, drag to pan.** `MS_ZOOMS` = Fit / 3
  months / 4 weeks / 7 days, wrapping. `zoomSpan` centres a window and clamps
  it to the line; `panSpan` shifts by a proportion of the window and clamps
  the same way; `MilestoneLine` takes a `span` prop and draws only the marks
  inside it. Deliberately NOT charge-and-slide: a charging fill in this app
  means something irreversible is about to happen, and zoom is harmless.
  Panning is enabled only when zoomed (`touchAction:"pan-y"` so the page still
  scrolls), and a drag that never moved opens the sheet. NOTE: horizontal
  drag inside a vertically scrolling page is the class of gesture iOS fought
  over drag-to-reorder - test panning on the phone early.
- The zoom control looks the SAME at every level, Fit included (it was a dim
  outline on a dim panel at Fit and nearly invisible), and the strip sets NO
  flexDirection of its own - the root's `dir="rtl"` already mirrors that row,
  and doing it twice put the control left of the line for BOTH hands. Written
  line-then-control so it lands at the thumb edge. Its LABEL carries
  `dir="ltr"`, or the rtl root reverses the words: "3 months" read as
  "months 3". Placement mirrors; text does not.
- **The pannable line says so two ways, and only when there IS more line:**
  the edges FADE (so the line visibly continues) and a scrollbar under it
  shows where the window sits and how much of the whole is in view. `fullSpan`
  is passed only when zoomed; the line adds 6px of height for the bar.
- `MilestoneStrip`'s `if(!points.length) return null` sits AFTER its hooks. A
  conditional return before a hook is the #310 bug again; asserted.
- **RULE: no sheet draws its own action row.** Save / Cancel / Delete / a
  hold go through Modal's `actions:` prop, which renders `ModalActions`:
  sticky, mirrored for handedness, at the header's end (top or bottom).
  Twelve sheets converted; the outline's private sticky wrapper is gone; the
  step sheet's mark rides in the box as its own row above the three.
  `tt-tests` asserts zero inline `ACTION_ROW()` remain.
- **FIXED: Save sat on the right for BOTH hands.** The app root flips to
  `dir="rtl"` for a left-hander, which already mirrors every flex row, and
  `ACTION_DIR()` flipped too - two mirrors cancelled. It is a constant
  `row-reverse` now: one mirror. e2e measures Save under the thumb both ways.
- e2e gotcha: setting `scrollTop` from a test fires a scroll event, and a tap
  inside the app's scrolling window is dropped - settle ~700ms after it.
- **COMPLETED RECORDS STAY ON THE BOARD, minimised.** A record used to
  vanish the moment it was completed, which gave no confirmation anything had
  happened. Now it collapses to a greyed, dashed, struck-through pill saying
  COMPLETED (or ABANDONED / SUPERSEDED, from `closedOutcome`) next to its
  name, sunk below live work at its own level, most recent first. HOLD to
  reopen (`data-reopen`, `HOLD_DELETE_MS`); a tap does nothing.
  `var liveProjects=projects` - the board no longer pre-filters. TWO LISTS in
  ProjectCard: `childTasksAll` is DRAWN (finished included, `sinkClosed`),
  `childTasks` is COUNTED (open only) - or a finished task would still read as
  outstanding in "3 tasks". Both pills sit AFTER every hook.
- **COUNTS ARE OF WHAT IS THERE, not what is left** - at every level, and
  this is load-bearing: an outstanding-only count read "0 tasks" once every
  task was done, so the expander vanished and the finished tasks it was
  hiding could never be opened again. The contents pill now reads
  "2 tasks - 1 done" (`totalTasks`/`openTasks`/`doneTasks`), the LANE count
  reads "2 - 1 done" (`data-lanecount` carries the raw number), and EVERY gate
  that opens the contents tests `childTasksAll.length`, never `childTasks`.
  A nested card is handed `kidTasksAll` so it applies the same split itself.
  The completed pill does NOT take the `-12px` nested tuck: that headroom is
  for a nested CARD under its parent's title, and on a slim pill it landed on
  the parent's bottom border.
- **COMPLETE built.** A record with no stages gets a Complete `HoldButton`
  where the gauge would sit, on project cards AND task rows (`data-complete`).
  Held for `HOLD_DELETE_MS`; a tap does nothing. Reaches the closure sheet.
- **The closure sheet (`CloseProjectModal`, rewritten)** asks outcome (done /
  abandoned / superseded), when it was completed (editable, future refused),
  closure notes - and for OPEN CHILDREN, the rule Brent set: EVERY open child
  must be MOVED to a chosen parent (`MoveTargetModal`: top of any lane, or any
  open project outside the closing record's subtree) or DELETED, one at a time
  on its row or all at once on the ALL line, and Complete is BLOCKED until
  each is decided. Nothing is ever closed over silently - there is no "close
  them too", and no refusal either. `doCloseOut(proj, opts.resolutions)`
  applies them: a moved child takes its chosen parent and lane (its subtree
  comes along); a deleted child goes with its whole subtree; an undecided
  child returns without doing anything, belt and braces behind the sheet.
  The "in the future" warning keys on the time ALONE - it once fired because
  `ok` was false for undecided children.
- **The last stage ticked OFFERS** (`StagesDoneModal`): Complete it / Add
  more stages / Not now - for any open record, finite or ongoing, children or
  not. It used to jump to the close-out, finite only, children blocking.
- **This is how a milestone step goes green without touching the milestone:**
  complete a target record and the step that expected it turns met on the
  board. e2e proves it: grey signpost -> green after holding Complete.
- **`HoldButton` is the ONE hold control.** It wraps `useHold` and draws
  `HoldFill` - a fill that charges across the button for the length of the
  hold and snaps back on release. `tt-tests` asserts useHold is called exactly
  once (inside it) and HoldFill drawn exactly once (inside it): a hold cannot
  exist without its fill. Tap and hold are both props; a Delete has no tap.
- **Every Delete that opens something is HELD** (`HOLD_DELETE_MS` = 1500):
  the project form, the lane editor, the milestone step (which had no
  confirmation at all - the hold IS its guard). A tap does nothing; an early
  release snaps the fill back. The two Deletes INSIDE confirmations
  (DeleteProjectModal's final button, an extension's wipe) are still taps -
  they are the confirmation. Stage and preset row x's keep their two-tap.
- **Tap the mark to mark now; HOLD it to set WHEN it was met**
  (`MilestoneWhenModal`, via `useHold`). A mark made after the fact records
  the tap otherwise, and an on-time step reads amber. A future time is refused.
  `useHold` is pointer-event based (mouse and touch alike), cancels on 8px of
  movement so a scroll is not a hold, and swallows the release after a hold so
  it never also taps. The same hook is the one to use for the Complete control.
- Mark met now is a full-width, action-sized row directly above the step
  sheet's Delete / Cancel / Save. It was a small button in the corner over
  Delete - the one neighbour a mark should never have.
- **`INPUT_STYLE` is `box-sizing:border-box` now.** width:100% + padding +
  border overflowed every text input in the app past its sheet by ~30px, and
  had since the start. Date and time inputs additionally need `minWidth:0` in
  a flex row - their intrinsic minimum is large and flex cannot shrink past it.
- **MILESTONE STRIPS built.** `MilestoneStrip` (one component) under the
  project card's chip row, under a lane header, above the first lane for the
  BOARD (in the board's own colour, labelled BOARD), and under lane/project
  rows in the outline. Drawn only when there is a point to show. Tap opens:
  card -> project editor, lane -> lane view, board -> `BoardMilestonesModal`
  (each lane at its current point, rows open the lane view).
- **THE FULL-SET RULE.** The board hands cards `liveProjects` - OPEN records
  only. A milestone's targets are records that have been CLOSED, which is
  exactly what that filter removes: read the open set and a met step can never
  register as met. Every strip therefore reads `msProjects` (the unfiltered
  `projects`), passed down beside `allProjects`. e2e proves it with a closed
  target that is off the board and a step that still reads met.
- **Still to build:** report section with the full-width line · a tracker in
  the tutorial baseline. (Complete control: DONE.)
- (was) **Still to build, in order:**
  Complete control + closure sheet (long press; stages-done prompt) · report
  section with the same line at full width · a tracker in the tutorial.
  Design is settled: glyph A named, signpost B on the line, ticks above, off
  days shaded from the work schedule, axis tinted to now, one marker
  everywhere, D's dots for a shared day (no count badges anywhere).
- **One builder, one renderer, four places.** `rowMenuItems(kind, role, a)`
  returns each kind's menu and `MenuRows` draws it; the outline's row menus AND
  the board's lane header, project card and task card all use them, so they
  cannot drift. The board keeps two rows of its own outside the shared block:
  Expand/Collapse above, Close Out below. An action the caller cannot perform
  (no `a.addNestedTask` at the depth cap) is left out, not rendered dead.
- **One tap on a row's name opens that row's menu, two taps edit it** - the
  same pair the board uses. `rowMenuItems` gives a fixed order per kind,
  edit first then adds from the same level inward:
  lane: Edit lane · New lane · New project
  project: Edit project · Add project · Add nested project · Add task · Add stages
  task: Edit task · Add task · Add nested task · Add stages
  stage: Edit stage · Add stage (both open the host's stage list)
  "Add project"/"Add task" on a record is a SIBLING (`onAddSibling`: same lane,
  same parent, same role); "Add nested" goes inside it.
- The row menu is a POPUP hanging off its row (absolute, `top: 100% + 4px`),
  not an inline list: it overlays the rows beneath rather than pushing them
  down. Two things it needs - the row wrapper takes `zIndex:60` while open, or
  later sibling rows paint over it; and it must NOT carry `data-surface="menu"`,
  because that rule makes it glass, which reads as muddy over the rows of the
  sheet it is inside.
- **One lane editor, reached two ways.** A lane header on the board (double tap
  or its Edit Lane entry) and the outline both open `LaneEditModal`. The
  all-lanes list, its save and `moveItem` are deleted - nothing reached them.
- The grip shipped once CLIPPED: its keys reached -1.85 to 29.85 in a 0-28
  viewBox, losing all four outer walls, and it read as a lattice. Geometry is
  now named (`GRIP_OFF/KEY/SW`) and `tt-tests` checks the arithmetic
  `off + key/2 + sw/2 <= 14` rather than any literal.
- Each outline row carries a **grip** (`RowGrip`) outside its box on the
  trailing edge: a miniature of the controller it opens, 32px resting and 38px
  selected inside a fixed 40px box so nothing reflows. It calls the same `pick`
  as the row's own glyph. Written after the row box, so `dir` mirrors it.
- **Edit Lanes and Arrange are gone from the settings menu** - Edit... does
  both. NOTE: arrange mode is now unreachable, so the board's drag handles and
  the in-lane delete are dead code; `editMode` remains in the file. The lanes
  list is still reachable from a lane header (long-press or its + menu).
- **A lane has its own editor** (`LaneEditModal`): the edit twin of New Lane -
  name field, preview under it, eight swatches. Action row is Save, Cancel,
  Delete in source, so the mirror puts Delete in the corner furthest from Save.
  Deleting asks and offers to move the lane's projects elsewhere.
- **Every editing sheet's primary button says just "Save".** The modal title
  names the subject. Creates keep their verb ("Create Lane", "Add Task").
  Consequence: with two sheets stacked, two buttons read "Save" - browser tests
  must scope to `[data-modal-panel]` last, not match on the label.
- Step controls: a live key is `S.bg3` filled with an `S.textDim` border; a
  dead one keeps an `S.textMuted` border at 0.6 with no fill. Fill and colour
  carry the state, not dimness - the pad has to read as a pad even when only
  one direction is possible.
- Opened from the outline, the project panel shows details only - Name, Type,
  Starts, Ends, Notes. Lane / Nested under / Nested as are hidden via
  `structure:false`, and omitted from the save payload entirely.
- Tapping a row's name opens its editor ON TOP of the outline, which stays
  mounted; closing it returns to the outline with unsaved moves intact.
- **Dragging is GONE.** Rows are selected by tapping their glyph, and moved
  with a controller pinned to the bottom of the sheet: a d-pad, plus a
  Task/Project choice for how a row nests. See the rules below.
- (superseded) press-and-hold to lift (`HOLD_MS` 180, `HOLD_SLOP` 8) on
  both sheets. The sheet's panel becomes non-scrollable during the hold, with
  the finger still, and the outline autoscrolls near the panel's edges.
  A finger that moves before the hold is up scrolls the sheet as normal.
- Drag sheets now pin the document (`freezePage`: body position:fixed with the
  scroll position kept and restored) for their whole lifetime. The phone's
  trace showed iOS ignoring touch-action on the handle and committing to a
  scroll before the first touchmove; giving it nothing to scroll is the fix.
- Drag handles are now a 44px touch target (`DRAG_HANDLE_STYLE`), and in Test
  Mode the outline shows a **drag trace** of what the browser delivered. Still
  chasing the drag-down bug on iOS; this build is meant to produce data.
- Drag-down scrolled the page on iOS, on both drag sheets. Root cause was the
  document's rubber-band, not the sheet: `html,body{overscroll-behavior:none}`
  globally, plus a `tt-drag` class applied to `<html>` inside touchstart that
  sets `touch-action:none; overflow:hidden` for the length of the drag.
- Outline: drop a row ONTO a node (middle half of the row) to nest it inside;
  the outer quarters insert beside. Modal panels now `overscroll-behavior:
  contain` and lock while a row is in flight - dragging downward at the top of
  a tall sheet was chaining the gesture to the page on iOS.
- **Edit... in the settings menu opens the outline editor**: one list holding
  lanes, the projects and tasks inside them, and the stages under those. Drag
  vertically to move, sideways to nest, tap a row for that item's own editor.
- Clocking out now opens Reports on the day just finished instead of the Day
  Summary copy-out sheet. Both entry points go through `openReports(kind)`;
  Day Summary is unchanged and still on the ticker.
- Starting a project outside a shift asked which shift, then dropped the tap:
  it clocked in and started nothing. `clockIn(then)` now carries the caller's
  intent through both paths and `runToggle` performs it once the day is settled.
- Project and task titles and their glyphs take the lane accent, through
  `readableInk` so light mode still clears AA. A running card keeps the
  high-contrast colour - it is already filled with that same accent.
- Lane, project and task titles now lead with their glyph (`TitleGlyph`),
  mirroring to the end of the title in left-handed mode. The modal header's
  UI.left conditional was removed - it was cancelling the mirror out.
- Project / Task / Stages glyphs added to `MENU_GLYPHS` and applied to their
  edit modals. Titles carrying a record's name (`Stages - x`, `Add to x`) match
  through `MODAL_GLYPH_PREFIX`, checked only after the exact table.
- Header bar reversed relative to the board: menu button on the right when
  right-handed, left when left-handed. `hdrMenuRight` names the side and both
  header dropdowns anchor off it.
- Modal Save/Cancel: order now mirrors handedness the right way round (Save
  under the thumb), Cancel is bold, both at `MODAL_BTN_FONT` 1.05rem. Direction
  lives in `ACTION_DIR()` / `ACTION_ROW()`.
- Lane drag scrolled the sheet instead of moving the row on device. Fixed with
  a native `passive:false` touchmove listener - bound synchronously inside
  touchstart, not from an effect.
- Modal titles that name a menu row now wear that row's glyph (`MODAL_GLYPHS`,
  `ModalGlyph`), mirrored with handedness so it always leads the title. Titles
  that never came from a menu row stay bare.
- Edit Lanes reorders by dragging: arrange handle on the left of each row,
  rows step aside while a drag is in flight, new order handed back on Save and
  dropped on Cancel. The two decisions are pure - `dropIndex` and `moveItem`,
  with `dragShift` for the in-flight offsets.
- Whole menu icon family drawn and wired: `MENU_GLYPHS` table + `MenuIcon`.
  Every row now carries a glyph, including the eight that had none. The header
  button is a hamburger, so `GearSVG` is gone from the menu and the header - it
  survives only in Add New's lane row and the disruption Edit List.
- Interface glyph reworked: a hand tapping, index at 45° with two ripples off
  the fingertip (`TouchSVG`, `TOUCH_SCALE`). Replaces the finger-on-a-key.
- Settings menu sized to the header buttons: `MENU_FONT` 1rem, `MENU_ICON` 28.
  Both groups now open `MenuGroupModal` instead of expanding inline - one
  component driven by a list, one `menuGroup` key rather than a flag per group.
- Themes and Layout moved under an Interface group in the settings menu, with a
  new `TouchSVG` glyph (finger pressing a key).
- Themes and Layout split into two settings screens. Shared section furniture
  lives in `SETTINGS_BOXES()` so the two cannot drift apart. Module
  `settingsPanel`s render on Layout.
- Scheduled starts: `startAt`/`endAt` on a project, Now-or-pick on the form, an
  end input for finite projects, dates on the card, the row and the Archive,
  a greyed Start on anything not due yet, and the three-answer prompt behind it
  (`startAction` holds the rule, out of the component so it is testable)
- Nested projects: explicit `role` field (project vs task), tucked cards, stack
  ordering by depth-first position, collapsed-pill geometry
- Project lifecycle: ongoing vs finite, close-out, Archive, task type inheritance
  with selective cascade
- Add New prompt replacing the dead accordion
- iOS zoom-on-focus fix
- Static ticker, breathing disruption halo, "No Activity"
- Work days as shifts: clock-in prompt, overnight shifts, unscheduled-day
  overtime classification
- Disruption day-scoping bugs; two data points per project card
- Phase 3: Tool Tracker module

## Known gaps

- **No way to delete a closed project.** Delete lives on the board; closed
  projects aren't there. Reopen-then-delete works but is clumsy.
- **Expanded nested cards may bleed** on glass themes the way collapsed pills did.
  Same cause, deliberately not changed yet.
- **The pay answer is per session, not per log.** A Saturday that is part regular
  and part overtime needs a clock-out and back in.
- **An end date is recorded but inert.** Nothing warns as it approaches, and
  `readyToClose` still keys off stages alone rather than the date.
- **Only the two full-size Start buttons grey out.** The collapsed pill and the
  lane pill still go through the gate, so pressing them asks correctly — they
  just don't look scheduled first.
- **Roadmap:** Materials Tracker is the cheap next module (same shape as Tool
  Tracker, quantities instead of a check-in). Project Builder last — it extends
  the core project entity rather than sitting beside it.
