/**
 * Live GPS filter, run on the rider's phone before a position is shown or sent.
 *
 * Same algorithm as the Python analytics (analytics/app/gps.py, forward pass):
 * a constant-velocity Kalman filter in metres that weights every fix by the phone's
 * reported accuracy and uses the phone's speed + heading when available.
 *
 * A fix far from the prediction (chi-square gate) is held back for one fix: a glitch is
 * followed by a normal fix and gets dropped; a real U-turn / sharp bend / tunnel exit is
 * followed by a second surprising fix that agrees with it, and the filter restarts there.
 * It never ignores the phone for more than 4 fixes, and never coasts more than 5 s.
 *
 * Simulated rides (analytics/scripts/gps_benchmark.py): error (RMSE) ~46 m → ~12 m with
 * 3% multipath jumps; sharp turns + a U-turn at 90 km/h: 44 m → 13 m, worst 48 m.
 */

const R_EARTH = 6371008.8;
const DEG = Math.PI / 180;

export const MAX_ACCURACY_M = 100;
const DEFAULT_ACCURACY_M = 15;
const ACCEL_SIGMA = 1.5; // m/s²
const SPEED_SIGMA = 1.2; // m/s
const HEADING_SIGMA_DEG = 12;
const GATE_CHI2 = 13.82; // 2 dof, 99.9%
const WARMUP_FIXES = 1; // the 2nd fix of a ride isn't gated (the 1st one may be the bad one)
const MAX_SPEED_MS = 55; // ~200 km/h
const MAX_REJECTED = 4;
const COAST_S = 5;
const HOLD_TIMEOUT_S = 8; // a held-back fix nobody contradicts within this long is accepted

