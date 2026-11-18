# Deploying NavNet

Three deployment paths, from simplest to most control. All of them need: Node ≥ 20.19, PostgreSQL ≥ 14, and HTTPS in production. Browsers only give GPS to secure origins, so **live location will not work over plain HTTP** (except on `localhost`).

---

## Test on your phone in 5 minutes (HTTPS tunnel)

Phones only share GPS with HTTPS sites. A Cloudflare quick tunnel gives your laptop a temporary HTTPS address, no account needed.

```bash
# Windows: winget install --id Cloudflare.cloudflared   (macOS: brew install cloudflared)
npm run dev                                   # terminal 1
cloudflared tunnel --url http://localhost:5173  # terminal 2 → prints https://<random>.trycloudflare.com
```

Open that URL on the phone. The laptop must stay awake and online; the address changes every time you restart the tunnel.

## Android app (lock-screen navigation)

The web app works on any phone, but a website loses GPS when the screen locks. The Android app (same code, wrapped with Capacitor) keeps GPS running with the screen off and shows the **next turn, km to go and arrival time on the lock screen**, like Google Maps.

The app talks to your deployed NavNet, so deploy first (Render, above) and note its address.

**Build the APK in the cloud (no Android Studio):**
1. GitHub repo → **Settings → Secrets and variables → Actions → Variables → New repository variable**: `NAVNET_API_URL` = `https://your-navnet.onrender.com`
2. **Actions** tab → **Android app** → **Run workflow**. Takes ~5–8 minutes.
3. Open the finished run, download **navnet-android**, unzip, and copy `app-debug.apk` to the phone. Open it and allow "Install unknown apps" when asked.

**Or build on your laptop** (needs Android Studio):
```bash
cd client
set VITE_API_URL=https://your-navnet.onrender.com   # macOS/Linux: export VITE_API_URL=...
npm run android:sync
npm run android:open      # opens Android Studio → press Run with the phone plugged in
```

On the phone, allow **Location** and **Notifications**. Lock-screen navigation appears once a trip is started. For testing without deploying, the HTTPS tunnel address works as `VITE_API_URL` (rebuild when it changes).

iPhone: needs a Mac with Xcode and an Apple Developer account (Live Activities); until then iPhone riders use the web app.

## Your own map tiles (optional, recommended before launch)

By default the app uses OpenFreeMap (free, no key). To serve the map yourself, so no outside service can switch it off and offline downloads are fully yours:

1. Download the `pmtiles` tool from github.com/protomaps/go-pmtiles/releases.
2. Cut out India (or your region) from the latest Protomaps build (see maps.protomaps.com/builds for the current file name):
   ```bash
   pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles india.pmtiles --bbox=68.1,6.5,97.4,35.6 --maxzoom=15
   ```
   Smaller test: a single state, e.g. Maharashtra `--bbox=72.6,15.6,80.9,22.1`.
3. Either put the file on the server (`PMTILES_PATH=./maps/india.pmtiles`) or upload it to object storage that supports range requests (Cloudflare R2, S3) and set `PMTILES_PATH=https://…/india.pmtiles`. On Render's free plan use the URL option (its disk is temporary).
4. Restart the API. `GET /api/tiles/tile.json` should return JSON; the app switches to it automatically.

Client options (`client/.env`): `VITE_MAP_STYLE_URL` / `VITE_MAP_STYLE_URL_DARK` use any other MapLibre style; `VITE_TILE_URL` changes the raster fallback.

## Option 0: Render Blueprint (one web service + Postgres, recommended)

`render.yaml` deploys the Docker image (API and app on one HTTPS URL) plus a Postgres database.

1. Push the project to GitHub (include `server/prisma/migrations`).
2. Render → **New → Blueprint** → choose the repo → enter an `ADMIN_SIGNUP_CODE` → **Apply**.
3. Demo data (optional), from your laptop: copy the database's **External Database URL** from Render, then in `server/`:
   `DATABASE_URL="<external url>" npm run db:seed`

