# NavNet Analytics (Python)

A FastAPI service that turns NavNet's GPS history into **ride insights** and a
**machine-learned arrival time (ETA)**. The NavNet API calls it server-to-server; riders
and admins see the results in the app.

| Endpoint | What it returns |
|---|---|
| `GET /health` | Service status and ETA model accuracy |
| `GET /trips/{id}/insights` | Speed along the route km by km, slowest stretches, group stops, per-rider stats (moving speed, steadiness, distance behind the leader) |
| `GET /trips/{id}/eta` | Arrival time for a running trip, predicted by the model (falls back to the planned speed if there is no model) |
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

Tests: `python -m pytest` (18 tests: geometry, insights against rides with known stops and
slow sections, model training/evaluation, API auth and endpoints).

## Code map

| File | Purpose |
|---|---|
| `app/geo.py` | Haversine distance, route projection (NumPy) |
| `app/ride.py` | `Ride` data class; ping cleaning and speed derivation (pandas) |
| `app/insights.py` | Speed profile, slow stretches, stop detection and clustering, rider stats |
| `app/eta_model.py` | Feature engineering, training with grouped cross-validation, live prediction |
| `app/simulate.py` | Realistic synthetic rides |
| `app/db.py` | Read-only PostgreSQL access (SQLAlchemy) |
| `app/main.py` | FastAPI app, auth, caching |
