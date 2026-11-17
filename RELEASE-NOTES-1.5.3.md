# Time Tracker 1.5.3 - release notes (FULL DRAFT, for Brent to trim)

## Fix
- Sync no longer runs over and over. In 1.5.2 your settings could come back from the server arranged differently, and the app mistook that for a change and sent them again, every couple of seconds. You'd see the cloud in the top bar flicking between grey and green. Now only a real change is sent.
- That also means much less data: a device left alone now sends nothing.

(Everything else from 1.5.2 - How often, the item's name in new reminders, eight code boxes - is unchanged. If you set How often to "When I open it" to stop the flicker, you can set it back to Smart.)
