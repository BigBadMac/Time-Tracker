# Module platform (contract v1)

The app is a **core** plus a **platform** that modules plug into. One module
ships today — Tool Tracker — and it is off until the user switches it on in
Extensions, so the board is unchanged out of the box.

## Core vs module territory

**Core — never a module.** Timer engine and session restore, lanes / projects /
sub-tasks, logs, disruptions and breaks, the schedule + unpaid-break + pay-cycle
engine, Reports, Backup & Restore, themes and tokens, settings.

**Module territory.** Anything that introduces a new kind of record alongside
the timer: Tool Tracker, Materials Tracker, Project Builder. Modules ship inside
the same `index.html` — iOS isolates storage per home-screen app, so a separate
app could never see these projects — and are switched on or off by the user
rather than downloaded.

## The contract

A module is a plain object passed to `TT.define()`.

| Field | Required | What it is |
|---|---|---|
| `id` | yes | Slug: lowercase, leading letter, `[a-z0-9-]`, 2–24 chars. **Permanent** — it names the storage keys. |
| `title` | yes | Human name for menus and the Extensions list. |
| `version` | yes | Integer ≥ 1. The module's own schema version. |
| `summary` | no | One line of description. |
| `defaultEnabled` | no | `false` unless stated. À la carte means off first — the user turns it on in Extensions. |
| `nav` | no | `{ label, screen, group }` — one row in the settings menu that opens `screens[screen]`. `group` defaults to `"Modules"`. |
| `screens` | no | `{ name: Component }`. Rendered as sibling overlays. |
| `storage` | no | `{ keys: [bare slugs], normalize(store, api) }`. |
| `settingsPanel` | no | Component rendered inside Themes and Layout. |
| `reports` | no | `{ section(ctx), text(ctx) }`. |

Any other field is rejected — an unknown key is a typo, not a feature.
`TT.define()` throws on anything malformed: a broken module is a build-time
mistake, and failing at load beats shipping something that half-works.

## Rules

- **Storage only through `ctx.storage`.** Never touch `localStorage` directly.
  That is what keeps Backup & Restore whole and enable/disable reversible.
- **Tokens are live.** Call `TT.tokens()` inside render. Never cache `S` at load
  time — the palette changes underneath when the theme does.
- **Broadcast before opening.** Any dropdown or sheet a module opens calls
  `TT.closeMenus()` first.
- **Stacking belongs to the core.** Lifted rows 70, lane 90, header dropdowns
  200, below-header 300, modals 900, toast 950. Use `TT.ui.Modal`; do not invent
  a layer.
- **Durations go through `TT.fmt.dur`**, so the Standard/Tenths setting keeps
  working inside modules.
- **Normalizers are idempotent** and never throw. They run once at boot, before
  the first paint, for enabled *and* disabled modules — data left behind by a
  module the user switched off still has to be valid when they switch it back on.

## Context

Screens, settings panels **and reports hooks** all receive the same shape:

```
ctx.moduleId          the module's own id
ctx.storage           its bound store (see below)
ctx.api               TT
...plus the host fields for that surface
```

Screens additionally get `settings projects logs laneMeta laneOrder testMode
schedule activeId activeName onClose`. `activeId` / `activeName` are the project
running right now, so a module can default to it rather than making the user
pick the job they are already standing in.

Reports hooks additionally get `kind range rollup logs projects schedule
testMode now` — the window the user is looking at, so a module reports against
the same period as the core rollup beside it.

## Storage and backup

Keys are namespaced `tt_mod_<id>_<key>`. Enablement lives in `tt_modules`.
Both sit under the `tt_` prefix, so **Backup & Restore covers module data with no
extra work**, and a restore is still replace-all.

```js
ctx.storage.get("items", [])   // default on missing or corrupt
ctx.storage.set("items", next) // returns false if the write failed
ctx.storage.keys()             // this module's bare keys
ctx.storage.clear()            // only this module
```

## The API

`TT` (also on `window.TT`) is the whole surface a module may use:

- **Lifecycle** — `define validate modules module enabled isEnabled setEnabled boot context`
- **Storage** — `storage(id) key(id,k) prefix usage(id) clearData(id)`
- **Host hooks** — `nav screen settingsPanels reportSections reportText`
- **Chrome** — `tokens() rgba haptic closeMenus`
- **UI** — `ui.Modal ModalActions Mono Toggle Carousel saveStyle cancelStyle timeFieldStyle inputStyle labelStyle`
- **Format** — `fmt.dur time date hours money pad`
- **Time and pay** — `time.periodRange periodLabel payCycleRange scheduledMinutes scheduledToDate schNetMinutes startOf* addDays dayKeyOf isoDate toMin DAY_KEYS DAY_LABELS`
- **Data** — `data.uid findProj getChildren getDescendantIds getMeta`

## Skeleton

```js
TT.define({
  id: "tools",
  title: "Tool Tracker",
  version: 1,
  summary: "Check tools in and out against a job.",
  nav: { label: "Tools", screen: "main" },
  screens: {
    main: function ToolScreen(ctx){
      var S = ctx.api.tokens();                 // live, every render
      var items = ctx.storage.get("items", []);
      return React.createElement(ctx.api.ui.Modal,
        { title:"Tools", onClose:ctx.onClose, cancelLabel:"Close" },
        /* ... */);
    }
  },
  storage: {
    keys: ["items"],
    normalize: function(store){
      var items = store.get("items", []);
      store.set("items", Array.isArray(items) ? items : []);
    }
  },
  reports: {
    text: function(ctx){ return ["Tools out: " + 0]; }
  }
});
```

