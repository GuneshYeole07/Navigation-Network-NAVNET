import { useEffect, useRef, useState } from "react";
import { BackgroundGeolocation, isNativeApp } from "../native/platform";
import { GpsFilter } from "../utils/gpsFilter";

/**
 * Continuous high-accuracy GPS + Battery Status API (where supported).
 * speed is converted to km/h; null when the device doesn't report it.
 *
 * Every fix goes through the live Kalman filter (utils/gpsFilter.js) first: `position` is
 * the cleaned position (jumps rejected, noise smoothed); the phone's own fix is in
 * `position.raw`. `accuracy` becomes the filter's own uncertainty in metres.
 */
export function useGeolocation(enabled = true) {
  const [position, setRawPosition] = useState(null);
  const filter = useRef(new GpsFilter());
  const setPosition = (raw) => {
    const clean = filter.current.push(raw);
    if (clean) setRawPosition(clean);
  };
  const [error, setError] = useState(null);
  const [battery, setBattery] = useState(null);
  const supported = isNativeApp || (typeof navigator !== "undefined" && "geolocation" in navigator);
  const watchId = useRef(null);

  // Android app: GPS through a foreground service, so it keeps working with the screen locked.
  useEffect(() => {
    if (!enabled) {
      filter.current.reset(); // a new sharing session starts a fresh track
      return undefined;
    }
    // A stopped phone may send no more fixes; let the filter accept a held-back one by itself.
    const t = setInterval(() => {
      const moved = filter.current.tick(Date.now());
      if (moved) setRawPosition(moved);
    }, 3000);
    return () => clearInterval(t);
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !isNativeApp) return undefined;
    let id = null;
    let stopped = false;
    BackgroundGeolocation.addWatcher(
      {
        backgroundTitle: "NavNet is sharing your location",
        backgroundMessage: "Your group can see you on the map. Open NavNet to stop.",
        requestPermissions: true,
        stale: false,
        // 0 = every fix (~1/s). With a distance filter a parked rider sends nothing and looks
        // "lost"; the GPS is on anyway, and sending is throttled separately.
        distanceFilter: 0,
      },
      (loc, err) => {
        if (err) {
          setError(
            err.code === "NOT_AUTHORIZED"
              ? "Location permission denied. Allow location for NavNet in Android settings (choose “Allow all the time” for lock-screen navigation)."
              : "Couldn't get a GPS fix. Move to open sky or check location services.",
          );
          return;
        }
        if (!loc) return;
        setError(null);
        setPosition({
          lat: loc.latitude,
          lng: loc.longitude,
          accuracy: loc.accuracy,
          heading: Number.isFinite(loc.bearing) ? loc.bearing : null,
          speed: Number.isFinite(loc.speed) ? loc.speed * 3.6 : null,
          timestamp: loc.time || Date.now(),
        });
      },
    ).then((watcherId) => {
      if (stopped) BackgroundGeolocation.removeWatcher({ id: watcherId });
      else id = watcherId;
    });
    return () => {
      stopped = true;
      if (id) BackgroundGeolocation.removeWatcher({ id });
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !supported || isNativeApp) return undefined;
    watchId.current = navigator.geolocation.watchPosition(
      (p) => {
        setError(null);
        setPosition({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: p.coords.accuracy,
          heading: Number.isFinite(p.coords.heading) ? p.coords.heading : null,
          speed: Number.isFinite(p.coords.speed) ? p.coords.speed * 3.6 : null,
          timestamp: p.timestamp,
        });
      },
      (e) =>
        setError(
          e.code === 1
            ? "Location permission denied. Enable it in your browser settings to share your position."
            : "Couldn't get a GPS fix. Move to open sky or check location services.",
        ),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId.current);
  }, [enabled, supported]);

  useEffect(() => {
    if (!enabled || !navigator.getBattery) return undefined;
    let bat;
    const update = () => setBattery(Math.round(bat.level * 100));
    navigator.getBattery().then((b) => {
      bat = b;
      update();
      b.addEventListener("levelchange", update);
    });
    return () => bat?.removeEventListener("levelchange", update);
  }, [enabled]);

  return { position, error, battery, supported };
}
