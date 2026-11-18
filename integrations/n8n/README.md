# NavNet + n8n: emergency alerts and a ride log

NavNet sends what happens on a ride to n8n. The ready-made workflow then:

| When | n8n does |
|---|---|
| A rider hits **SOS**, or the safety monitor sees a **possible crash** | WhatsApps the rider's **emergency contact** (from their emergency card; the captain if there is none), SMSes the **ride captain**, and posts to your **Telegram group**, with the rider's location link and blood group |
| A trip **ends** | Posts the ride summary to Telegram and adds a row to a **Google Sheet** (date, distance, time, speeds, riders arrived, SOS count) |

Each channel runs on its own: if one fails (say Telegram is down), the others still go out.

## Set it up (10 minutes)

1. **Import the workflow.** In n8n: *Workflows → Import from file →* `navnet-emergency-alerts.json`.
2. **Connect your accounts** (double-click each node, choose or create the credential):
   - *WhatsApp emergency contact* and *SMS ride captain*: a Twilio account. Put your Twilio number in **From** (for WhatsApp, a WhatsApp-enabled Twilio sender).
   - *Telegram group* nodes: a Telegram bot token; set **Chat ID** to your group's ID.
   - *Log ride in Google Sheets*: your Google account; set the spreadsheet ID and make a sheet called `Rides` with the columns `Date, Trip, Distance (km), Duration (min), Avg speed (km/h), Max speed (km/h), Riders arrived, SOS`.
   - Don't need a channel? Delete its node.
3. **Copy the webhook URL.** Open the *NavNet event* node and copy the **Production URL** (ends in `/webhook/navnet-events`). Publish (activate) the workflow.
4. **Tell NavNet about it**, in `server/.env`:
   ```
   N8N_WEBHOOK_URL=https://your-n8n.example.com/webhook/navnet-events
   N8N_WEBHOOK_SECRET=pick-a-long-random-string
   ```
   Restart the API.
5. **Turn on the signature check** (recommended, so nobody else can trigger alerts): in the
   *Check & prepare* node set `const SECRET = 'the same long random string';`, and start n8n
   with `NODE_FUNCTION_ALLOW_BUILTIN=crypto`. Requests without NavNet's signature then fail.

Riders fill in their emergency card (blood group, contact name, contact phone) in **Profile**.

## What NavNet sends

`POST` with JSON, headers `X-NavNet-Event`, `X-NavNet-Delivery` (same id on retries) and
`X-NavNet-Signature: sha256=<HMAC-SHA256 of the body with N8N_WEBHOOK_SECRET>`.
Failed deliveries are retried after 1 s, 5 s and 30 s; riding is never slowed down by it.

| Event | Main fields |
|---|---|
| `alert.raised` | `alert` {type, severity, emergency, message, lat, lng, mapLink, data}, `rider` {name, phone, vehicleNumber, `emergencyCard` only for SOS / possible crash}, `trip`, `captain`, `organiser` |
| `trip.started` / `trip.cancelled` | `trip`, `captain`, `organiser` |
| `trip.ended` | the same, plus `summary` {distanceKm, durationMinutes, averageSpeedKmh, maxSpeedKmh, stops, ridersArrived, riders, sosCount, alertsByType} |
| `rider.arrived` | `trip`, `rider` |

Alert types: `SOS`, `POSSIBLE_CRASH`, `WEAK_GPS`, `UNUSUAL_MOVEMENT`, `OFF_ROUTE`, `STATIONARY`,
`OFFLINE`, `LOW_BATTERY`, `OVERSPEED`, `WRONG_DIRECTION`, `GAP`, `STOP_REQUEST`.

The same webhook works with Zapier, Make or your own server (`WEBHOOK_URL` / `WEBHOOK_SECRET` are accepted too).

## How it was tested

The workflow was imported into n8n 2.48 and run against a real NavNet API: an SOS reached
the WhatsApp/SMS/Telegram branch with the right numbers and message, a trip end reached the
summary + Sheets branch, a trip start was ignored, and a request with a forged signature was
rejected. (Messages weren't actually delivered: that needs your Twilio / Telegram / Google accounts.)
