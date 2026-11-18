"""
NavNet — a real group ride, end to end, on three phones.

  Captain (organiser riding along) · Aarav · Diya
  Pune, 3 km east then a left turn and 3 km north.

Walks through the day the way a ride captain lives it: invite, emergency card,
checklist, roll call at the start, ready check, start, someone falls behind,
push-to-talk, a stop request, a group stop with headcount + departure countdown,
nearby fuel, an SOS where the nearest friend is guided to help, battery saver,
shared expenses and the ride card at the end.

Setup:  pip install playwright && python -m playwright install chromium
Run:    stop `npm run dev` first, then:  python e2e/group_ride.py
"""
import asyncio, json, os, re, shutil, subprocess, sys, threading, time, urllib.request, base64, math
import stub_maps
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parent.parent
B = "http://localhost:5173"
API = "http://localhost:5000/api"
RUN = str(int(time.time()))[-6:]
LOG = open(ROOT / "e2e" / "server.log", "a")
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)

def api(path, token=None, method=None, body=None):
    req = urllib.request.Request(API + path, method=method or ("POST" if body is not None else "GET"),
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    return json.loads(urllib.request.urlopen(req).read())["data"]

def env_value(key, default=""):
    try:
        for line in open(ROOT / "server" / ".env"):
            if line.startswith(key + "="):
                return line.split("=", 1)[1].strip()
    except FileNotFoundError:
        pass
    return default

# ── Route: L-shape with a real left turn ─────────────────────────────────────
A0 = (18.5204, 73.8567)
CORNER = (18.5204, 73.8851)   # ~3 km east
END = (18.5474, 73.8851)      # ~3 km north
def lerp(a, b, t): return (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)
LINE = [lerp(A0, CORNER, i / 40) for i in range(40)] + [lerp(CORNER, END, i / 40) for i in range(41)]
def hav(a, b):
    R = 6371000; la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))
CUM = [0]
for i in range(1, len(LINE)): CUM.append(CUM[-1] + hav(LINE[i - 1], LINE[i]))
TOTAL = CUM[-1]
def at(m):
    m = max(0, min(TOTAL, m))
    for i in range(1, len(CUM)):
        if CUM[i] >= m:
            t = (m - CUM[i - 1]) / ((CUM[i] - CUM[i - 1]) or 1)
            return lerp(LINE[i - 1], LINE[i], t)
    return LINE[-1]

# ── Stand-ins for OpenStreetMap tiles + Overpass (no internet needed) ─────────
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
FUEL = at(4200)
class Stub(BaseHTTPRequestHandler):
    def _send(self, body, ctype):
        self.send_response(200); self.send_header("Content-Type", ctype); self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        m = stub_maps.handle(self.path, f"http://localhost:{STUB}")
        self._send(*(m or (PNG, "image/png")))
    def do_POST(self):
        self.rfile.read(int(self.headers.get("Content-Length", 0)))
        self._send(json.dumps({"elements": [
            {"type": "node", "id": 1, "lat": FUEL[0] + 0.0008, "lon": FUEL[1], "tags": {"amenity": "fuel", "name": "Bharat Petroleum", "opening_hours": "24/7"}},
            {"type": "node", "id": 2, "lat": at(1500)[0] - 0.01, "lon": at(1500)[1], "tags": {"amenity": "hospital", "name": "Sassoon Hospital", "phone": "+91 20 2612 8000"}},
        ]}).encode(), "application/json")
    def log_message(self, *a): pass
STUB = 8099

def start_server():
    env = {**os.environ, "SWEEP_INTERVAL_SECONDS": "3", "OVERPASS_URL": f"http://127.0.0.1:{STUB}/overpass"}
    return subprocess.Popen(["node", "src/server.js"], cwd=ROOT / "server", env=env, stdout=LOG, stderr=LOG)
