# Time Tracker

A shop-floor time tracking PWA. Built entirely in `React.createElement` style (no JSX build step), deployed as a single `index.html` on GitHub Pages, installed to the iPhone home screen.

## Files

| File | Role |
|---|---|
| `index.html` | The deployed app. Self-contained: PWA shell + the full app source spliced in. This is what Pages serves. |
| `time-tracker.jsx` | The source of truth. `index.html` is rebuilt from this — never edit the app code in `index.html` directly. |
| `test-*.js` | Node test suites (no browser needed): `node test-rollups.js` etc. |
| `harness.js` | Shared test harness — loads the app source with stubbed React/DOM. |
| `manifest.json`, icons, `sw.js` | PWA install bundle. Network-first service worker: updates land on the next launch after a deploy. |

## Deploy loop

1. Save the new `index.html` + `time-tracker.jsx` into this repo (Working Copy).
2. Commit with the build stamp as the message (e.g. `08-18 notify`).
3. Push. Pages rebuilds in ~1 minute.
4. Relaunch the app twice; the boot screen shows the build stamp. If it matches the commit, the deploy landed.

The build stamp lives in the `<div id="boot">` near the top of `index.html`.

## Working with Claude

- Start a session by sharing the raw URL of `time-tracker.jsx` (or the Pages URL — `index.html` contains the full source).
- Claude edits `time-tracker.jsx`, reruns every test suite, splices a fresh `index.html`, verifies the round-trip is byte-identical, and bumps the build stamp.
- Both files come back for commit.

## Architecture rules (do not break)

- Every dropdown open-site broadcasts `ttCloseMenus`; the card-lift z-index chain (row → card → lane → below-header → modals) must hold at every nesting level.
- Modals never nest inside a glass card — `position:fixed` breaks inside `backdrop-filter` surfaces. Nested modals render as sibling overlays via a Fragment.
- All duration formatters consult the `TIME_INC` global per render (Standard vs Tenths).
- Schemes own colors (mandatory dark/light variants); themes own fonts/radii/borders/glow.
- iOS time/date inputs: the `appearance:none` reset must ride **inline** on the element, value color pinned with `-webkit-text-fill-color`, shadow parts neutralized in the global CSS. Use `TIME_FIELD_STYLE()`.
- Saved-state shapes are normalized at boot (`normalizeSchedule`, `normalizeNotifs`) — new fields get back-filled defaults, never assume a saved shape is current.

## Testing

```
for t in test-*.js; do node $t; done
```

Suites cover the rollup/pay engine, schedules, breaks, payroll, notifications, and the collapsed-state controls. All green before every deploy.
