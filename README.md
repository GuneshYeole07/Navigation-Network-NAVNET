# NavNet: Smart Group Navigation & Convoy Management

NavNet keeps a group moving together. One admin plans the trip; riders join with a Group ID and password. Everyone then shares one live map: the route, the checkpoints and each other. The admin sees the whole convoy in real time and gets alerted the moment someone drifts off route, stops, loses signal, speeds, runs low on battery or hits SOS.

It's built for bike rides, car convoys, cycling groups, treks, college trips and tour operators, and it runs entirely on open-source mapping (**OpenStreetMap, MapLibre, OpenFreeMap, Protomaps, OSRM, OpenRouteService, Nominatim**). There is no Google Maps code or API anywhere in the project.

| Rider | Admin |
| --- | --- |
| Join with Group ID + password | Create trips: route, waypoints, unlimited checkpoints |
| Live map: route, checkpoints, the group, the leader | **Monitoring Panel**: every rider's location, speed, ETA, distance from leader, last update, status |
| ETA, distance done/remaining, progress, next checkpoint | Smart alerts: off-route, stationary, offline, low battery, overspeed, wrong direction, SOS, plus **possible crash, weak GPS, unusual movement** (Python safety monitor) |
| Group chat, private chat with admin, announcements | Broadcast, private chat, remove riders, change leader |
| One-tap **SOS** (name, GPS, speed, battery, type, time) | Start / pause / resume / end trip |
| Explore communities, request to join, see upcoming trips | Live convoy dashboard + automatic post-trip analytics |
| **Ride mode**: big next-turn strip, voice guidance, screen kept on | **Invite link + QR code** (join with one tap, no typing) |
| **One-tap chat** with quick replies ("Wait for me", "Puncture"…) | **Loud SOS alarm**, one-tap **Call rider**, broadcast presets |
| **Works offline**: download the route map; navigation, ETA and turn cues keep working with no network; chat + SOS queue and auto-send; SMS/call fallback | Riders' phone numbers visible to the admin only |
| **Push-to-talk** voice notes that auto-play on everyone's phone | **Ride as captain** from the phone: roll call, ready check, gap alerts |
| **Request a stop** (fuel, food, toilet, rest, photo) in one tap | **Meet pin** + **departure countdown** + live headcount at the stop |
| **Nearby** fuel / hospital / mechanic / police along the route, saved for offline | **Sweep rider** (tail-end charlie): alerts if anyone falls behind the sweep |
| Pre-ride **checklist**, **emergency card** (blood group, ICE contact) | SOS pings the **2 nearest riders** too, with the victim's emergency card |
| **Battery saver** (slower GPS updates below 25% / 10%) | **Shared costs**: who paid what, who owes whom (minimum transfers) |
| Shareable **ride summary card** image | Rider list shows Ready / At stop / Sweep badges |

### Maps

The map is drawn by the phone from vector data (MapLibre GL), so roads and labels stay sharp at any zoom, it has a real dark style, and it can rotate and tilt. The **view button** on the ride screen cycles: free map → follow me → **3D navigation** (map turns with your direction of travel, like a car navigator). The layers button switches to satellite (online only).

Which map is used, best first: your own Protomaps file (if the server has `PMTILES_PATH`), then OpenFreeMap, then plain OpenStreetMap tiles as a fallback. "Download offline map" saves the vector tiles, fonts and icons along the route (light and dark) on the phone.

### Python analytics service