def start_vite():
    env = {**os.environ, "VITE_TILE_URL": f"http://localhost:{STUB}/{{z}}/{{x}}/{{y}}.png", "VITE_MAP_STYLE_URL": f"http://localhost:{STUB}/style.json"}
    return subprocess.Popen([shutil.which("npx") or "npx", "vite", "--port", "5173", "--strictPort"], cwd=ROOT / "client", env=env, stdout=LOG, stderr=LOG)

SHOTS = os.environ.get("SHOTS")  # set SHOTS=folder to save screenshots of each moment
async def snap(page, name):
    if SHOTS:
        os.makedirs(SHOTS, exist_ok=True); await page.screenshot(path=os.path.join(SHOTS, f"{name}.png"))

async def seen(page, text, timeout=10000):
    try:
        await page.get_by_text(text).first.wait_for(timeout=timeout); return True
    except Exception:
        return False

async def main():
    stub = ThreadingHTTPServer(("127.0.0.1", STUB), Stub); threading.Thread(target=stub.serve_forever, daemon=True).start()
    srv = start_server(); vite = start_vite(); time.sleep(6)
    code = env_value("ADMIN_SIGNUP_CODE", "NAVNET-ADMIN-2026")
    cap = api("/auth/register", body={"name": "Gunesh Captain", "email": f"cap{RUN}@ride.dev", "password": "Ride2026x", "role": "ADMIN", "adminCode": code, "phone": "98765 43210"})
    from datetime import datetime, timedelta, timezone
    dep = datetime.now(timezone.utc) + timedelta(hours=1)
    trip = api("/trips", cap["token"], body={
        "name": "Sunday Breakfast Ride", "description": "Real-life group ride test",
        "start": {"name": "Shaniwar Wada", "lat": A0[0], "lng": A0[1]}, "destination": {"name": "Aga Khan Palace", "lat": END[0], "lng": END[1]},
        "waypoints": [], "checkpoints": [{"name": "Chai stop", "category": "BREAKFAST", "lat": at(4800)[0], "lng": at(4800)[1]}],
        "route": {"geometry": [list(p) for p in LINE], "distance": TOTAL, "duration": TOTAL / 11, "provider": "test"},
        "groupCode": f"SUN-{RUN}", "groupPassword": "chai123", "maxMembers": 10, "vehicleType": "BIKE",
        "speedLimitKmh": 70, "gapAlertMeters": 600,
        "departureTime": dep.isoformat(), "expectedArrival": (dep + timedelta(hours=1)).isoformat()})
    tid = trip["id"]
    invite = api(f"/trips/{tid}/invite", cap["token"], "POST")["token"]

    async with async_playwright() as p:
        br = await p.chromium.launch(args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"],
                                     **({"executable_path": os.environ["CHROME_PATH"]} if os.environ.get("CHROME_PATH") else {}))
        errors = []
        async def phone(name, start_m, battery=None):
            ctx = await br.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True,
                                       permissions=["geolocation", "microphone"], geolocation={"latitude": at(start_m)[0], "longitude": at(start_m)[1], "accuracy": 8})
            if battery is not None:
                await ctx.add_init_script(f"navigator.getBattery = () => Promise.resolve({{level: {battery}, charging: false, addEventListener(){{}}, removeEventListener(){{}}}});")
            pg = await ctx.new_page(); pg.on("pageerror", lambda e: errors.append(f"{name}: {e}"))
            return ctx, pg
        # The riders jump around the route as the story needs (back and forth, km in seconds),
        # which a real GPS can't do. Accuracy 0 marks these as simulated fixes, which the GPS
        # filter trusts as-is; the filter itself is exercised in run_e2e.py with accuracy 8.
        async def goto(ctx, m):
            la, lo = at(m); await ctx.set_geolocation({"latitude": la, "longitude": lo, "accuracy": 0})

        # ── Captain (admin) rides along ──
        C, cp = await phone("captain", 0)
        await cp.goto(f"{B}/login/admin"); await cp.get_by_label("Email").fill(f"cap{RUN}@ride.dev"); await cp.get_by_label("Password").fill("Ride2026x"); await cp.click("button[type=submit]")
        await cp.wait_for_timeout(1500)
        await cp.goto(f"{B}/admin/monitor"); await cp.wait_for_timeout(1500)
        await cp.locator("button:has-text('Ride')").first.click(); await cp.wait_for_timeout(3000)
        check("Captain opens the phone ride screen with captain tools", "/admin/ride/" in cp.url and await seen(cp, "at start"), cp.url)

        # ── Riders join via the WhatsApp invite link ──
        async def rider(name, email, start_m, battery=None):
            ctx, pg = await phone(name, start_m, battery)
            await pg.goto(f"{B}/user/join?invite={invite}"); await pg.wait_for_timeout(1000)
            await pg.click("text=Create an account"); await pg.get_by_label("Full name").fill(name); await pg.get_by_label("Email").fill(email)
            await pg.get_by_label("Password").fill("Ride2026x"); await pg.click("button[type=submit]"); await pg.wait_for_timeout(3500)
            return ctx, pg
        A, ap = await rider("Aarav", f"aarav{RUN}@ride.dev", 40)
        D, dp = await rider("Diya", f"diya{RUN}@ride.dev", 80, battery=0.18)
        check("Both riders joined from the invite link", "/user/trip/" in ap.url and "/user/trip/" in dp.url)

        # ── Night-before prep: emergency card + checklist ──
        await dp.goto(f"{B}/profile"); await dp.get_by_label("Blood group").select_option("B+")
        await dp.get_by_label("Emergency contact name").fill("Mom"); await dp.get_by_label("Emergency contact phone").fill("91234 56789")
        await dp.locator("text=Emergency card").scroll_into_view_if_needed(); await snap(dp, "00-emergency-card")
        await dp.click("button:has-text('Save profile')"); await dp.wait_for_timeout(1500)
        check("Diya saves her emergency card", "/user/trip/" in dp.url or await seen(dp, "Profile saved", 3000))
        if "/user/trip/" not in dp.url: await dp.goto(f"{B}/user/trip/{tid}"); await dp.wait_for_timeout(2500)
        await ap.click("button[aria-label='Expand panel']"); await ap.wait_for_timeout(500)
        for label in ["Full tank", "Licence, RC, insurance", "Helmet & riding gear", "Tyres & brakes checked", "Phone charged + power bank"]:
            await ap.get_by_role("checkbox", name=label).click(); await ap.wait_for_timeout(150)
        await ap.click("button[aria-label='Collapse panel']"); await ap.wait_for_timeout(1500)
        check("Checklist progress reaches the captain", await seen(cp, "checklist"), "")

        # ── Meeting point: roll call + ready check ──
        for ctx, m in ((C, 10), (A, 60), (D, 120)): await goto(ctx, m)
        await cp.wait_for_timeout(4500)
        check("Roll call: captain sees 3/3 at the start", await seen(cp, "3/3 at start", 8000))
        await snap(cp, "01-captain-roll-call")
        await cp.click("button:has-text('Ready check')")
        check("Riders are asked 'Ready to roll?'", await seen(ap, "Ready to roll?") and await seen(dp, "Ready to roll?"))
        await snap(ap, "02-rider-ready-check")
        await ap.click("button:has-text(\"I'm ready\")"); await dp.click("button:has-text(\"I'm ready\")")
        check("Captain is told everyone's ready", await seen(cp, "All 3 riders are ready"))
        await cp.click("button:has-text('Start ride')")
        check("Ride starts for everyone", await seen(ap, "Trip started") and await seen(dp, "Trip started"))
        check("Diya's low battery turns on battery saver", await seen(dp, "Battery saver on"))

        # ── On the road: Diya falls behind ──
        w_cap = asyncio.create_task(seen(cp, "behind the group", 45000))
        w_diya = asyncio.create_task(seen(dp, "ahead — catch up", 45000))
        for m in (400, 900, 1400, 1900):
            for ctx, mm in ((C, m), (A, m - 80)): await goto(ctx, mm)
            await goto(D, 300); await cp.wait_for_timeout(3300)
        check("Captain warned: Diya fell behind (spoken + shown)", await w_cap)
        check("Diya sees a persistent 'group is ahead — catch up' banner", await w_diya)
        await snap(cp, "03-captain-gap-alert"); await snap(dp, "04-rider-catch-up")
        check("Captain bar shows the group spread", await seen(cp, "Group spread"))
        w_together = asyncio.create_task(seen(cp, "back together", 45000))
        for m in (800, 1300, 1800): await goto(D, m); await dp.wait_for_timeout(3200)
        check("Captain told the group is back together", await w_together)
        check("Diya's catch-up banner clears", not await seen(dp, "ahead — catch up", 1500))

        # ── Push-to-talk ──
        ptt = ap.locator("button[aria-label^='Push to talk']")
        await ptt.hover(); await ap.mouse.down(); await ap.wait_for_timeout(1600); await snap(ap, "05-push-to-talk"); await ap.wait_for_timeout(600); await ap.mouse.up()
        await ap.wait_for_timeout(2500)
        await dp.click("button[aria-label^='Open chat']")
        check("Push-to-talk voice message reaches the group", await dp.locator("audio[aria-label='Voice message from Aarav']").count() == 1)
        await dp.click("button[aria-label='Close chat']")

        # ── Everyone through the left turn ──
        w_turn = asyncio.create_task(seen(cp, "taken the turn", 45000))
        for m in (2600, 3300, 3700):
            for ctx, mm in ((C, m + 100), (A, m), (D, m - 60)): await goto(ctx, mm)
            await cp.wait_for_timeout(3300)
        check("Captain told everyone has taken the turn", await w_turn)

        # ── Diya needs fuel → captain calls a group stop ──
        await dp.click("button[aria-label='Need a stop: tell the captain']"); await dp.click("button:has-text('Fuel')")
        check("Stop request reaches the captain", await seen(cp, "Diya needs fuel"))
        await snap(cp, "06-captain-stop-request")
        await cp.locator("button:has-text('Stop here')").first.click()
        check("Riders get the group stop", await seen(ap, "Group stop") and await seen(dp, "Group stop"))
        check("Riders are guided to the meet point", await seen(dp, "Captain's stop ·"))
        await snap(dp, "07-rider-guided-to-stop")
        for ctx, mm in ((A, 3730), (D, 3760)): await goto(ctx, mm)
        await cp.wait_for_timeout(4500)
        check("Headcount: everyone's at the stop", await seen(cp, "everyone's here", 10000))
        await cp.click("button:has-text('Leave in')"); await cp.click("button:has-text('10 min')")
        check("Departure countdown on riders' phones", await seen(ap, "Leaving in 09:") or await seen(ap, "Leaving in 10:"))
        await snap(cp, "08-captain-headcount-countdown"); await snap(ap, "09-rider-countdown")

        # ── 3D navigation view: the map tilts and turns with the direction of travel ──
        view_btn = ap.locator("button[aria-label='Switch to 3D navigation view'], button[aria-label='Follow my position']").first
        if await ap.locator("button[aria-label='Follow my position']").count(): await view_btn.click()
        await ap.click("button[aria-label='Switch to 3D navigation view']")
        await goto(A, 2850); await ap.wait_for_timeout(1500); await goto(A, 2950); await ap.wait_for_timeout(2500)   # heading east
        cam = await ap.evaluate("({pitch: window.__nnMap.getPitch(), bearing: window.__nnMap.getBearing()})")
        (la1, lo1), (la2, lo2) = at(2850), at(2950)
        road = math.degrees(math.atan2(math.radians(lo2 - lo1) * math.cos(math.radians(la1)), math.radians(la2 - la1))) % 360
        off = abs((cam["bearing"] % 360) - road); off = min(off, 360 - off)
        check("3D navigation view tilts the map and turns it with the road", cam["pitch"] > 40 and off < 20, json.dumps({**{k: round(v) for k, v in cam.items()}, "road": round(road)}))
        await snap(ap, "09b-3d-navigation")
        await ap.click("button[aria-label='Stop following my position']"); await goto(A, 3730); await ap.wait_for_timeout(1500)

        # ── Nearby fuel (OpenStreetMap, saved for offline) ──
        await ap.click("button[aria-label='Nearby fuel, hospital, mechanic']")
        check("Nearby shows the fuel pump ahead", await seen(ap, "Bharat Petroleum"))
        await snap(ap, "10-nearby-fuel")
        await ap.locator("button:has-text('Guide')").first.click()
        check("Guidance to the fuel pump", await seen(ap, "Guiding to: Bharat Petroleum"))
        await cp.click("button:has-text('End stop')")

        # ── SOS: Diya breaks down ~500 m back; Aarav is the closest rider ──
        await goto(D, 3200); await dp.wait_for_timeout(1500)
        await dp.click("button[aria-label='SOS — send emergency alert']"); await dp.click("text=Breakdown"); await dp.click("text=Send SOS now")
        check("Diya's SOS is sent", await seen(dp, "SOS sent"))
        check("Nearest friend (Aarav) is asked to help", await seen(ap, "Diya needs help"))
        await snap(ap, "11-friend-sos-help")
        await ap.click("button:has-text('Guide me to Diya')")
        check("Aarav is guided to Diya", await seen(ap, "Guiding to: Diya (SOS)"))
        await goto(A, 3215); await ap.wait_for_timeout(2500)
        check("Aarav told he has reached Diya", not await seen(ap, "Guiding to: Diya (SOS)", 1500))
        alerts = api(f"/trips/{tid}/alerts", cap["token"])
        sos = next((a for a in alerts if a["type"] == "SOS"), {})
        check("SOS carries Diya's emergency card to the captain", sos.get("data", {}).get("bloodGroup") == "B+" and sos["data"].get("emergencyPhone"), str(sos.get("data", {}).get("bloodGroup")))
        await dp.keyboard.press("Escape")

        # ── Shared costs ──
        await ap.click("button[aria-label='Expand panel']"); await ap.wait_for_timeout(400)
        await ap.click("button:has-text('I paid for something')"); await ap.get_by_label("Amount in rupees").fill("900"); await ap.get_by_label("What was it for").fill("Misal + chai")
        await ap.click("form button:has-text('Add')")
        await dp.click("button[aria-label='Expand panel']")
        check("Expense split: Diya sees what she owes", await seen(dp, "You owe ₹300"))
        await dp.locator("text=Shared costs").scroll_into_view_if_needed(); await snap(dp, "12-expenses")

        # ── Finish: arrive, end, share the ride card ──
        for ctx in (C, A, D): await goto(ctx, TOTAL - 5)
        await cp.wait_for_timeout(17000)  # Diya is on battery saver: updates every 15 s
        api(f"/trips/{tid}/status", cap["token"], "PATCH", {"action": "end"})
        await ap.goto(f"{B}/trips/{tid}/report"); await ap.wait_for_timeout(3000)
        await ap.click("button:has-text('Share ride card')"); await ap.wait_for_timeout(3000)
        check("Ride card image generated", await ap.locator("img[alt='Ride summary card']").count() == 1)
        await ap.locator("img[alt='Ride summary card']").scroll_into_view_if_needed(); await snap(ap, "13-ride-card")
        rep = api(f"/trips/{tid}/report", cap["token"])
        check("Report: all 3 riders arrived", rep["membersArrived"] == 3, f"{rep['membersArrived']}/{rep['membersTotal']}")

        check("No JavaScript errors on any phone", not errors, "; ".join(errors[:3]))
        await br.close()
    srv.terminate(); vite.terminate(); stub.shutdown()
    passed = sum(1 for _, o in results if o)
    print(f"\n{passed}/{len(results)} checks passed")
    sys.exit(0 if passed == len(results) else 1)

asyncio.run(main())
