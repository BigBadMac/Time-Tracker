# Native app: network-aware sync - ideas (saved 11-17, for later)

Brent (11-17): the app will become a native app. At that point it should know
Wi-Fi from mobile data and switch sync behaviour by the user's preferences.
This file collects the ideas, and what to lay down NOW in the web app so the
native one can build on it without rework. Nothing here is decided yet unless
marked DECIDED.

## Today (web app, 1.5.x)
- iOS gives home-screen web apps no way to tell Wi-Fi from mobile data, no
  Low Data Mode signal, and no background running. So the web app can only
  offer "how often" (DECIDED 11-17: all four - Right away / Smart / Every 15
  minutes / When I open it; each user picks; per device).

## Ideas for the native app
1. **Rules by network.** Two "how often" choices instead of one: on Wi-Fi, and
   on mobile data. Example defaults: Wi-Fi = Right away, mobile = Smart.
2. **Respect the phone's own data settings.** iOS Low Data Mode and Android
   Data Saver mark a network as "constrained": drop to "When I open it" on
   those, automatically. Also treat hotspots / tethering ("expensive") like
   mobile data.
3. **Roaming.** Pause sync abroad unless allowed ("Sync while roaming: off").
4. **Hold big things for Wi-Fi.** Small changes (a renamed job, a clock-in) go
   any time; big ones wait for Wi-Fi: first-time upload of a whole board,
   "Use this device's board", backups, future photos or attachments.
5. **Push instead of polling.** The server sends a silent notification when
   another device changes something; the phone fetches only then. Near-zero
   data when nothing changes, and other devices update within seconds - the
   best of "Right away" and "When I open it" together. Also delivers
   reminders with the app closed (planned server push).
6. **Background refresh.** Let the OS wake the app now and then (iOS
   background app refresh / Android WorkManager) to send waiting changes and
   fetch new ones, preferring Wi-Fi and charging.
7. **Battery.** In Low Power Mode, slow to Smart or every 15 minutes.
8. **A data meter.** "Sync used about 1.2 MB this month - 0.9 MB on mobile
   data", per device, with a reset - so the choice is made on real numbers.
9. **Per-network trust (maybe).** Name a few Wi-Fi networks (home, shop) as
   "unlimited"; everything else counts as mobile. Mostly useful on Android;
   iOS limits reading Wi-Fi names.
10. **Clock check.** Later-edit-wins uses device clocks; a native app can
    compare against the server's time and warn if a device's clock is off.

## What could be built NOW (web) to make that easy - to decide
- A. **Store "how often" as a per-network rule from day one:**
  `ttsync_prefs = { wifi:"smart", cell:"smart", other:"smart" }`. The web app
  only knows "other", so it shows one choice and writes all three; the
  native app shows two and reads the same shape. Kept per device, never
  synced, not in backups (ttsync_ prefix).
- B. **One scheduling brain with a network input.** The sync engine asks a
  single function "given this network, what now?" Web always answers for
  "unknown"; native plugs in the real network (e.g. Capacitor's Network
  plugin: wifi / cellular / none). No second sync engine later.
- C. **Size-aware sending.** Tag each push small or big now (whole-board
  uploads = big), so "hold big things for Wi-Fi" is a rule change later,
  not a rewrite.
- D. **Count bytes now.** Track roughly how much each device sends and
  receives per month (in ttsync_state). Cheap; gives the data meter real
  history, and lets us check the estimates in the Sync sheet.
- E. **Leave room for push.** Keep "fetch now" as one call the server could
  trigger later (it already is: ttSync.sync()). Nothing to build yet.

DECIDED 11-17 (Brent: "build all three now"): A, B and D are BUILT in the web
app (stamp "11-17 sync rate"): ttsync_prefs per network, ttSyncPlan as the one
scheduling brain with env.network() as its input, and the byte counter shown
in How often. C and E are already mostly true; noted only.