// ── tiny 4x4 / 2x2 matrix helpers (plain arrays, row-major) ──
const mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
const T = (A) => A[0].map((_, j) => A.map((r) => r[j]));
const add = (A, B) => A.map((r, i) => r.map((v, j) => v + B[i][j]));
const sub = (A, B) => A.map((r, i) => r.map((v, j) => v - B[i][j]));
const eye4 = () => [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
const inv2 = ([[a, b], [c, d]]) => {
  const det = a * d - b * c;
  return [
    [d / det, -b / det],
    [-c / det, a / det],
  ];
};
const mv = (A, v) => A.map((r) => r.reduce((s, a, k) => s + a * v[k], 0));

function haversine(lat1, lng1, lat2, lng2) {
  const a = Math.sin(((lat2 - lat1) * DEG) / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(((lng2 - lng1) * DEG) / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.sqrt(Math.min(1, a)));
}

export class GpsFilter {
  constructor() {
    this.reset();
  }

  reset() {
    this.x = null; // [x, y, vx, vy] metres / m/s in a local frame
    this.P = null;
    this.t = null;
    this.frame = null;
    this.rejected = [];
    this.sinceReset = 0;
    this.lastUsed = null;
  }

  /** Slowest speed that explains moving from fix b to fix a, m/s (accuracy allowed for). */
  static implied(a, b) {
    const dt = a.t - b.t;
    if (dt <= 0) return Infinity;
    return Math.max(0, haversine(a.lat, a.lng, b.lat, b.lng) - 2 * (Math.max(a.acc, 3) + Math.max(b.acc, 3))) / dt;
  }

  /** Fastest believable speed between two fixes; the phone's Doppler speed is trusted when known. */
  static limit(a, b) {
    const known = [a.spd, b.spd].filter(Number.isFinite);
    return known.length ? Math.min(MAX_SPEED_MS, 1.5 * Math.max(...known) + 10) : MAX_SPEED_MS;
  }

  toXY(lat, lng) {
    const k = DEG * R_EARTH;
    return [(lng - this.frame.lng0) * Math.cos(this.frame.lat0 * DEG) * k, (lat - this.frame.lat0) * k];
  }

  toLatLng(x, y) {
    const k = DEG * R_EARTH;
    return [this.frame.lat0 + y / k, this.frame.lng0 + x / (Math.cos(this.frame.lat0 * DEG) * k)];
  }

  start(fix, xy, acc, v) {
    const vAbs = Math.hypot(v[0], v[1]);
    if (vAbs > MAX_SPEED_MS) v = [(v[0] * MAX_SPEED_MS) / vAbs, (v[1] * MAX_SPEED_MS) / vAbs];
    this.x = [xy[0], xy[1], v[0], v[1]];
    const p0 = Math.max(acc, 30) ** 2;
    this.P = [
      [p0, 0, 0, 0],
      [0, p0, 0, 0],
      [0, 0, 100, 0],
      [0, 0, 0, 100],
    ];
    this.t = fix.t;
    this.sinceReset = 0;
    this.rejected = [];
  }

  output(used, raw) {
    const [lat, lng] = this.toLatLng(this.x[0], this.x[1]);
    const v = Math.hypot(this.x[2], this.x[3]);
    // Until the filter has a few fixes, its velocity is a guess: report the phone's own.
    const warm = this.sinceReset >= 2;
    const heading = warm && v > 0.6 ? (Math.atan2(this.x[2], this.x[3]) / DEG + 360) % 360 : (raw.heading ?? null);
    return {
      lat,
      lng,
      speed: warm ? v * 3.6 : (raw.speed ?? null),
      heading,
      accuracy: Math.sqrt((this.P[0][0] + this.P[1][1]) / 2), // the filter's own 1-sigma, metres
      timestamp: raw.timestamp,
      used,
      raw,
    };
  }

  /**
   * @param fix { lat, lng, accuracy (m), speed (km/h), heading (deg), timestamp (ms) }
   * @returns filtered position (same shape) with `used` = false when the fix was rejected,
   *          or null when nothing can be said yet.
   */
  push(fix) {
    const raw = fix;
    const acc = Number.isFinite(fix.accuracy) ? fix.accuracy : DEFAULT_ACCURACY_M;
    const t = (fix.timestamp ?? Date.now()) / 1000;
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lng)) return this.x ? this.output(false, raw) : null;
    if (acc > MAX_ACCURACY_M) return this.x ? this.predictOnly(t, raw) : null;

    const spd = Number.isFinite(fix.speed) ? fix.speed / 3.6 : NaN;
    const hdg = Number.isFinite(fix.heading) ? fix.heading : NaN;
    const vel = Number.isFinite(spd) && Number.isFinite(hdg) ? [spd * Math.sin(hdg * DEG), spd * Math.cos(hdg * DEG)] : [0, 0];

    const me = { lat: fix.lat, lng: fix.lng, t, acc, spd };
    // A fix claiming 0 m accuracy comes from an emulator or survey-grade receiver: trust it.
    if (!this.x || fix.accuracy === 0) {
      this.frame = { lat0: fix.lat, lng0: fix.lng };
      this.start({ t }, this.toXY(fix.lat, fix.lng), acc, vel);
      this.lastUsed = me;
      return this.output(true, raw);
    }
    if (this.rejected.length && t - this.rejected[this.rejected.length - 1].t > HOLD_TIMEOUT_S && this.heldIsBelievable()) this.confirmHeld();
    // Far from the frame origin the flat-earth maths degrades: re-centre (state is kept).
    const [lat0, lng0] = this.toLatLng(this.x[0], this.x[1]);
    if (haversine(lat0, lng0, this.frame.lat0, this.frame.lng0) > 20000) {
      this.frame = { lat0, lng0 };
      this.x = [0, 0, this.x[2], this.x[3]];
    }

    if (t <= this.t) return this.output(false, raw); // same moment again / older: nothing new
    const dt = t - this.t;
    const F = [
      [1, 0, dt, 0],
      [0, 1, 0, dt],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    const q = ACCEL_SIGMA ** 2;
    const [d2, d3, d4] = [dt * dt, dt ** 3, dt ** 4];
    const Q = [
      [(q * d4) / 4, 0, (q * d3) / 2, 0],
      [0, (q * d4) / 4, 0, (q * d3) / 2],
      [(q * d3) / 2, 0, q * d2, 0],
      [0, (q * d3) / 2, 0, q * d2],
    ];
    const xPred = mv(F, this.x);
    const PPred = add(mul(mul(F, this.P), T(F)), Q);

    const xy = this.toXY(fix.lat, fix.lng);
    const r = Math.max(acc, 3) ** 2;
    const innov = [xy[0] - xPred[0], xy[1] - xPred[1]];
    const S = [
      [PPred[0][0] + r, PPred[0][1]],
      [PPred[1][0], PPred[1][1] + r],
    ];
    const Si = inv2(S);
    const dist2 = innov[0] * (Si[0][0] * innov[0] + Si[0][1] * innov[1]) + innov[1] * (Si[1][0] * innov[0] + Si[1][1] * innov[1]);

    this.sinceReset += 1;
    // Faster than the rider could possibly have gone since the last good fix: always suspicious.
    const impossible = GpsFilter.implied(me, this.lastUsed) > GpsFilter.limit(me, this.lastUsed);
    if ((dist2 > GATE_CHI2 && this.sinceReset > WARMUP_FIXES) || impossible) {
      // Surprising fix: hold it for one fix. If the next one agrees (the rider could have driven
      // last good fix → held fix → this fix), it was a real manoeuvre: restart here.
      // The phone's own Doppler velocity says it turned / braked hard, and the fix is where that
      // turn would put the rider: a real manoeuvre, follow it right away (no one-fix lag).
      if (Number.isFinite(spd) && Number.isFinite(hdg) && spd > 3) {
        const vp = [xPred[2], xPred[3]];
        const turned = Math.hypot(vel[0] - vp[0], vel[1] - vp[1]) > Math.max(5, 0.35 * Math.hypot(...vp));
        // Somewhere between "kept the old velocity" and "had the new one all along".
        const a = [this.x[0] + this.x[2] * dt, this.x[1] + this.x[3] * dt];
        const ab = [(vel[0] - this.x[2]) * dt, (vel[1] - this.x[3]) * dt];
        const ab2 = ab[0] * ab[0] + ab[1] * ab[1];
        const u = ab2 ? Math.min(1, Math.max(0, ((xy[0] - a[0]) * ab[0] + (xy[1] - a[1]) * ab[1]) / ab2)) : 0;
        const miss = Math.hypot(xy[0] - (a[0] + u * ab[0]), xy[1] - (a[1] + u * ab[1]));
        if (turned && miss <= 3 * Math.max(acc, 3) + 0.1 * spd * dt + 10) {
          this.frame = { lat0: fix.lat, lng0: fix.lng };
          this.start({ t }, [0, 0], acc, vel);
          this.sinceReset = WARMUP_FIXES;
          this.lastUsed = me;
          return this.output(true, raw);
        }
      }
      const prev = this.rejected[this.rejected.length - 1];
      const agrees =
        prev &&
        GpsFilter.implied(prev, this.lastUsed) <= GpsFilter.limit(prev, this.lastUsed) &&
        GpsFilter.implied(me, prev) <= GpsFilter.limit(me, prev);
      if (agrees || this.rejected.length + 1 > MAX_REJECTED) {
        let v0 = vel;
        if (!(Number.isFinite(spd) && Number.isFinite(hdg)) && prev && t - prev.t >= 1) {
          this.frame = { lat0: fix.lat, lng0: fix.lng };
          const p = this.toXY(prev.lat, prev.lng); // fix itself is (0, 0) in the new frame
          v0 = [-p[0] / (t - prev.t), -p[1] / (t - prev.t)];
        }
        this.frame = { lat0: fix.lat, lng0: fix.lng };
        this.start({ t }, [0, 0], acc, v0);
        this.sinceReset = WARMUP_FIXES; // position + velocity known: keep filtering glitches
        this.lastUsed = me;
        return this.output(true, raw);
      }
      this.rejected.push({ ...me, hdg, raw });
      // Held back: report where the rider should be now, without trusting this fix.
      return this.outputPredicted(xPred, PPred, t, raw);
    }
    this.rejected = [];
    this.lastUsed = me;

    // Position update. H = [I 0]; K = P Hᵀ S⁻¹ = P[:, :2] S⁻¹
    const PH = PPred.map((row) => [row[0], row[1]]);
    const K = mul(PH, Si);
    let x = xPred.map((v, i) => v + K[i][0] * innov[0] + K[i][1] * innov[1]);
    let P = sub(PPred, mul(K, [PPred[0], PPred[1]]));

    // Velocity update from the phone's Doppler speed + heading.
    if (Number.isFinite(spd)) {
      const z = spd > 0.28 && Number.isFinite(hdg) ? vel : spd <= 0.28 ? [0, 0] : null;
      if (z) {
        const side = spd * HEADING_SIGMA_DEG * DEG;
        const rv = spd <= 0.28 ? SPEED_SIGMA ** 2 : SPEED_SIGMA ** 2 + side ** 2;
        const Sv = [
          [P[2][2] + rv, P[2][3]],
          [P[3][2], P[3][3] + rv],
        ];
        const Kv = mul(
          P.map((row) => [row[2], row[3]]),
          inv2(Sv),
        );
        const iv = [z[0] - x[2], z[1] - x[3]];
        x = x.map((v, i) => v + Kv[i][0] * iv[0] + Kv[i][1] * iv[1]);
        P = sub(P, mul(Kv, [P[2], P[3]]));
      }
    }
    const vAbs = Math.hypot(x[2], x[3]);
    if (vAbs > MAX_SPEED_MS) x = [x[0], x[1], (x[2] * MAX_SPEED_MS) / vAbs, (x[3] * MAX_SPEED_MS) / vAbs]; // physically impossible: cap
    this.x = x;
    this.P = P;
    this.t = t;
    return this.output(true, raw);
  }

  /**
   * Call every few seconds. A rider who turned into a car park and stopped sends no more
   * fixes, so the held-back one is never confirmed: accept it once nothing contradicted it.
   * Returns the new position, or null if nothing changed.
   */
  tick(nowMs = Date.now()) {
    const held = this.rejected[this.rejected.length - 1];
    if (!held || nowMs / 1000 - held.t <= HOLD_TIMEOUT_S || !this.heldIsBelievable()) return null;
    this.confirmHeld();
    return this.output(true, held.raw);
  }

  /**
   * Silence alone doesn't prove a held fix right: a GPS jump followed by a gap in fixes looks
   * the same. Accept it only if the rider could have got there at about the speed they were doing.
   */
  heldIsBelievable() {
    const held = this.rejected[this.rejected.length - 1];
    if (!held || !this.lastUsed) return false;
    const v = Math.hypot(this.x[2], this.x[3]);
    return GpsFilter.implied(held, this.lastUsed) <= Math.min(GpsFilter.limit(held, this.lastUsed), 1.5 * v + 5);
  }

  confirmHeld() {
    const held = this.rejected[this.rejected.length - 1];
    const prev = this.rejected[this.rejected.length - 2];
    let v = [0, 0];
    if (Number.isFinite(held.spd) && Number.isFinite(held.hdg)) v = [held.spd * Math.sin(held.hdg * DEG), held.spd * Math.cos(held.hdg * DEG)];
    this.frame = { lat0: held.lat, lng0: held.lng };
    if (!(Number.isFinite(held.spd) && Number.isFinite(held.hdg)) && prev && held.t - prev.t >= 1) {
      const p = this.toXY(prev.lat, prev.lng);
      v = [-p[0] / (held.t - prev.t), -p[1] / (held.t - prev.t)];
    }
    this.start({ t: held.t }, [0, 0], held.acc, v);
    this.sinceReset = WARMUP_FIXES;
    this.lastUsed = held;
  }

  predictOnly(t, raw) {
    const dt = Math.min(COAST_S, Math.max(0, t - this.t));
    return this.outputPredicted([this.x[0] + this.x[2] * dt, this.x[1] + this.x[3] * dt, this.x[2], this.x[3]], this.P, t, raw);
  }

  outputPredicted(x, P, t, raw) {
    // Never carry a rider forward on old velocity for long: beyond a few seconds it's a guess.
    const over = t - this.t - COAST_S;
    if (over > 0) x = [x[0] - x[2] * over, x[1] - x[3] * over, x[2], x[3]];
    const saved = [this.x, this.P];
    this.x = x;
    this.P = P;
    const o = this.output(false, raw);
    [this.x, this.P] = saved;
    return o;
  }
}