Place the call between `// ==== TT PLATFORM END ====` and `App`, inside its own
`// ==== TT MODULE <id> BEGIN/END ====` markers so the test harness can lift it
out and run it in Node.

## Extensions screen

Settings menu → **Extensions**. Lists every *registered* module, on or off — it
is the only place enablement changes. Each row shows the title, version, summary,
an On/Off `Toggle`, and the storage the module is holding.

Two distinct actions, deliberately kept apart:

- **Off** hides the module everywhere and **keeps its data**. Reversible.
- **Delete data** wipes `tt_mod_<id>_*` for that module only, behind a
  confirmation. It does not change the on/off state, and it does not touch core
  data or any other module. The only way back is a backup.

`TT.usage(id)` returns `{ keys, bytes }`; `TT.clearData(id)` returns how many
keys it removed.

---

# Tool Tracker (module `tools`, v1)

The first real module, and the proving ground for the contract: it adds a new
kind of record beside the timer without touching the timer at all.

## Data

```
tools     [{ id, name, tag, category, notes, createdAt }]
checkouts [{ id, toolId, toolName, holder, projectId, projectName,
             note, out, in }]        in === null  ->  still out
prefs     { holder }                 remembers who took the last one
schema    1
```

The catalogue and the log are kept apart on purpose. A checkout **snapshots**
the tool's name and the job's name, so deleting a tool or renaming a project
leaves the history readable instead of full of dangling ids.

**The one invariant: a tool can only be out once.** The normalizer enforces it.
If a write was interrupted mid-checkout and two records are open for the same
tool, the older is *closed at the moment the newer opened* — the tool was
evidently handed on — rather than deleted, which would lose the history. A
checkout whose tool no longer exists is closed too, because nothing could ever
check it back in.

## Screen

Settings menu → **Tools**. One modal, three tabs:

- **Out** (default) — what is on the floor: tool, job, holder, note, how long it
  has been gone, and a Check in button.
- **All** — the catalogue, with Add tool, Edit, and Check out / Check in per row.
- **History** — the last 60 completed checkouts, newest first, with durations.

Check-out asks for a holder, a job, and an optional note. The job defaults to
whatever is running (`ctx.activeId`), **and "No job" is a valid answer** — a
tool taken for general use is still a tool that is out. Making a job mandatory
later is a one-line change; the reverse would strand records.

Removing a tool keeps its history and checks in anything still out.

## Reports

Both hooks measure against the window the user is already viewing, clipping each
checkout to `ctx.range` so the numbers line up with the core rollup beside them.
The section shows checkout count, total time out, how many are still out, and
the five busiest tools. Neither hook renders anything when there is nothing to
say, so Reports is untouched until the module is used.

## Tests

```
node tt-tests.js time-tracker.jsx     # 821 assertions, 146 cases
python3 build.py --src time-tracker.jsx --shell index.html --out index.html \
        --stamp "MM-DD descriptor"
python3 extract.py index.html /tmp/app_only.js
node boot.js /tmp/app_only.js         # 71 checks against the built file
node shift.js /tmp/app_only.js        # 46 - work days, shifts, overtime
node lifecycle.js /tmp/app_only.js    # 130 - project lifecycle and nesting
node paint.js /tmp/app_only.js        # first-paint markup, for diffing builds
```

The static suite covers the normalizer, the one-open invariant, the window
maths, the reporting, the picker, and a set of source-level house rules (no
`localStorage`, no hand-built keys, no new z-index, sheets as siblings, live
tokens, durations through `fmt.dur`). `boot.js` is the only place the screen and
its sheets are rendered against the real tokens, the real `Modal` and the real
formatters — the screen builds all three tab bodies eagerly on every render, so
a fault in a tab that is not currently visible still fails the boot check.

## Roadmap position

- **Phase 0** — export/import. Done.
- **Phase 1** — contract, registry, namespaced storage, boot normalizers,
  nav/screen/settings/reports hosts, conformance suite. Done.
- **Phase 2** — Extensions screen. Done.
- **Phase 3** — Tool Tracker. Done, and the contract came through it with three
  small additions: `data.getMeta`, `activeId`/`activeName` on the screen
  context, and reports hooks now receiving a full module context (so they read
  through `ctx.storage` like everything else) instead of the bare report window.
- **Phase 4** — Project Builder, last, because it extends the core project
  entity rather than sitting beside it. Materials Tracker is the cheap one to do
  first if you want another: it is the same shape as Tool Tracker with
  quantities instead of a check-in.

## Core changes since Phase 3

The core has moved on underneath the platform. Modules see these through `TT`:

- **Work days are shifts, not calendar days.** `recordDay(r)` is the stamp a
  record was filed under. A module writing time-bearing records should stamp
  them the same way rather than deriving a day from a timestamp.
- **Projects have a `role`** (project or task) and a `kind` (ongoing or finite),
  and can be closed out. `ctx.projects` is filtered to open projects only;
  Reports hooks still see everything.
- **Reports hooks now receive a full module context** — `ctx.storage` and
  `ctx.api` alongside the report window — rather than the bare window.
- **`data.getMeta`** is exposed for lane colours.
- **Form fields must be 16px** or iOS Safari zooms on focus and stays zoomed.
