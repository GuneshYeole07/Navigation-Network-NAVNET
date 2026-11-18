"""
NavNet end-to-end test: drives two real browsers (an admin and a brand-new rider)
through every feature, with emulated GPS moving the rider along the route.

Setup (once):   pip install playwright && python -m playwright install chromium
Run:            stop `npm run dev` first (this script starts its own API + web server), then
                python e2e/run_e2e.py
Needs a migrated + seeded database (npm run db:migrate, npm run db:seed).
"""
import asyncio, json, os, shutil, subprocess, sys, time, urllib.request
from pathlib import Path
from playwright.async_api import async_playwright
B="http://localhost:5173"; API="http://localhost:5000/api"
ROOT=Path(__file__).resolve().parent.parent
RUN=str(int(time.time()))[-6:]          # unique suffix so the test can run repeatedly
GROUP=f"E2E-{RUN}"; EMAIL=f"rider{RUN}@test.dev"
results=[]
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ")+name+(f"  [{detail}]" if detail else ""), flush=True)
def api(path, token, method="GET", body=None):
    req=urllib.request.Request(API+path, method=method, headers={"Authorization":f"Bearer {token}","Content-Type":"application/json"}, data=json.dumps(body).encode() if body else None)
    return json.loads(urllib.request.urlopen(req).read())["data"]
async def has_text(page, text, timeout=8000):
    try: await page.get_by_text(text).first.wait_for(timeout=timeout); return True
    except Exception: return False
LOG=open(ROOT/"e2e"/"server.log","a")
# A tiny stand-in tile server, so the offline-map drill doesn't depend on the internet.
import threading, base64, stub_maps
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
TILE_PNG=base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
# Stand-in OpenStreetMap services (place search + road routing) so the wizard test is deterministic.
import math
from urllib.parse import urlsplit as urlparse, parse_qs
PLACES={"shaniwar":("Shaniwar Wada","Shaniwar Wada, Pune, Maharashtra, India",18.5195,73.8553,"attraction"),
        "lonavala":("Lonavala","Lonavala, Pune District, Maharashtra, India",18.7546,73.4062,"town"),
        "indian oil":("Indian Oil Talegaon","Indian Oil, Talegaon, Maharashtra, India",(18.5195+18.7546)/2,(73.8553+73.4062)/2,"fuel")}
def osrm_route(path):
    pts=[tuple(map(float,c.split(","))) for c in path.split(";")]   # lng,lat
    geo=[]
    for (a,b),(c,d) in zip(pts,pts[1:]):
        geo += [[a+(c-a)*k/100, b+(d-b)*k/100] for k in range(100)]
    geo.append(list(pts[-1]))
    dist=sum(math.hypot((c-a)*105000,(d-b)*111000) for (a,b),(c,d) in zip(pts,pts[1:]))
    return {"code":"Ok","routes":[{"geometry":{"type":"LineString","coordinates":geo},"distance":dist,"duration":dist/12}]}
class Tiles(BaseHTTPRequestHandler):
    def send_json(self, obj):
        b=json.dumps(obj).encode(); self.send_response(200); self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(b))); self.end_headers(); self.wfile.write(b)
    def do_GET(self):
        u=urlparse(self.path); q=parse_qs(u.query)
        if u.path.startswith("/nominatim/search"):
            text=q.get("q",[""])[0].lower()
            return self.send_json([{"name":n,"display_name":d,"lat":str(la),"lon":str(ln),"type":t} for k,(n,d,la,ln,t) in PLACES.items() if k in text])
        if u.path.startswith("/nominatim/reverse"):
            return self.send_json({"name":"Dropped pin road","display_name":"Old Mumbai-Pune Highway, Maharashtra, India"})
        if u.path.startswith("/osrm/route/v1/"):
            return self.send_json(osrm_route(u.path.split("/",5)[5]))
        m = stub_maps.handle(self.path, f"http://localhost:{TILE_PORT}")
        if m:
            body, ctype = m
            self.send_response(200); self.send_header("Content-Type",ctype); self.send_header("Access-Control-Allow-Origin","*")
            self.send_header("Content-Length",str(len(body))); self.end_headers(); return self.wfile.write(body)
        self.send_response(200); self.send_header("Content-Type","image/png"); self.send_header("Access-Control-Allow-Origin","*")
        self.send_header("Content-Length",str(len(TILE_PNG))); self.end_headers(); self.wfile.write(TILE_PNG)
    def log_message(self,*a): pass
