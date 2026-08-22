# POSTURA — FAR AWAY ROUND 2 Web App

GitHub Pages-ready web app for the existing POSTURA_V3 ESP32 firmware.

## Firmware compatibility

The ESP32 firmware is **not changed**. The app uses the existing BLE UUIDs and payload:

`currentAngle,deviation`

The app can send the existing firmware command:

`THRESHOLD:<value>`

## New Round 2 readiness feature

### Good Posture Range
The readiness reference is now a **range**, not a single angle.

- Default range: **50°–70°**
- User can change the minimum and maximum from the app.
- Allowed range for both controls: **50°–100°**.
- The app prevents the minimum from being greater than the maximum.
- Range is stored locally in the browser.

### Readiness rule

`Good Min ≤ Current Angle ≤ Good Max` → **READY**

Outside the range → **CONFLICT**

Boundary values are included. Example: with 50°–70°, both 50° and 70° are READY.

### Recheck

When a conflict is detected, the user gets **Recheck Posture**. The app waits for fresh live angle readings, calculates a stable median current angle, and checks it against the configured range again.

No ESP32 recalibration is performed by Recheck.

## Independent live monitoring threshold

The existing live-monitoring threshold remains a separate control:

- Range: **1°–45°**
- Default: **15°**
- Sent to the packed ESP32 using `THRESHOLD:<value>`.
- Firmware continues to calculate deviation from its startup baseline and decide live posture using deviation vs threshold.

## Main app features

1. BLE connect/disconnect to POSTURA_V3.
2. Live current angle display.
3. Live deviation display/status.
4. Independent live threshold slider (1°–45°).
5. Good Posture Range controls (50°–100°).
6. Live readiness-range preview.
7. Round 2 operational readiness check.
8. Conflict detection.
9. Recheck after conflict.
10. Optional Proceed Anyway path.
11. Session planner with activity and duration.
12. Live session timer.
13. Slouch count.
14. Total slouch time.
15. Live posture score estimate.
16. Session history stored in browser localStorage.
17. History records readiness range and live threshold.
18. Responsive GitHub Pages UI.

## Expected workflow

Wear Postura → Power ON → ESP32 performs its existing 5-second automatic calibration → Connect in app → Configure Good Posture Range → Create planned activity → Check Readiness → READY or CONFLICT → if conflict, correct posture and Recheck → Start Session → Live monitoring → End Session → Save to History.
