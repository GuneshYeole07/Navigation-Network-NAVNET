# Testing strategy

## Pyramid

| Layer | Tool | What it proves |
| --- | --- | --- |
| **Unit** (server) | Vitest | Geo math (haversine, bearing, projection, windowed projection), every monitoring rule including its false-alarm guards, analytics track maths (distance, GPS-teleport filtering, stop detection, stop clustering) |
| **API integration** | Vitest + Supertest + real Postgres | Auth (validation, admin invite code, portal enforcement, RBAC), the full trip lifecycle (create → join → chat → leader → pause/resume → remove → end → report), community join/approve/announce flow, health and 404 handling |
| **Real-time integration** | Vitest + socket.io-client against a real HTTP + Socket.IO server | Handshake auth, room joins, live location with derived ETA/progress, overspeed alert to admin plus rider notice, checkpoint crossing, SOS payload completeness and acknowledgement, sweeper OFFLINE detection, arrival, group chat, wrong-direction sliding window |
| **Unit** (client) | Vitest | Formatting helpers and client geo parity with the server |
| **End-to-end** | Playwright (`e2e/run_e2e.py`), two real browsers + emulated GPS | 66 checks across every user story: signup, RBAC, Create Group wizard, join, live GPS, off-route + overspeed alerts, group/private chat, broadcast, SOS round trip, pause/resume, **server restart mid-trip**, a full **offline drill** (API, web server and tile server all killed: navigation, cached map, app reopen, queued chat + SOS, then auto-sync on reconnect), invite link + QR, location explainer, SOS alarm, checkpoint, arrival, analytics, community approval, session persistence |

Integration tests hit a **real PostgreSQL database** instead of mocks: the risky parts of this app are SQL constraints, cascades and transactions, and mocks would hide exactly those bugs. Routing is forced offline in tests (`OSRM_URL=http://127.0.0.1:9`), which also exercises the straight-line fallback deterministically.

## Running

```bash
# one-time: create the test database and its tables
createdb navnet_test
cd server
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/navnet_test npx prisma db push

# run
npm test                 # server: 84 tests
npm test --prefix ../client   # client: 10 tests
npm run test:watch       # server watch mode
```

`tests/setup.js` points tests at `TEST_DATABASE_URL`, or `DATABASE_URL` with `_test` appended. Each suite truncates every table first, so tests never touch your dev data. CI (`.github/workflows/ci.yml`) runs the same suites against a Postgres service container and builds the client.

## End-to-end test (two browsers)

```bash
pip install playwright
python -m playwright install chromium
# stop `npm run dev` first; the script starts its own API (:5000) and web (:5173)
python e2e/run_e2e.py
```

It opens an **admin** browser and a **rider** browser, signs up a brand-new rider, builds a trip through the wizard by clicking the map, then moves the rider with emulated GPS while asserting what each side sees. It also kills and restarts the API mid-trip to prove the live state recovers from Postgres. It prints PASS/FAIL per check and exits non-zero on any failure. It's safe to re-run, because every run uses fresh Group IDs and emails.

Bugs this test caught (all fixed):
- Opening the app with no network logged the rider out and wiped their saved trip. Now only a genuine "session invalid" response logs out.
- After sign-up from an invite link, a render race sent the user to the home page instead of the trip.
- Queued chat and SOS raced ahead of the socket re-joining the trip after reconnect, and were rejected. The server now auto-joins (with the same access check).
- The wizard's "Continue to review" button submitted the form, skipping the review step. React reused the same `<button>` element as it switched to `type="submit"` mid-click.
- A wrong **group** password returned HTTP 401, which the client treats as an expired session, so a typo logged the rider out. It now returns 403.

## Group ride test (three phones)

```bash
python e2e/group_ride.py            # stop `npm run dev` first
SHOTS=shots python e2e/group_ride.py  # also saves a screenshot of each moment
```

Three phone-sized browsers ride an L-shaped route: the **captain** (admin riding), **Aarav**, and **Diya** (battery at 18%). 33 checks: emergency card, roll call, ready check, gap alert + "catch up" banner, push-to-talk voice auto-play, stop request, meet pin guidance, headcount + departure countdown, turn cleared, nearby fuel (stub Overpass), SOS to nearest friend with emergency card, battery saver, expenses, ride summary card. Map tiles and Overpass are served by a local stub on :8099, so it needs no internet.

## Manual QA script (10 minutes)

1. `npm run db:seed`, `npm run dev`.
2. **Landing → Login as Admin** → *Fill in the demo admin account* → sign in. You should see exactly three options.
3. **Create Group**: search "Pune" as the start and "Lonavala" as the destination, add a waypoint by clicking the map, add 2 checkpoints, set a Group ID and password, then create. The modal shows credentials; *Back to admin dashboard*.
4. In a private window: **Login as User** (`aarav@navnet.dev`). You should see exactly two options. **Join Trip** with your new Group ID and password, and allow location.
5. Back in the admin window: **Group Monitoring Panel** → your trip → **Start trip**. The rider gets a toast.
6. Admin: **Broadcast** a message. The rider sees a yellow banner on the map.
7. Rider: **Chat → Message admin**. The admin replies via *Riders → ⋮ → Message privately*.
8. Rider: **SOS → Medical → Send SOS now**. The admin gets a red banner and an alert with name, GPS, speed, battery, type and time; *Acknowledge SOS* makes the rider see "has seen your SOS".
9. For the full convoy, run `npm run simulate` against `PUNE-RIDE` and watch alerts arrive. Use **Pause / Resume**, **Make group leader**, **Remove from trip**.
10. **End** the trip → the analytics page loads automatically. Use *Print / save PDF*.
11. Toggle dark mode and resize to phone width: the panel becomes a bottom sheet and the SOS button stays reachable.

## Known gaps / next tests

- Run `e2e/run_e2e.py` in CI (needs a Postgres service + `playwright install chromium`).
- Load test: k6 or Artillery with ~500 simulated sockets pinging every 3 s, to profile `processLocation`.
- Fuzzing socket payloads (Zod already rejects malformed input; fuzzing would confirm no event can crash the gateway).