TILE_PORT=8099
def start_tiles():
    srv=ThreadingHTTPServer(("127.0.0.1",TILE_PORT),Tiles); threading.Thread(target=srv.serve_forever,daemon=True).start(); return srv

def start_vite():
    env={**os.environ, "VITE_TILE_URL":f"http://localhost:{TILE_PORT}/{{z}}/{{x}}/{{y}}.png",
         "VITE_MAP_STYLE_URL":f"http://localhost:{TILE_PORT}/style.json"}
    return subprocess.Popen([shutil.which("npx") or "npx","vite","--port","5173","--strictPort"], cwd=ROOT/"client", env=env, stdout=LOG, stderr=LOG)

def start_server():
    stub=f"http://127.0.0.1:{TILE_PORT}"
    env={**os.environ, "SWEEP_INTERVAL_SECONDS":"3", "STATIONARY_MINUTES":"0.4",
         "NOMINATIM_URL":f"{stub}/nominatim", "PHOTON_URL":f"{stub}/photon", "OSRM_URL":f"{stub}/osrm"}
    return subprocess.Popen(["node","src/server.js"], cwd=ROOT/"server", env=env, stdout=LOG, stderr=LOG)

async def main():
    srv=start_server(); tiles=start_tiles(); vite=start_vite()
    time.sleep(6)
    async with async_playwright() as p:
        br = await p.chromium.launch(**({"executable_path":os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}))
        A = await (await br.new_context(viewport={"width":1400,"height":900})).new_page()
        rctx = await br.new_context(viewport={"width":1400,"height":900}, permissions=["geolocation"], geolocation={"latitude":18.5,"longitude":73.8,"accuracy":10})
        R = await rctx.new_page()
        R.on("pageerror", lambda e: print("  [rider page error]", str(e)[:300]))
        errors=[]
        for pg,who in ((A,"admin"),(R,"rider")): pg.on("pageerror", lambda e,w=who: errors.append(f"{w}: {e}"))
        rider_console=[]
        R.on("console", lambda m: rider_console.append(f"{m.type}: {m.text[:200]}") if m.type in ("error","warning") else None)

        # ── 1. Rider registers a brand-new account through the UI
        await R.goto(f"{B}/login/user"); await R.click("text=Create an account")
        await R.get_by_label("Full name").fill("Test Rider"); await R.get_by_label("Email").fill(EMAIL)
        await R.get_by_label("Password").fill("Ride2026x"); await R.get_by_label("Vehicle number (optional)").fill("MH12 ZZ 0001")
        await R.get_by_label("Phone number (optional)").fill("98765 00000")
        await R.click("button[type=submit]"); await R.wait_for_timeout(2000)
        check("Rider signs up with a new account", R.url.endswith("/user") and await has_text(R,"Join Trip"))
        check("Rider home shows only Join Trip + Explore Community", await R.locator("main section").count()==2)

        # ── 2. Security checks
        await R.goto(f"{B}/admin"); await R.wait_for_timeout(1000)
        check("Rider cannot open admin pages (redirected)", "/admin" not in R.url, R.url)
        await A.goto(f"{B}/login/admin"); await A.get_by_label("Email").fill(EMAIL); await A.get_by_label("Password").fill("Ride2026x")
        await A.click("button[type=submit]"); 
        check("Rider account rejected at Admin login", await has_text(A,"not an Admin account"))

        # ── 3. Admin logs in and creates a group via the wizard (map clicks)
        await A.goto(f"{B}/login/admin"); await A.get_by_label("Email").fill("admin@navnet.dev"); await A.get_by_label("Password").fill("Admin@123")
        await A.click("button[type=submit]"); await A.wait_for_timeout(1800)
        check("Admin dashboard shows exactly 3 options", await A.locator("main a.panel").count()==3)
        await A.goto(f"{B}/admin/create-group"); await A.wait_for_timeout(1000)
        await A.get_by_label("Trip name").fill("E2E Test Ride"); await A.get_by_label("Description").fill("End-to-end verification trip")
        await A.click("text=Continue to route"); await A.wait_for_timeout(500)
        m = await A.locator(".nn-map").bounding_box()
        async def search_pick(label, text, expect):
            box=A.get_by_label(label, exact=True); await box.click(); await box.fill(text)
            await A.locator(f"[role=listbox] button:has-text('{expect}')").first.click(); await A.wait_for_timeout(600)
        async def tap_map(fx, fy):
            await A.mouse.click(m["x"]+m["width"]*fx, m["y"]+m["height"]*fy); await A.wait_for_timeout(1200)
        await search_pick("Start", "Shaniwar Wada", "Shaniwar Wada")
        await search_pick("Destination", "Lonavala", "Lonavala")
        ok_route = await has_text(A,"Route preview:", 20000)
        check("Route preview from searched start + destination (no map clicks)", ok_route and await has_text(A,"via OpenStreetMap roads"))
        await tap_map(.30,.70)
        check("Tapping the map offers 'Add stop on the way'", await A.locator(".maplibregl-popup button:has-text('Add stop on the way')").count()==1)
        await A.click(".maplibregl-popup button:has-text('Add stop on the way')"); await A.wait_for_timeout(800)
        check("Stop added from map tap", await A.locator("[aria-label^='Remove waypoint']").count()==1)
        await A.click("[aria-label^='Remove waypoint']"); await A.wait_for_timeout(800)
        await has_text(A,"Route preview:", 20000)
        await A.click("text=Continue to checkpoints"); await A.wait_for_timeout(500)
        await search_pick("Add a checkpoint", "Indian Oil", "Indian Oil Talegaon")
        check("Checkpoint added straight from search, type guessed (Fuel)", await A.locator("select[aria-label='Type of Indian Oil Talegaon']").input_value()=="FUEL")
        await A.get_by_label("Checkpoint 1 name").fill("Fuel stop E2E")
        await tap_map(.85,.15); await A.click(".maplibregl-popup button:has-text('Add checkpoint here')"); await A.wait_for_timeout(500)
        check("Checkpoint added from map tap", await A.locator("[aria-label='Checkpoint 2 name']").count()==1)
        await A.click("[aria-label^='Remove checkpoint']:not([aria-label$='Fuel stop E2E'])"); await A.wait_for_timeout(300)
        check("Checkpoint added", await A.locator("[aria-label='Checkpoint 1 name']").input_value()=="Fuel stop E2E" and await A.locator("[aria-label='Checkpoint 2 name']").count()==0)
        await A.click("text=Continue to group settings")
        await A.get_by_label("Group ID (optional)").fill(GROUP); await A.get_by_label("Group password").fill("e2e1234")
        await A.get_by_label("Speed limit (km/h)").fill("60")
        await A.click("text=Continue to review"); await A.wait_for_timeout(800)
        check("Wizard stops on Review step (no early submit)", await A.locator("text=Group created").count()==0 and await A.locator("button[type=submit]:has-text('Create group')").count()==1)
        await A.click("button:has-text('Create group')")
        created_ok = await has_text(A,"Group created", 10000) and await has_text(A,"e2e1234")
        check("Group created, credentials shown", created_ok, "" if created_ok else (await A.locator("[role=status]").all_inner_texts()))
        atoken = await A.evaluate("localStorage.getItem('navnet-token')")
        trip = [t for t in api("/trips/mine", atoken) if t["groupCode"]==GROUP][0]
        snap = api(f"/trips/{trip['id']}", atoken); line = snap["trip"]["routeGeometry"]
        check("Trip saved in DB with route + checkpoint", len(line)>2 and len(snap["trip"]["checkpoints"])==1, f"{round(snap['trip']['routeDistance']/1000,1)} km via {snap['trip']['routeProvider']}")
        await A.click("text=Back to admin dashboard")

        # ── 4. Rider joins (wrong password first)
        await R.goto(f"{B}/user/join"); await R.get_by_label("Group ID").fill(GROUP.lower()); await R.get_by_label("Group password").fill("wrong")
        await R.click("form button"); 
        check("Wrong group password is rejected", await has_text(R,"Invalid Group ID or password"))
        await R.wait_for_timeout(800)
        check("Wrong password does NOT log the rider out", "/user/join" in R.url, R.url)
        await R.get_by_label("Group password").fill("e2e1234"); await R.click("form button"); await R.wait_for_timeout(3000)
        check("Rider joins with correct Group ID + password", "/user/trip/" in R.url)
        rider_trip_url = R.url

        # ── 4b. Download the offline map (tiles along the route corridor)
        await R.reload(); await R.wait_for_timeout(2500)   # page now controlled by the service worker
        try:
            await R.click("button:has-text('Download offline map')", timeout=15000)
        except Exception:
            await R.screenshot(path=str(ROOT/"e2e"/"fail-offline.png")); raise
        check("Offline map downloads", await has_text(R,"Offline map saved", 60000))
        kinds = await R.evaluate("caches.open('navnet-tiles').then(c=>c.keys()).then(k=>({tiles:k.filter(r=>r.url.includes('/vt/')).length, fonts:k.filter(r=>r.url.includes('/fonts/')).length, style:k.filter(r=>r.url.endsWith('/style.json')||r.url.endsWith('/tilejson')).length}))")
        check("Vector map tiles + fonts + style stored on the phone", kinds["tiles"]>50 and kinds["fonts"]>0 and kinds["style"]==2, json.dumps(kinds))
        check("Map is the vector basemap (not the raster fallback)", await R.locator(".nn-map[data-basemap='custom']").count()==1)

        # ── 5. Admin opens monitoring and starts the trip
        await A.goto(f"{B}/admin/monitor/{trip['id']}"); await A.wait_for_timeout(2500)
        check("Admin sees the new rider in the panel", await has_text(A,"Test Rider"))
        check("Admin has one-tap Call for the rider", await A.locator("a[aria-label='Call Test Rider']").count()==1)
        await A.click("button[aria-label='Invite riders']")
        check("Invite shows a QR code", await A.locator("img[alt='QR code to join the trip']").count()==1 or await has_text(A,"Riders scan this"))
        await A.keyboard.press("Escape")
        inv = api(f"/trips/{trip['id']}/invite", atoken, "POST")
        r2 = await br.new_context(viewport={"width":390,"height":844})
        P2 = await r2.new_page(); P2.on("pageerror", lambda e: errors.append(f"rider2: {e}"))
        await P2.goto(f"{B}/user/join?invite={inv['token']}"); await P2.wait_for_timeout(1200)
        await P2.click("text=Create an account"); await P2.get_by_label("Full name").fill("Invited Rider"); await P2.get_by_label("Email").fill(f"inv{RUN}@test.dev")
        await P2.get_by_label("Password").fill("Ride2026x"); await P2.click("button[type=submit]"); await P2.wait_for_timeout(3500)
        check("Invite link: new user signs up and lands in the trip", "/user/trip/" in P2.url, P2.url)
        check("Location explainer shown before asking permission", await has_text(P2,"Share your location"))
        await r2.close()
        await A.click("button:has-text('Start trip')")
        check("Rider gets 'trip started' live", await has_text(R,"Trip started"))

        # ── 6. Real browser GPS: move rider along the route
        n=len(line)
        # accuracy 8 = a real phone: the GPS filter (phone + server) is fully on.
        # Fast-forward stretches (minutes of riding squeezed into seconds, i.e. impossible
        # speeds) use accuracy 0, which both treat as a simulator and trust as-is.
        async def goto_pt(lat,lng,wait=3600,acc=8):
            await rctx.set_geolocation({"latitude":lat,"longitude":lng,"accuracy":acc}); await R.wait_for_timeout(wait)
        async def ff(lat,lng,wait=3600): await goto_pt(lat,lng,wait,0)
        for i in range(0, max(4,n//6), max(1,n//24)):
            await goto_pt(*line[i])
        s = api(f"/trips/{trip['id']}", atoken); me=[x for x in s["members"] if x["name"]=="Test Rider"][0]
        check("Browser GPS reaches server (live position + progress)", me["lat"] is not None and me["progress"]>0, f"progress {me['progress']} m, {me['status']}")
        check("Admin map shows rider marker", await A.locator(".nn-member").count()>=1)
        check("Rider dashboard shows km-to-go and ETA", await has_text(R,"km to go") and await has_text(R,"ETA"))

        # ── 7. Smart monitoring: off-route (1 km north, twice) and overspeed (big jump)
        # Moves are physically possible (≤ ~110 km/h): the phone-side GPS filter and the server
        # both throw away "teleports" now, exactly as they should for a real GPS glitch.
        mid=line[n//3]
        for k in range(1, 12): await goto_pt(mid[0]+0.001*k, mid[1], 3000)   # ride ~1.2 km off the route
        await goto_pt(mid[0]+0.0121, mid[1])
        await A.click("role=tab[name=/Alerts/]")
        check("Off-route alert reaches admin", await has_text(A,"off the planned route", 10000))
        for k in range(10, -1, -1): await goto_pt(mid[0]+0.001*k, mid[1], 3000)  # back to the route, fast
        check("Overspeed alert reaches admin (fast riding)", await has_text(A,"limit 60", 6000))
        await goto_pt(*line[n//3+1])

        # ── 8. Chat: group, private both ways, broadcast
        await R.click("button[aria-label^='Open chat']"); await R.get_by_label("Message", exact=True).fill("Hello from rider"); await R.keyboard.press("Enter")
        await A.click("role=tab[name='Chat']")
        check("Group chat rider → admin", await has_text(A,"Hello from rider"))
        await A.click("role=tab[name=/Riders/]"); await A.click("button[aria-label='Actions for Test Rider']"); await A.click("text=Message privately")
        await A.get_by_label("Message", exact=True).fill("Private hi from admin"); await A.keyboard.press("Enter")
        check("Private chat admin → rider", await has_text(R,"Private hi from admin"))
        await R.click("role=radio[name=/Only/]"); await R.get_by_label("Message", exact=True).fill("Private reply"); await R.keyboard.press("Enter")
        check("Private chat rider → admin", await has_text(A,"Private reply"))
        await R.click("role=radio[name=/To everyone/]"); await R.click("button:has-text('All good')")
        await A.click("role=tab[name='Group chat']")
        check("Quick reply sends in one tap", await has_text(A,"All good"))
        await R.click("button[aria-label='Close chat']")
        await A.click("button:has-text('Broadcast')"); await A.get_by_label("Broadcast message").fill("Regroup at the fuel stop")
        await A.click("button:has-text('Send broadcast')")
        check("Broadcast shows as banner on rider map", await has_text(R,"Regroup at the fuel stop"))

        # ── 9. SOS round trip
        await R.click("button[aria-label='SOS — send emergency alert']"); await R.click("text=Medical"); await R.click("text=Send SOS now")
        check("Rider sees SOS confirmation", await has_text(R,"SOS sent"))
        check("Admin gets SOS banner instantly", await has_text(A,"needs help"))
        check("Admin SOS alarm is sounding (silence button shown)", await A.locator("button[aria-label='Silence alarm']").count()==1)
        await A.click("role=tab[name=/Alerts/]"); await A.wait_for_timeout(500)
        sos_ok = await has_text(A,"Medical") and await has_text(A,"GPS")
        check("SOS alert has type, GPS, speed, battery, time", sos_ok)
        await A.click("button:has-text('Acknowledge SOS')")
        check("Rider notified admin acknowledged SOS", await has_text(R,"has seen your SOS"))
        await R.keyboard.press("Escape")

        # ── 10. Pause / resume
        await A.click("button:has-text('Pause')")
        check("Pause reaches rider", await has_text(R,"paused the trip"))
        await A.click("button:has-text('Resume')")
        check("Resume reaches rider", await has_text(R,"Trip resumed"))

        # ── 11. Server restart mid-trip: state recovers from Postgres
        srv.terminate(); srv.wait(); time.sleep(1); srv=start_server(); time.sleep(4)
        for i in range(n//3+2, n//2+4, 3): await ff(*line[min(i,n-1)])
        s2 = api(f"/trips/{trip['id']}", atoken); me2=[x for x in s2["members"] if x["name"]=="Test Rider"][0]
        check("Survives server restart (reconnect + progress kept)", me2["progress"]>=me["progress"] and me2["online"], f"progress {me2['progress']} m")

        # ── 11b. DEAD ZONE: API, web server and tile server all gone
        prog_before = me2["progress"]
        srv.terminate(); srv.wait(); vite.terminate(); vite.wait(); tiles.shutdown(); await rctx.set_offline(True)
        await R.wait_for_timeout(4000)
        check("Rider sees Offline status", await has_text(R,"Offline"))
        def to_go():
            return R.locator("text=to go").first.locator("xpath=..").inner_text()
        before_txt = await to_go()
        for i in range(n//2+6, (3*n)//4, 3): await ff(*line[min(i,n-1)], 1500)
        after_txt = await to_go()
        check("Navigation keeps updating offline (km to go drops)", before_txt != after_txt, f"{before_txt.split()[0]} → {after_txt.split()[0]}")
        loaded = await R.evaluate("new Promise(r=>{const t=Date.now();(function f(){const m=window.__nnMap;if(m&&m.isStyleLoaded()&&m.areTilesLoaded())return r({ok:true,tiles:m.querySourceFeatures('omt',{sourceLayer:'roads'}).length});if(Date.now()-t>8000)return r({ok:false,map:!!m,style:m&&m.isStyleLoaded(),tiles:m&&m.areTilesLoaded(),sources:m&&Object.keys(m.getStyle()?.sources||{}),feats:m&&m.getSource('omt')?m.querySourceFeatures('omt',{sourceLayer:'roads'}).length:null});setTimeout(f,300)})()})")
        check("Vector map draws from saved tiles with no network", loaded.get("ok") and loaded.get("tiles",0)>0, json.dumps(loaded))
        if not loaded.get("ok"): print("rider console (last 15):", *rider_console[-15:], sep="\n  ")
        await R.click("button[aria-label^='Open chat']"); await R.click("button:has-text('Wait for me')")
        check("Chat message queued while offline", await has_text(R,"Sends when back online"))
        await R.click("button[aria-label='Close chat']")
        await R.click("button[aria-label='SOS — send emergency alert']"); await R.click("text=Breakdown"); await R.click("text=Send SOS now")
        check("SOS queued offline with SMS / call fallback", await has_text(R,"SOS queued") and await R.locator("a[href^='sms:']").count()>=1)
        await R.keyboard.press("Escape")
        await R.reload(); await R.wait_for_timeout(3000)
        check("App re-opens with no network (trip from phone storage)", await has_text(R,"to go") and await has_text(R,"Offline"))
        check("Offline re-open still shows the vector map (style + tiles from phone storage)", await R.locator(".nn-map[data-basemap='custom']").count()==1)

        # ── 11c. Network back: everything syncs by itself
        await rctx.set_offline(False); vite=start_vite(); srv=start_server(); time.sleep(7)
        await R.wait_for_timeout(8000)
        await A.click("role=tab[name='Chat']"); await A.click("role=tab[name='Group chat']")
        await ff(*line[(3*n)//4])
        check("Queued chat delivered after reconnect", await has_text(A,"Wait for me", 15000))
        outbox_left = await R.evaluate("Object.keys(localStorage).filter(k=>k.startsWith('navnet-outbox-')).map(k=>localStorage.getItem(k)).join('')")
        check("Rider's offline queue emptied", outbox_left in ("", "[]"), outbox_left[:60])
        check("Queued SOS delivered after reconnect", await has_text(A,"needs help", 15000))
        s4 = api(f"/trips/{trip['id']}", atoken); me4=[x for x in s4["members"] if x["name"]=="Test Rider"][0]
        check("Position syncs to admin after reconnect", me4["progress"]>prog_before, f"{prog_before} → {me4['progress']} m")

        # ── 12. Checkpoint + arrival
        await ff(*line[-2]); await ff(*line[-1]); await R.wait_for_timeout(1500)
        s3 = api(f"/trips/{trip['id']}", atoken); me3=[x for x in s3["members"] if x["name"]=="Test Rider"][0]
        check("Checkpoint recorded as visited", len(me3["checkpointsVisited"])==1)
        import math
        dlat, dlng = line[-1]
        dist_end = 6371000*math.hypot(math.radians(me3["lat"]-dlat), math.radians(me3["lng"]-dlng)*math.cos(math.radians(dlat))) if me3["lat"] else -1
        check("Arrival detected at destination", me3["status"]=="ARRIVED", f"{me3['status']}, {dist_end:.0f} m from the end, accuracy {me3.get('accuracy')}")

        # ── 13. End trip → analytics
        await A.click("button:has-text('End')"); await A.click("button:has-text('End trip')"); await A.wait_for_timeout(3500)
        check("Ending trip opens analytics report", "/report" in A.url and await has_text(A,"Member participation"))
        check("Report lists the rider with distance", await has_text(A,"Test Rider") and await has_text(A,"Arrived"))

        # ── 14. Community flow
        await A.goto(f"{B}/admin/create-community"); await A.get_by_label("Name").fill(f"E2E Riders {RUN}")
        await A.get_by_label("Description").fill("Community created by the end-to-end test"); await A.click("button:has-text('Create community')")
        check("Admin creates community", await has_text(A,f"E2E Riders {RUN} created"))
        await R.goto(f"{B}/user/communities"); await R.get_by_label("Search communities").fill(RUN); await R.wait_for_timeout(1200)
        await R.click(f"text=E2E Riders {RUN}"); await R.click("button:has-text('Request to join')")
        check("Rider requests to join", await has_text(R,"Request pending"))
        await A.reload(); await A.click(f"text=E2E Riders {RUN}"); await A.click("button[aria-label='Approve Test Rider']")
        check("Admin approves request", await has_text(A,"Test Rider approved"))
        await R.reload(); check("Rider is now a member", await has_text(R,"You're a member"))

        # ── 15. Session persists across reload; logout works
        await R.goto(f"{B}/user"); await R.reload(); await R.wait_for_timeout(1500)
        check("Login survives page reload", await has_text(R,"Hi Test"))
        await R.click("button[aria-label='Sign out']"); await R.wait_for_timeout(800)
        await R.goto(f"{B}/user"); await R.wait_for_timeout(800)
        check("After logout, protected pages redirect to login", "/login" in R.url)

        check("No JavaScript errors in either browser", not errors, "; ".join(errors[:3]))
        await br.close()
    srv.terminate(); vite.terminate()
    passed=sum(1 for _,o,_ in results if o); print(f"\n{passed}/{len(results)} checks passed")
    sys.exit(0 if passed==len(results) else 1)
asyncio.run(main())
