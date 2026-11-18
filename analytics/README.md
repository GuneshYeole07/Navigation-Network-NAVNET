# NavNet Analytics (Python)

A FastAPI service that turns NavNet's GPS history into **ride insights**, a
**machine-learned arrival time (ETA)**, **cleaned GPS tracks**, and a **live safety
monitor**. The NavNet API calls it server-to-server; riders and admins see the results in
the app. It also ships a **load + failure tester** for the real-time tracking.

| Endpoint | What it returns |
|---|---|
| `GET /health` | Service status and ETA model accuracy |
| `GET /trips/{id}/insights` | Speed along the route km by km, slowest stretches, group stops, per-rider stats (moving speed, steadiness, distance behind the leader) |
| `GET /trips/{id}/eta` | Arrival time for a running trip, predicted by the model (falls back to the planned speed if there is no model) |
| `GET /trips/{id}/tracks` | Every rider's cleaned track (Kalman filter + smoother), with how many fixes were rejected |
| `GET /safety` | Live safety monitor status (pings seen, alerts raised / delivered) |
| `GET /model` | Model accuracy vs the old fixed-speed estimate |
| `POST /model/train` | Retrain on all finished trips |

All but `/health` need the `X-Analytics-Key` header (shared secret with the API).

## How the ETA model works

The old estimate was *remaining distance ÷ planned speed*. It ignores traffic at that
hour, slow ghat sections, how fast this particular group rides, and stops. The model
learns those from finished trips:

1. For every finished trip, project each GPS fix onto the route (NumPy, vectorised) to get
   each rider's distance along it, then the group's (median rider) progress minute by minute.
2. Every 2 minutes of every ride becomes one training row: remaining km, progress, speed
   over the last 10 minutes, average speed so far, planned speed, hour of day, weekend,
   group size, stops so far, stopped right now, vehicle type → **minutes until the group
   actually arrived**.
3. A gradient-boosted tree model (scikit-learn `HistGradientBoostingRegressor`) is trained
   on those rows. Accuracy is measured with **5-fold cross-validation split by trip** (rows
   from the same ride never appear in both train and test), against the old estimate.

On 80 simulated rides it is about **35% more accurate** than the fixed-speed estimate
(mean error ~24 min vs ~37 min). `/model` shows the current numbers.

**Training data.** Until enough real trips are finished, `scripts/simulate_history.py`
generates realistic ride histories (traffic by hour, ghat sections, group stops where
riders wait for each other, rider pace differences, GPS noise). Simulated trips are
clearly marked "[Sim]" and can be removed with `--remove`; then retrain on real trips only.

## GPS cleaning (accuracy)

`app/gps.py`: a constant-velocity Kalman filter in metres. Each fix is weighted by the
accuracy the phone reports, and the phone's Doppler speed + heading are used when present.

- **Glitch or manoeuvre?** A fix far from the prediction (chi-square gate, 99.9%) is held
  back for one fix. A glitch is followed by a normal fix and gets dropped. A real U-turn,
  sharp bend or tunnel exit is followed by a fix that agrees with it, and the filter restarts
  there. If the phone's own heading says it turned, the turn is followed immediately.
- **Plausibility** uses the phone's Doppler speed (barely affected by reflections): a rider
  the phone says is standing still can't have moved 200 m.
- **Never stuck**: never ignores more than 4 fixes in a row, never coasts more than 5 s,
  and accepts a held fix nothing contradicted for 8 s (rider turned in and parked).
- **Finished trips** also get a Rauch-Tung-Striebel smoother (uses the fixes after each point).

The same live filter runs on the phone (`client/src/utils/gpsFilter.js`); a test replays
Python-generated tracks through it and requires the two to agree within 1 m on every fix.

`python -m scripts.gps_benchmark` (simulated rides with known true positions, correlated
GPS drift, multipath jumps):

| Scenario | Raw RMSE | Live (phone) RMSE | Smoothed RMSE | Raw worst | Live worst |
|---|---|---|---|---|---|
| Open highway, 6 m noise | 8.5 m | 7.5 m | 6.8 m | 25 m | 35 m |
| Towns, 10 m noise, 3% jumps | 46.1 m | 12.1 m | 10.2 m | 404 m | 96 m |
| City/ghats, 18 m noise, 8% jumps | 77.5 m | 18.6 m | 14.9 m | 421 m | 163 m |
| Sharp turns + U-turn at 90 km/h, phone speed+heading | 44.2 m | 12.7 m | | 276 m | 44 m |
| Same, position only (no speed/heading) | 44.2 m | 44.6 m | | 276 m | 174 m |

