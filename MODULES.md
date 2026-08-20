# Module platform (contract v1)

Phase 1 of the roadmap. The app is now a **core** plus a **platform** that
modules plug into. Nothing in the UI changed: no modules are registered yet, so
every hook resolves to an empty list.

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
| `defaultEnabled` | no | `false` unless stated. À la carte means off first. |
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
- **Broadcast before opening.** Any dropdown a module opens calls
  `TT.closeMenus()` first.
- **Stacking belongs to the core.** Lifted rows 70, lane 90, header dropdowns
  200, below-header 300, modals 900, toast 950. Use `TT.ui.Modal`; do not invent
  a layer.
- **Normalizers are idempotent** and never throw. They run once at boot, before
  the first paint, for enabled *and* disabled modules — data left behind by a
  module the user switched off still has to be valid when they switch it back on.

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
- **Storage** — `storage(id) key(id,k) prefix`
- **Host hooks** — `nav screen settingsPanels reportSections reportText`
- **Chrome** — `tokens() rgba haptic closeMenus`
- **UI** — `ui.Modal ModalActions Mono Toggle Carousel saveStyle cancelStyle timeFieldStyle inputStyle labelStyle`
- **Format** — `fmt.dur time date hours money pad`
- **Time and pay** — `time.periodRange periodLabel payCycleRange scheduledMinutes scheduledToDate schNetMinutes startOf* addDays dayKeyOf isoDate toMin DAY_KEYS DAY_LABELS`
- **Data** — `data.uid findProj getChildren getDescendantIds`

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

Place the call after the platform block and before `App`. It appears in the menu
once the user enables it in Extensions (Phase 2); until then set
`defaultEnabled: true` to see it while developing.

## Tests

```
python3 build.py --src time-tracker.jsx --shell index.html --out index.html \
                 --stamp "08-20 module platform"
node tt-tests.js time-tracker.jsx    # source
node boot.js                          # the built payload, evaluated and rendered
```

`build.py` replaces only the app `<script>`; the inlined React 19 bundle, the
manifest links, the service-worker registration and the error trap are copied
through byte for byte. `boot.js` evaluates the built payload against a stub DOM
and renders `App` once — it is not a Playwright substitute, but it catches a
file that will not load on the phone.

`tt-tests.js` is one file, three suites, 291 assertions: the contract, a reference module's full
lifecycle (including a v1→v2 migration at boot), and the host wiring plus the
architectural invariants. The syntax gate runs first when `typescript` is
installed and is skipped cleanly when it is not.

## Roadmap position

- **Phase 0** — export/import. Done.
- **Phase 1** — this. Contract, registry, namespaced storage, boot normalizers,
  nav/screen/settings/reports hosts, conformance suite.
- **Phase 2** — Extensions screen: list modules, toggle them, persist. The
  plumbing (`TT.enabled` / `TT.setEnabled` / `tt_modules`) already exists.
- **Phase 3** — first real module, Tool Tracker.
- **Phase 4** — Project Builder, last, because it extends the core project
  entity rather than sitting beside it.
