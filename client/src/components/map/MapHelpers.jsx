import { useEffect, useRef } from "react";
import { toLngLat, useMap, useMapEvents } from "./gl";

/** Fit the map to points whenever `fitKey` changes (not on every re-render). */
export function FitBounds({ points, fitKey, padding = [48, 48], maxZoom = 15 }) {
  const map = useMap();
  const last = useRef(null);
  useEffect(() => {
    const pts = (points || []).filter((p) => p && p[0] != null);
    if (!pts.length || last.current === fitKey) return;
    last.current = fitKey;
    map.resize(); // the panel around the map may have just changed size
    const pad = Array.isArray(padding) ? padding[0] : padding;
    if (pts.length === 1) map.easeTo({ center: toLngLat(pts[0]), zoom: Math.min(maxZoom, 14), bearing: 0, pitch: 0, duration: 400 });
    else {
      const lats = pts.map((p) => p[0]);
      const lngs = pts.map((p) => p[1]);
      const b = [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ];
      map.fitBounds(b, { padding: pad, maxZoom, bearing: 0, pitch: 0, duration: 400 });
    }
  }, [map, points, fitKey, padding, maxZoom]);
  return null;
}

/**
 * Follow a moving point (the rider). With `headingUp`, the map turns so the direction of
 * travel points up and tilts into a 3D driving view, like a car navigator.
 */
export function Follow({ point, enabled, headingUp = false, heading = null, onUserMove }) {
  const map = useMap();
  const wasHeadingUp = useRef(false);
  const cb = useRef(onUserMove);
  cb.current = onUserMove;
  // Dragging the map by hand pauses following (tap the follow button to resume).
  useEffect(() => {
    const onDrag = (e) => e.originalEvent && cb.current?.();
    map.on("dragstart", onDrag);
    return () => map.off("dragstart", onDrag);
  }, [map]);
  useEffect(() => {
    if (!enabled || point?.[0] == null) return;
    const opts = { center: toLngLat(point), duration: 600, essential: true };
    if (headingUp) {
      if (heading != null) opts.bearing = heading;
      opts.pitch = 55;
      if (map.getZoom() < 15) opts.zoom = 16;
      // Keep the rider in the lower part of the screen so more road ahead is visible.
      opts.offset = [0, Math.round(map.getContainer().clientHeight * 0.18)];
    } else if (wasHeadingUp.current) {
      opts.bearing = 0;
      opts.pitch = 0;
    }
    wasHeadingUp.current = headingUp;
    map.easeTo(opts);
  }, [map, point?.[0], point?.[1], enabled, headingUp, heading]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

/** Taps on the map itself (not on a pin or popup). */
export function ClickHandler({ onClick }) {
  useMapEvents({
    click: (e) => {
      if (e.originalEvent?.target?.closest?.(".maplibregl-marker, .maplibregl-popup")) return;
      onClick?.([e.lngLat.lat, e.lngLat.lng]);
    },
  });
  return null;
}

/** Panels that resize (bottom sheet, sidebar) need the map to re-measure. */
export function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export function MapApi({ onReady }) {
  const map = useMap();
  useEffect(() => {
    onReady?.(map);
  }, [map, onReady]);
  return null;
}