The last row is the honest limit: with position alone, a fast sharp turn looks exactly like
a glitch until the next fix, so the live view is one fix late at each corner. Phones (and
the Android app) report speed + heading while moving, which removes that lag.

## Live safety monitor

`app/safety.py` + `app/safety_stream.py`. With `SAFETY_MONITOR=1` in both `server/.env`
and `analytics/.env`, the API publishes each processed position on Postgres
`NOTIFY navnet_ping`; this service `LISTEN`s, and sends alerts back to the API
(`POST /api/internal/alerts`, same `ANALYTICS_KEY`), which delivers them to the admin and
the riding captain like any other alert.

| Alert | Rule |
|---|---|
| Possible crash | Hard stop from ≥ 25 km/h (≥ 3 m/s² between fixes), then still for 75 s, not near the destination / a checkpoint / the meet pin, and no other rider beside them. Also if the phone goes silent right after the hard stop. |
| Weak GPS | Median reported accuracy worse than 60 m for 2 minutes. |
| Unusual movement | Each rider's last minute (mean / spread / range of speed, hardest acceleration, heading change per second, time stopped) scored by an IsolationForest + per-feature envelope trained on simulated normal riding; 3 unusual minutes in a row. |

These are prompts to check on someone, not conclusions. The model trains itself on first
start (~10 s) and is saved to `models/safety.joblib`.

## Load + failure test

```bat
REM API with rate limits off (local only) and the safety monitor on
set RATE_LIMIT_DISABLED=1
set SAFETY_MONITOR=1
npm run dev --prefix ..\server
REM in another window, from analytics\
python -m loadtest.run --riders 100 --minutes 3 --crash
```

Each simulated rider has its own Socket.IO connection and sends a fix every 3 s; riders
randomly enter 20-60 s dead zones (fixes buffered, then uploaded with `location:batch`)
and have their connection killed. Results on a laptop-class sandbox (`loadtest/results/`):

| | 100 riders, 3 min | 300 riders, 2 min (before fix) | 300 riders, 2 min (after fix) |
|---|---|---|---|
| Fixes sent | 5,270 | 8,695 | 10,368 |
| Delivered to the admin's map | 100% | 100% | 100% |
| Delivery time p50 / p95 / p99 | 2 / 19 / 35 ms | 1,091 / 2,508 / 3,322 ms | 10 / 63 / 403 ms |
| Dead zones / dropped connections | 52 / 29 | 81 / 55 | 94 / 59 |
| Riders with no stored gap > 15 s | 100% | 86% | 100% |
| Possible-crash alert after the crash | 75 s (rule: 75 s still) | | |

The 300-rider run found a real bottleneck: every fix was sent to every phone, so traffic
grew with the square of the group size (~25,000 messages/s). Now the admin's map still gets
every fix instantly, and riders get everyone's moves in one message per second.

## Run it locally (Windows)

```bat
cd analytics
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements-dev.txt
copy .env.example .env
python -m scripts.simulate_history --trips 80
uvicorn app.main:app --reload --port 8000
```

Then in `server/.env` set `ANALYTICS_URL=http://localhost:8000` and the same
`ANALYTICS_KEY` as in `analytics/.env`, and restart `npm run dev`.

Tests: `python -m pytest` (32 tests: geometry, insights against rides with known stops and
slow sections, model training/evaluation, API auth and endpoints, GPS filter accuracy,
safety monitor rules).

## Code map

| File | Purpose |
|---|---|
| `app/geo.py` | Haversine distance, route projection (NumPy) |
| `app/ride.py` | `Ride` data class; ping cleaning and speed derivation (pandas) |
| `app/insights.py` | Speed profile, slow stretches, stop detection and clustering, rider stats |
| `app/eta_model.py` | Feature engineering, training with grouped cross-validation, live prediction |
| `app/simulate.py` | Realistic synthetic rides |
| `app/db.py` | Read-only PostgreSQL access (SQLAlchemy) |
| `app/gps.py` | Kalman filter + RTS smoother, glitch vs manoeuvre logic |
| `app/safety.py` | Crash / weak GPS / unusual movement rules, IsolationForest model |
| `app/safety_stream.py` | Postgres LISTEN loop, alert delivery, auto-reconnect |
| `app/main.py` | FastAPI app, auth, caching |
| `loadtest/run.py` | Load + failure tester (asyncio, python-socketio, httpx) |
| `scripts/gps_benchmark.py` | GPS accuracy benchmark |
| `scripts/export_gps_fixture.py` | Writes the tracks the phone filter is tested against |