Free tier notes: the service sleeps after ~15 min idle (first visit takes up to a minute), and voice notes/uploads are lost on redeploy.

---

## Option A: Render (API + Postgres) and Vercel (client)

Free tiers work for a demo.

### 1. Database
Render → **New → PostgreSQL**. Copy the **Internal Database URL**.

### 2. API (Render Web Service)
- Root directory: `server`
- Build command: `npm install && npx prisma migrate deploy`
- Start command: `npm start`
- Environment:
  ```
  NODE_ENV=production
  DATABASE_URL=<internal database url>
  JWT_SECRET=<48+ random bytes>
  CLIENT_ORIGIN=https://<your-app>.vercel.app
  ADMIN_SIGNUP_CODE=<pick one>
  GEO_USER_AGENT=NavNet/1.0 (you@example.com)
  ORS_API_KEY=<optional>
  ```
- Once, from the Render shell: `npm run db:seed` (optional demo data).

> Commit `server/prisma/migrations` (created by `npm run db:migrate -- --name init` locally) before deploying, so `migrate deploy` has something to apply.

> Render's free tier sleeps after inactivity, and its disk is ephemeral, so uploaded images vanish on redeploy. For persistent uploads, attach a Render Disk mounted at `server/uploads`, or swap Multer storage for S3/Cloudinary.

### 3. Client (Vercel)
- Root directory: `client`
- Framework preset: Vite (build `npm run build`, output `dist`)
- Environment: `VITE_API_URL=https://<your-api>.onrender.com`
- `client/vercel.json` (included) rewrites deep links to the SPA:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```

---

## Option B: Docker (single container + Postgres)

```bash
JWT_SECRET=$(openssl rand -hex 48) docker compose up --build -d
docker compose exec app npm run db:seed
```

The image builds the React client and the API serves it, so everything runs on one origin at port 5000. On start it runs `prisma migrate deploy` if migrations are committed, otherwise `prisma db push`. Put a TLS-terminating proxy (Caddy, Nginx, Cloudflare) in front.

---

## Option C: VPS with PM2 + Nginx

```bash
# on the server
git clone … && cd navnet
npm run install:all
cp server/.env.example server/.env   # fill in production values, CLIENT_ORIGIN=https://navnet.example.com
cd server && npx prisma migrate deploy && cd ..
npm run build                        # builds client/dist
NODE_ENV=production pm2 start server/src/server.js --name navnet --cwd server
```

With `NODE_ENV=production` the API also serves `client/dist`, so one Nginx site is enough:

```nginx
server {
  server_name navnet.example.com;
  client_max_body_size 5m;

  location / {
    proxy_pass http://127.0.0.1:5000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;      # WebSockets
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 75s;
  }
  # listen 443 ssl; … (certbot --nginx)
}
```

---

## Production checklist

- [ ] `JWT_SECRET` is long and random, and **not** the example value
- [ ] `CLIENT_ORIGIN` lists only your real front-end origin(s)
- [ ] HTTPS everywhere (required for GPS and secure WebSockets)
- [ ] `ADMIN_SIGNUP_CODE` set to something private, or empty to disable admin signup
- [ ] `GEO_USER_AGENT` contains a real contact (Nominatim policy)
- [ ] For real traffic: an `ORS_API_KEY`, or self-hosted OSRM + Nominatim, plus a tile provider that permits your volume (the OSM tile servers are for light use)
- [ ] `server/prisma/migrations` committed; `prisma migrate deploy` in the release step
- [ ] Persistent storage for `uploads/` (disk or object storage)
- [ ] Postgres backups enabled
- [ ] `VITE_SHOW_DEMO=false` if you don't want demo-login shortcuts in production
- [ ] Before scaling past one instance, read the scaling section in [ARCHITECTURE.md](ARCHITECTURE.md#scaling-beyond-one-process) (Redis adapter, sticky sessions)