`analytics/` is a FastAPI service (pandas, NumPy, scikit-learn, SQLAlchemy) that reads the trip GPS history and adds:
- **Smart ETA** on the ride screen and the monitoring panel: a gradient-boosted model trained on finished trips (traffic by hour, slow sections, the group's real pace, stops). About 35% more accurate than remaining distance ÷ planned speed in cross-validation.
- **Ride insights** in the trip report: speed along the route km by km, the slowest stretches, where the group stopped, and each rider's steadiness and distance behind the leader.

- **GPS cleaning**: a Kalman filter (+ RTS smoother for finished trips) that weights every fix by its accuracy, tells real turns from GPS glitches, and cuts position error from ~46 m to ~12 m on realistic phone GPS. The *same* filter runs live on every phone (`client/src/utils/gpsFilter.js`, tested to match the Python one within 1 m).
- **Live safety monitor**: watches every position as it arrives (Postgres `LISTEN/NOTIFY`) and alerts the captain about a **possible crash** (hard stop, then still), **weak GPS**, and **unusual movement** (scikit-learn IsolationForest trained on normal riding).
- **Load + failure tester** (`analytics/loadtest`): hundreds of simulated riders with dead zones and dropped connections, measuring delivery, latency and track gaps.

The app works without it (those panels just don't appear). See `analytics/README.md`.

### Tracking you can rely on

- **Every fix is filtered on the phone** before it's shown or sent: GPS jumps (signal bouncing off buildings) are dropped, real U-turns and sharp bends are followed immediately (using the phone's own speed + heading), and a phone that hands back an old cached position can't teleport anyone.
- **No signal ≠ lost data.** Positions recorded in a dead zone are saved on the phone (up to 2,000) and uploaded in one go when signal returns (`location:batch`), with the phone's own timestamps, so the stored track has no gap. The ride screen shows "No signal, N saved" and "uploaded" when it's back.
- **Stale dots are labelled.** After 20 s without a fix, a rider's dot fades and shows "45s ago"; a dashed "ghost" marker shows where they probably are now (carried along the route at their last speed, for up to 2 min / 2 km).
- **The server double-checks**: device timestamps (clamped), late fixes never move a rider backwards, impossible jumps (> 300 km/h) are ignored unless the next fixes agree.
- **Parked riders stay "live"**: the Android app reports every fix (no distance filter), and a stopped phone re-confirms its position every 20 s.
- **Android battery guide**: one-time card telling riders how to stop Android killing tracking (Unrestricted battery, Allow all the time, Autostart on Xiaomi/Oppo/Vivo/Realme).
- **Scales**: 300 riders in one trip, with dead zones and dropped connections, all positions delivered to the admin's map, p95 63 ms (see `analytics/loadtest/results`).

### Automations with n8n

`integrations/n8n` has a ready-to-import n8n workflow: when a rider hits SOS or the safety monitor sees a possible crash, n8n WhatsApps their emergency contact, SMSes the ride captain and posts to a Telegram group with the location; when a trip ends, it posts the summary and logs the ride in Google Sheets. NavNet sends signed webhooks (`N8N_WEBHOOK_URL`), with retries.

### Android app

`client/android` is the same app wrapped with Capacitor. It keeps GPS running with the screen locked and shows the next turn, km to go and arrival time on the lock screen. Build the APK with the **Android app** GitHub Action (no Android Studio needed); see docs/DEPLOYMENT.md.

### Group riding (captain mode)

Admin → **Group Monitoring Panel** → **Ride** opens the same phone screen riders use, with a captain bar on top. Before leaving: **Roll call** shows who is at the start, **Ready check** asks everyone "Ready to roll?". On the road: if anyone drops more than the gap limit (default 1.5 km for bikes) behind, the captain's phone speaks an alert; the rider sees "Group is ahead — catch up". Riders tap **Stop** to request fuel/food/rest; the captain drops a **meet pin**, everyone is guided there, the headcount fills in, and a **Leaving in 10:00** countdown runs on every phone.

### Offline navigation

Before leaving (on Wi-Fi), tap **Download offline map** on the trip screen. NavNet saves the map tiles along the whole route corridor (zoom 10–16, about 7 MB for a 60 km ride) on the phone. In a dead zone:

- The map, your position, the route, turn cues, km to go, ETA and off-route warnings keep working, because they're computed on the phone from GPS, which needs no internet.
- The app reopens with no network, using the trip saved on the phone.
- Chat messages and SOS are queued and send automatically when signal returns. SOS also offers one-tap **SMS** (often works on bare GSM) and **Call admin / 112**.
- Other riders' positions show their last known location until you're back online.

---

## Tech stack

**Frontend:** React 18, Vite, Tailwind CSS, React Router, React Hook Form, Axios, MapLibre GL, Framer Motion, Context API, Socket.IO client
**Backend:** Node.js, Express 5, Socket.IO, JWT, bcrypt (bcryptjs), Zod validation, Helmet, CORS, express-rate-limit, Multer
**Database:** PostgreSQL + Prisma ORM 7
**Analytics:** Python, FastAPI, pandas, NumPy, scikit-learn, SQLAlchemy, pytest

**Maps:** MapLibre GL vector maps from OpenFreeMap (free, no API key, light + dark styles), optional self-hosted Protomaps tiles served by the API, OpenStreetMap raster as an automatic fallback, Esri satellite view (online only). Routing: OSRM (FOSSGIS car/bike/foot servers) / OpenRouteService. Search: Nominatim + Photon (proxied server-side)
**Testing:** Vitest, Supertest, socket.io-client (84 server + 10 client tests) + two Playwright end-to-end tests: a two-browser run (66 checks, including a full offline drill) and a three-phone group ride (33 checks)

---

## Quick start

**Prerequisites:** Node.js ≥ 20.19 and PostgreSQL ≥ 14 (or Docker).

```bash
# 1. Install
git clone https://github.com/GuneshYeole07/navnet.git
cd navnet
npm install            # root helper (concurrently)
npm run install:all    # server + client

# 2. Configure
cp server/.env.example server/.env
cp client/.env.example client/.env
#    → edit server/.env: set DATABASE_URL and JWT_SECRET

# 3. Database
createdb navnet                         # or: docker compose up -d db
npm run db:migrate -- --name init       # creates tables (prisma migrate dev)
npm run db:seed                         # demo users, communities, trips

# 4. Run (API on :5000, web on :5173)
npm run dev
```

Open **http://localhost:5173**.

### Demo accounts (from the seed)

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@navnet.dev` | `Admin@123` |
| Riders | `aarav@`, `diya@`, `kabir@`, `meera@`, `rohan@navnet.dev` | `Rider@123` |

| Trip | Group ID | Password |
| --- | --- | --- |
| Lonavala Monsoon Ride (bikes, 59 km) | `PUNE-RIDE` | `ride123` |
| Sinhagad Sunrise Climb (cycling, 22 km) | `SINHAGAD` | `cycle123` |

### See the monitoring panel in action

You don't need five phones. The simulator logs in the seeded riders, joins the trip and drives them along the real route over Socket.IO. Along the way it triggers overspeed, off-route, low-battery, stationary and SOS alerts:

```bash
# terminal 1
npm run dev
# terminal 2
npm run simulate                       # PUNE-RIDE, 5 riders, 20× speed
npm run simulate -- --timescale 60 --riders 3
```

Sign in as the admin → **Group Monitoring Panel** → **Lonavala Monsoon Ride**, and watch. When you **End** the trip, the analytics report is generated.

> **Tip:** To make the *stationary* alert fire quickly in a demo, start the API with `STATIONARY_MINUTES=0.3`.

### Docker (one command)

```bash
docker compose up --build              # Postgres + API + built client on :5000
docker compose exec app npm run db:seed
```

---

## Environment variables

### Server (`server/.env`)

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | Signing secret for JWTs (use 48+ random bytes) |
| `PORT` | | `5000` | API port |
| `JWT_EXPIRES_IN` | | `7d` | Token lifetime |
| `CLIENT_ORIGIN` | | `http://localhost:5173` | Comma-separated allowed origins (CORS + Socket.IO) |
| `ADMIN_SIGNUP_CODE` | | *(empty = admin signup off)* | Invite code needed to register an Admin |
| `ORS_API_KEY` | | — | OpenRouteService key (free); OSRM is used without it |
| `OSRM_URL` | | public OSRM demo | Self-host for production traffic |
| `NOMINATIM_URL` | | public Nominatim | Geocoding endpoint |
| `GEO_USER_AGENT` | | `NavNet/1.0` | Put a contact here (Nominatim policy) |
| `UPLOAD_DIR` | | `uploads` | Trip/community images |
| `OFF_ROUTE_METERS` | | `300` | Distance from route that counts as off-route |
| `STATIONARY_MINUTES` | | `5` | Stopped this long (away from a checkpoint) → alert |
| `OFFLINE_SECONDS` | | `60` | No ping for this long → offline alert |
| `LOW_BATTERY_PERCENT` | | `20` | Battery alert threshold |
| `WRONG_DIRECTION_METERS` | | `250` | Backtracking within 2 min that counts as wrong way |
| `ARRIVAL_METERS` / `CHECKPOINT_METERS` | | `150` / `200` | Arrival and checkpoint radii |
| `ALERT_COOLDOWN_SECONDS` | | `300` | Same alert for same rider is suppressed this long (SOS never is) |
| `PING_PERSIST_SECONDS` | | `10` | How often a rider's live position is written to Postgres |
| `SWEEP_INTERVAL_SECONDS` | | `15` | Background check for offline/stationary riders |
| `ANALYTICS_URL` / `ANALYTICS_KEY` | | *(empty = off)* | Python analytics service and its shared secret |
| `SAFETY_MONITOR` | | *(off)* | `1` = stream positions to the Python safety monitor (set it in `analytics/.env` too) |
| `N8N_WEBHOOK_URL` / `N8N_WEBHOOK_SECRET` | | *(empty = off)* | Send SOS, possible crash, trip start/end and arrivals to n8n (or Zapier/Make), signed; see `integrations/n8n` |
| `RATE_LIMIT_DISABLED` | | *(off)* | `1` = no rate limits, for local load tests only (ignored when `NODE_ENV=production`) |

### Client (`client/.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | *(empty)* | API origin in production if hosted separately. Empty in dev (Vite proxies). |
| `VITE_SOCKET_URL` | `VITE_API_URL` | Socket.IO origin, if different |
| `VITE_SHOW_DEMO` | `true` | Show "fill in the demo account" on login screens |

---

## Project structure

```
navnet/
├── client/                    React + Vite app
│   └── src/
│       ├── components/        Reusable UI
│       │   ├── ui/            Primitives: Field, Modal, Milestone, Skeleton, StatusPill…
│       │   ├── map/           BaseMap + mapStyles.js (map styles, offline cache), gl.jsx (MapLibre wrapper), RouteLayer, MemberMarkers, PlaceSearch, icons
│       │   ├── chat/          ChatPanel (group + admin↔member private)
│       │   ├── trip/          SosButton, ConvoyStats, MemberTable, AlertFeed, AnnouncementBanner
│       │   ├── community/     CommunityCard
│       │   └── layout/        LiveShell (map-first desktop/mobile layout), PanelTabs
│       ├── pages/             Route screens: Landing, auth/, user/, admin/, TripReport
│       ├── layouts/           AppLayout (header + content)
│       ├── hooks/             useTripLive, useChat, useGeolocation, useMediaQuery, useNow…
│       ├── context/           AuthContext, SocketContext, ThemeContext
│       ├── services/          Axios API clients per domain
│       ├── utils/             Formatting, constants, geo helpers
│       ├── routes/            AppRoutes, ProtectedRoute (role-based)
│       └── assets/
├── server/                    Express + Socket.IO API
│   ├── prisma/                schema.prisma, seed.js (migrations created on first migrate)
│   ├── src/
│   │   ├── config/            Typed env loading, fail-fast on missing secrets
│   │   ├── controllers/       Thin HTTP handlers → services
│   │   ├── routes/            REST routers (auth, trips, communities, geo, uploads)
│   │   ├── middleware/        auth (JWT + RBAC), validate (Zod), rate limits, upload, errors
│   │   ├── services/          Business logic: trip, live (convoy engine), monitoring,
│   │   │                      analytics, message, community, routing, auth
│   │   ├── database/          Prisma client (pg driver adapter)
│   │   ├── socket/            Socket.IO gateway + emitter facade
│   │   ├── validation/        Zod schemas (REST + socket payloads)
│   │   ├── utils/             geo math, security helpers, ApiError
│   │   ├── app.js             Express app (Helmet, CORS, compression, routes)
│   │   └── server.js          HTTP + Socket.IO bootstrap, graceful shutdown
│   ├── scripts/simulate.js    Convoy simulator for demos
│   └── tests/                 Unit + API + Socket.IO integration tests
├── e2e/run_e2e.py             Two-browser end-to-end test (Playwright)
├── docs/                      Architecture, API, database, deployment, testing
├── Dockerfile, docker-compose.yml, .github/workflows/ci.yml
```

Folder-by-folder reasoning lives in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#folder-structure).

---

## Documentation

| Doc | Contents |
| --- | --- |
| [Architecture](docs/ARCHITECTURE.md) | System diagram, real-time design, sequence diagrams, monitoring rules, scaling, folder structure |
| [API reference](docs/API.md) | Every REST endpoint and Socket.IO event, with payloads |
| [Database](docs/DATABASE.md) | PostgreSQL schema, ER diagram, indexes, design decisions |
| [Deployment](docs/DEPLOYMENT.md) | Render + Vercel, Docker, VPS + Nginx, production checklist |
| [Testing](docs/TESTING.md) | Test strategy, how to run, what's covered, manual QA script |

---

## Security

- Passwords and group passwords are hashed with **bcrypt** (12 rounds).
- **JWT** auth on REST and on the Socket.IO handshake; the user is reloaded from the DB on every request, so deleted accounts lose access immediately.
- **Role-based access**: route-level `requireRole("ADMIN" | "USER")`, plus ownership checks in services (only *this* trip's admin can control *this* trip, and private chat is strictly admin ↔ member).
- **Zod validation** on every body, query and socket payload. Unknown fields are stripped.
- **Helmet**, strict **CORS** allow-list, **rate limiting** (global, auth/join brute-force, and the geocoding proxy).
- Uniform error for wrong Group ID vs wrong password, so valid Group IDs can't be enumerated.
- Image uploads: MIME allow-list, 3 MB cap, random server-side filenames.
- Per-socket flood control on location (1/s) and chat (6 per 5 s).

## License

MIT
