# NavNet API reference

Base URL: `/api`. All responses use one envelope:

```json
{ "success": true,  "data": { } }
{ "success": false, "error": { "message": "Human-readable", "details": [{ "field": "email", "message": "Enter a valid email" }] } }
```

Authenticated endpoints need `Authorization: Bearer <JWT>`. Role column: **A** = Admin, **U** = User, **Any** = either.

| Status | Meaning |
| --- | --- |
| 400 | Validation failed (`details` lists fields) or invalid state transition |
| 401 | Missing/expired token, or wrong credentials |
| 403 | Authenticated but not allowed (wrong role, not this trip's admin, removed member) |
| 404 | Not found |
| 409 | Conflict (duplicate email/Group ID, trip full, request already pending) |
| 429 | Rate limited |

---

## Auth

| Method | Path | Role | Body | Returns |
| --- | --- | --- | --- | --- |
| POST | `/auth/register` | public | `{ name, email, password, role?: "USER"\|"ADMIN", adminCode?, phone?, vehicleNumber? }` | `{ user, token }` |
| POST | `/auth/login` | public | `{ email, password, role: "USER"\|"ADMIN" }` | `{ user, token }` |
| GET | `/auth/me` | Any | — | `{ user }` |
| PATCH | `/auth/me` | Any | `{ name?, phone?, vehicleNumber? }` | `{ user }` |

- Passwords: 8–72 characters, at least one letter and one number.
- `role: "ADMIN"` registration requires `adminCode === ADMIN_SIGNUP_CODE`.
- Login enforces the portal: an admin account can't sign in through "Login as User", and the reverse (403, with a hint).

## Trips

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| POST | `/trips` | A | Create a trip (see body below) |
| GET | `/trips/mine` | A | Trips I administer, with active member counts |
| POST | `/trips/join` | U | `{ groupCode, password, vehicleNumber? }` → `{ tripId, name, status }` |
| GET | `/trips/joined` | U | My active trips (planned/active/paused) |
| GET | `/trips/:id` | Any* | Live snapshot `{ trip, members[], stats, role }` |
| GET | `/trips/:id/report` | Any* | Analytics. Final once the trip has ended; a live preview while it runs (`final: false`). |
| GET | `/trips/:id/messages?scope=group\|private&with=<userId>&before=<iso>&limit=100` | Any* | Chat history (oldest → newest) |
| POST | `/trips/:id/messages` | Any* | `{ body, recipientId? }`. Private chat is admin ↔ member only. |
| POST | `/trips/:id/leave` | U | Leave the trip |
| PATCH | `/trips/:id/status` | A (owner) | `{ action: "start"\|"pause"\|"resume"\|"end"\|"cancel" }`. `end` returns `{ status, report }`. |
| PATCH | `/trips/:id/leader` | A (owner) | `{ userId }` |
| DELETE | `/trips/:id/members/:userId` | A (owner) | Remove a rider (they can't rejoin) |
| POST | `/trips/:id/broadcast` | A (owner) | `{ body }`: announcement to everyone |
| GET | `/trips/:id/alerts` | A (owner) | Latest 200 alerts |
| GET | `/trips/:id/threads` | A (owner) | Private threads, one per member |
| PATCH | `/trips/alerts/:alertId/ack` | A (owner) | Acknowledge. For SOS, the rider is notified. |
| POST | `/trips/:id/invite` | A (owner) | Signed invite link (join with no password) |
| GET | `/trips/:id/contacts` | Captain | Riders' phones + emergency cards |
| POST | `/trips/:id/ride` | A (owner) | Admin joins as a rider and becomes leader (captain) |
| PATCH | `/trips/:id/sweep` | Captain | `{ userId \| null }`: set the sweep rider |
| PATCH | `/trips/:id/checklist` | Member | `{ items: string[] }`: pre-ride checklist ticks |
| POST | `/trips/:id/voice` | Any* | multipart `audio` (≤1.5 MB, webm/ogg/mp4) + `durationMs`, `recipientId?` → VOICE message |
| GET | `/trips/:id/pois?refresh=1` | Any* | Fuel / hospital / mechanic / police along the route (Overpass, cached 14 days) |
| GET | `/trips/:id/expenses` | Any* | `{ expenses, balances, transfers }` |
| POST | `/trips/:id/expenses` | Any* | `{ amount (₹), description, splitAmong?: userId[] }` |
| DELETE | `/trips/:id/expenses/:expenseId` | Payer / admin | Remove an expense |

**Captain** = the trip's admin or its current leader.

\* *Any* here means the trip's admin or an **active** member; everyone else gets 403.

**Status transitions:** `PLANNED → ACTIVE` (start), `ACTIVE ⇄ PAUSED`, any open state `→ COMPLETED` (end) or `→ CANCELLED`.

### Create trip body

```json
{
  "name": "Lonavala Monsoon Ride",
  "description": "Breakfast at Talegaon, lunch in Lonavala",
  "imageUrl": "/uploads/3f1c….jpg",
  "communityId": "uuid | null",
  "start":       { "name": "Shivajinagar, Pune", "lat": 18.5308, "lng": 73.8475 },
  "destination": { "name": "Lonavala",           "lat": 18.7546, "lng": 73.4062 },
  "waypoints":   [{ "name": "Talegaon", "lat": 18.735, "lng": 73.6755 }],
  "checkpoints": [{ "name": "HP Fuel", "category": "FUEL", "lat": 18.6795, "lng": 73.736, "eta": "2026-11-20T01:30:00Z" }],
  "route": { "geometry": [[18.53, 73.84], …], "distance": 59390, "duration": 4751, "provider": "osrm" },
  "groupCode": "PUNE-RIDE",
  "groupPassword": "ride123",
  "maxMembers": 15,
  "vehicleType": "BIKE",
  "speedLimitKmh": 70,
  "departureTime": "2026-11-20T01:00:00Z",
  "expectedArrival": "2026-11-20T03:30:00Z"
}
```

- `route` is optional. If omitted, the server computes it (ORS → OSRM → straight line).
- `groupCode` is optional; one like `NAV-7K3QX` is generated if omitted.
- `checkpoints`: unlimited in the UI (API cap 200). Categories: `BREAKFAST FUEL HYDRATION LUNCH REST SCENIC HOTEL HOSPITAL OTHER`.
- `vehicleType`: `BIKE CAR BICYCLE BUS WALKING MIXED`.

### Snapshot `members[]` item

```json
{
  "userId": "…", "name": "Aarav Patil", "vehicleNumber": "MH12 AB 1234", "isLeader": true,
  "lat": 18.73, "lng": 73.67, "speed": 47.2, "heading": 281, "battery": 64,
  "status": "MOVING | STOPPED | OFFLINE | ARRIVED", "online": true,
  "progress": 26100, "progressPercent": 43.9, "distanceRemaining": 33290,
  "distanceFromRoute": 12, "eta": "2026-11-20T02:41:00.000Z", "etaSeconds": 2540,
  "distanceFromLeader": 0, "lastSeenAt": 1795000000000, "arrivedAt": null,
  "checkpointsVisited": ["…"], "nextCheckpointId": "…"
}
```

### `stats` (live convoy dashboard)

`totalMembers, activeMembers, offlineMembers, arrivedMembers, movingMembers, convoyLength (m, first→last rider along the route), slowest {name, speed}, fastest {name, speed}, averageSpeed, distanceRemaining (m, until the last rider arrives), routeDistance`

### Report (analytics)

`plannedDistanceKm, totalDistanceKm, averageDistanceKm, travelDurationSeconds, averageSpeedKmh, maxSpeedKmh, totalStops, fuelStops, checkpointsVisited, checkpointsTotal, checkpoints[], emergencyEvents[], alertsByType{}, routeCompletionPercent, membersTotal, membersArrived, participation[]`

Each `participation[]` item: `name, distanceKm, avgSpeedKmh, maxSpeedKmh, stops, checkpointsVisited, completionPercent, arrived, alerts, sosCount, messagesSent, pings`.

## Communities

| Method | Path | Role | Description |
| --- | --- | --- | --- |
| GET | `/communities?search=&category=` | Any | Public communities, with `myStatus` (`null`, `PENDING`, `APPROVED`, `REJECTED`) |
| POST | `/communities` | A | `{ name, description, city?, category?, coverImage?, isPublic? }` |
| GET | `/communities/owned` | A | My communities; `_count.members` = pending requests |
| GET | `/communities/:idOrSlug` | Any | Details, upcoming trips, latest 20 announcements |
| POST | `/communities/:id/join` | U | `{ message? }`: request to join |
| GET | `/communities/:id/requests` | A (owner) | Join requests |
| PATCH | `/communities/:id/requests/:memberId` | A (owner) | `{ decision: "APPROVED"\|"REJECTED" }` |
| POST | `/communities/:id/announcements` | A (owner) | `{ title, body }` |

## Geo (open-source map services, proxied)

| Method | Path | Body / query | Returns |
| --- | --- | --- | --- |
| POST | `/geo/route` | `{ coordinates: [[lat,lng], …] (2–27), profile: "driving"\|"cycling"\|"walking" }` | `{ geometry, distance (m), duration (s), provider }` |
| GET | `/geo/search?q=` | | `[{ name, shortName, lat, lng, type }]` via Nominatim (cached) |
| GET | `/geo/reverse?lat=&lng=` | | `{ name, shortName, lat, lng }`; falls back to coordinates |

## Uploads

| Method | Path | Role | Body | Returns |
| --- | --- | --- | --- | --- |
| POST | `/uploads/image` | A | `multipart/form-data`, field `image` (JPG/PNG/WEBP ≤ 3 MB) | `{ url: "/uploads/<uuid>.jpg" }` |

## Health

`GET /api/health` → `{ status: "ok", db: "up" | "down", uptime }` (503 when the DB is down).

---

# Socket.IO events

Connect with `io(API_URL, { auth: { token: "<JWT>" } })`. Every client → server event accepts an ack callback that receives `{ ok: true, data }` or `{ ok: false, error }`.

### Client → server

| Event | Payload | Who | Ack data |
| --- | --- | --- | --- |
| `trip:join` | `{ tripId }` | admin / member | snapshot `{ trip, members, stats, role }` |
| `trip:leave` | `{ tripId }` | any | `{ left }` |
| `location:update` | `{ tripId, lat, lng, speed?, heading?, accuracy?, battery? }` | member (max 1/s) | `{ member }` |
| `chat:send` | `{ tripId, body, recipientId? }` | admin / member (max 6 per 5 s) | message |
| `sos:trigger` | `{ tripId, lat, lng, speed?, battery?, emergencyType, note? }` | member | `{ alertId, at }` |

| `ready:check` | `{ tripId }` | captain | asks everyone "Ready to roll?" |
| `ready:set` | `{ tripId, ready }` | member | |
| `meet:set` / `meet:clear` | `{ tripId, lat, lng, name? }` | captain | meet pin |
| `depart:set` | `{ tripId, minutes }` | captain | departure countdown |
| `sweep:set` | `{ tripId, userId }` | captain | |
| `stop:request` | `{ tripId, reason: fuel\|food\|toilet\|rest\|photo\|other }` | member (1/min) | |

`speed` is in km/h. `emergencyType`: `ACCIDENT BREAKDOWN MEDICAL FUEL LOST SECURITY OTHER`.

### Server → client

| Event | Room | Payload |
| --- | --- | --- |
| `member:location` | trip | member (snapshot shape) |
| `members:update` | trip | member[] (every sweep, keeps statuses fresh) |
| `member:status` | trip | member (on connect/disconnect) |
| `member:joined` / `member:left` | trip | `{ userId, name, reason? }` |
| `member:removed` | user | `{ tripId, tripName }` |
| `member:arrived` | trip | `{ tripId, userId, name }` |
| `checkpoint:visited` | trip | `{ tripId, userId, name, checkpointId, checkpointName }` |
| `convoy:stats` | admin | stats |
| `alert:new` | admin | alert + `userName` |
| `sos:alert` | admin | alert; `data` = `{ userName, emergencyType, note, speed, battery, timestamp, lat, lng }` |
| `sos:broadcast` | trip (minus admin) | `{ name, emergencyType, lat, lng, at }` |
| `sos:acknowledged` | user | `{ tripId, alertId, by, at }` |
| `notification` | user | `{ tripId, level, title, message }`: off-route, overspeed, wrong way, low battery notices for the rider |
| `chat:message` | trip / both users | message `{ id, tripId, senderId, senderName, senderRole, recipientId, type, body, createdAt }` |
| `announcement` | trip | message (type `ANNOUNCEMENT`) |
| `trip:status` | trip | `{ tripId, status, action, at }` |
| `trip:leader` | trip | `{ tripId, leaderId, name }` |
| `trip:report` | trip | `{ tripId }` (analytics ready) |
| `trip:meet` / `trip:depart` / `trip:sweep` | trip | meet pin, `departAt`, sweep rider changes |
| `ready:check` / `ready:all` | trip / captains | ready check asked; everyone ready |
| `group:together` | captains | gap closed after a GAP alert |
| `convoy:turn-cleared` | captains | `{ km, side, bySweep }`: everyone made the turn |
| `sos:nearby` | nearest 2 riders + leader + sweep | `{ name, emergencyType, lat, lng, distance, card }` |
| `expenses:changed` | trip | `{ tripId }` |

Alert types added for group riding: `GAP` (rider too far behind leader, or behind the sweep) and `STOP_REQUEST`. Both go to captains (admin + leader), with cooldowns of 180 s and 60 s.
