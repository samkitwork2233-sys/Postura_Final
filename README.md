# Postura — FAR AWAY 2026 Round 2

GitHub Pages prototype for the Postura wearable app with the Round 2 Operational Readiness / Conflict Check flow.

## Features

- Existing live posture monitoring UI
- BLE connection through Web Bluetooth
- Current angle
- One shared Postura Threshold Angle
- Slouch count
- Total slouch time
- Posture score
- Session planner
- Pre-session readiness check
- Conflict detection before session commitment
- Conflict explanation
- Recheck Posture button shown only after a conflict
- Short live BLE recheck
- Conflict resolved state
- Proceed Anyway option
- Session monitoring
- Session summary/history using browser localStorage

## Hardware / firmware

This web app does **not** modify the ESP32 firmware, hardware, PCB, calibration logic, or BLE protocol.

The device's existing automatic startup calibration remains inside the packed firmware. The app does not show a calibration screen and does not provide a recalibration button.

## Web Bluetooth

Web Bluetooth requires a secure context. GitHub Pages provides HTTPS, so the deployed site can request a Bluetooth device from supported browsers such as Chrome/Edge.

The current JavaScript uses:

- Service UUID: `12345678-1234-1234-1234-1234567890ab`
- Characteristic UUID: `abcd1234-5678-1234-5678-abcdef123456`

If the packed firmware uses different UUIDs or a different angle payload, edit only the `CONFIG` values and `parseAngle()` in `app.js`.

## GitHub Pages deployment

1. Create a GitHub repository.
2. Upload `index.html`, `styles.css`, and `app.js`.
3. Open **Settings → Pages**.
4. Choose **Deploy from a branch**.
5. Select the `main` branch and `/root`.
6. Save.
7. Open the generated HTTPS GitHub Pages URL in Chrome/Edge.
8. Click **Connect Postura** and select the wearable.

## Round 2 flow

Wear Postura → Power on → existing 5-second firmware calibration → connect app → live monitoring → create activity/session → Check Readiness → compare current angle with the existing threshold → Ready OR Conflict Detected → Recheck Posture → Conflict Resolved → Start Session → live monitoring → session summary/history.


## Verified against the supplied Postura V3 firmware

The supplied firmware already supports the Round 2 app without a firmware rewrite:

- BLE service UUID matches the app.
- BLE characteristic UUID matches the app.
- Notifications send `currentAngle,deviation`.
- The app must use **deviation** for posture/readiness decisions, because the firmware compares `deviation` against `threshold`.
- The firmware accepts `THRESHOLD:<value>` BLE write commands in the range 1°–45°.
- Therefore the single app threshold slider can update the packed device directly.
- The 5-second startup calibration remains firmware-only.
- The Round 2 **Recheck Posture** action does not recalibrate the device; it samples the live `deviation` already being sent by the firmware.


## Final Round 2 readiness logic

- Dashboard shows **Current Angle** and **Good Posture Angle**.
- Good Posture Angle is set in the app with a slider from **50° to 100°**.
- Readiness compares the raw BLE `currentAngle`, not firmware `deviation`.
- Exact rule: **Current Angle <= Good Posture Angle = READY**.
- If **Current Angle > Good Posture Angle = CONFLICT**.
- 90° is therefore READY when Good Posture Angle is 90°.
- No tolerance is used for the readiness decision.
- Recheck is available after a conflict and checks the new raw current angle.
- Live monitoring remains unchanged: the packed ESP32 firmware uses deviation vs its threshold.
- The ESP32 firmware and its 5-second startup calibration are unchanged.
