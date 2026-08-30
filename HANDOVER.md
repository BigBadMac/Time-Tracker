# Time Tracker — session handover

Current build: **`08-26 scheduled starts`**

```
tt-tests.js   821 assertions   146 cases   (static, no browser)
boot.js        71 checks                    (renders the built file)
shift.js       46 checks                    (work days, shifts, overtime)
lifecycle.js  236 checks                    (projects, nesting, archive, scheduling)
```

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
- **A harness must assert against the payload it was handed**, never against
  `time-tracker.jsx` on disk. Source-level checks that read the file pass no
  matter what was actually built. `lifecycle.js` had this bug; it is fixed, but
  the same shape is worth watching for anywhere else.
- **Absent fields mean the old behaviour.** `kind`, `role`, `closedAt`, `startAt`
  and `endAt` are all read through functions so projects that predate them keep
  behaving exactly as they did. Nothing migrates.

## Recent work, newest first

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
