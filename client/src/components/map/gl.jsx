/**
 * A thin React layer over MapLibre GL with the same shape the app used with react-leaflet:
 * <GLMap>, <Marker position icon draggable eventHandlers>, <Popup>, <Tooltip>, <Polyline>,
 * useMap(), useMapEvents(). Positions are [lat, lng] everywhere in the app; MapLibre wants
 * [lng, lat], and that conversion lives only in this file.
 */
import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import * as maplibregl from "maplibre-gl";
// MapLibre 6 draws tiles in a separate module worker file and guesses its URL from where the
// library was loaded. Vite pre-bundles / hashes the library, so that guess points nowhere and
// no tile ever renders. Hand it the real file instead (served in dev, emitted as an asset in
// the build, cached by the service worker so the map also works offline).
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

maplibregl.setWorkerUrl(workerUrl);

const MapCtx = createContext(null);
const MarkerCtx = createContext(null);

export const toLngLat = ([lat, lng]) => [lng, lat];
export const useMap = () => useContext(MapCtx)?.map;
export const useStyleVersion = () => useContext(MapCtx)?.styleVersion ?? 0;

const POSITIONS = { topright: "top-right", topleft: "top-left", bottomright: "bottom-right", bottomleft: "bottom-left" };

/** The map itself. `style` may arrive later (resolved async); children render once the map exists. */
export function GLMap({ style, placeholder, center = [18.52, 73.85], zoom = 11, className = "", zoomPosition = "topright", basemapName, children }) {
  const el = useRef(null);
  const [ctx, setCtx] = useState(null);

  useEffect(() => {
    const map = new maplibregl.Map({
      container: el.current,
      style: style || placeholder,
      center: toLngLat(center),
      zoom,
      attributionControl: { compact: true },
      maxPitch: 70,
      fadeDuration: 150,
      cooperativeGestures: false,
    });
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), POSITIONS[zoomPosition] || "top-right");
    map.touchZoomRotate.enableRotation();
    let alive = true;
    map.once("load", () => alive && setCtx({ map, styleVersion: 0 }));
    // Panels, sheets and rotating phones change the map's size without a window resize.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current);
    if (import.meta.env.DEV) window.__nnMap = map; // handy for debugging and the end-to-end tests
    return () => {
      alive = false;
      ro.disconnect();
      map.remove();
    };
    // The map is created once; later style/center changes go through the API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the basemap (theme change, satellite toggle, resolved style). Overlays re-add themselves.
  const applied = useRef(style || placeholder);
  useEffect(() => {
    if (!ctx || !style || applied.current === style) return;
    applied.current = style;
    const { map } = ctx;
    map.once("style.load", () => setCtx((c) => c && { ...c, styleVersion: c.styleVersion + 1 }));
    map.setStyle(style, { diff: false });
  }, [ctx, style]);

  return (
    <div className={`nn-map relative h-full w-full ${className}`} data-basemap={basemapName || "loading"}>
      <div ref={el} className="absolute inset-0" />
      {ctx && <MapCtx.Provider value={ctx}>{children}</MapCtx.Provider>}
    </div>
  );
}

export function useMapEvents(handlers) {
  const map = useMap();
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    if (!map) return undefined;
    const names = Object.keys(ref.current);
    const fns = names.map((n) => [n, (e) => ref.current[n]?.(e)]);
    fns.forEach(([n, fn]) => map.on(n, fn));
    return () => fns.forEach(([n, fn]) => map.off(n, fn));
  }, [map]);
}

// ───────────────────────── Markers ─────────────────────────

function applyIcon(marker, icon) {
  const e = marker.getElement();
  const [w, h] = icon?.iconSize || [24, 24];
  const [ax, ay] = icon?.iconAnchor || [w / 2, h / 2];
  e.style.width = `${w}px`;
  e.style.height = `${h}px`;
  if (e.dataset.cls !== icon?.className) {
    if (e.dataset.cls) e.classList.remove(...e.dataset.cls.split(" "));
    if (icon?.className) e.classList.add(...icon.className.split(" "));
    e.dataset.cls = icon?.className || "";
  }
  if (e.dataset.html !== icon?.html) {
    e.innerHTML = icon?.html || "";
    e.dataset.html = icon?.html || "";
  }
  marker.setOffset([w / 2 - ax, h / 2 - ay]);
}

const popupOffset = (icon) => {
  const [, h] = icon?.iconSize || [24, 24];
  const [, ay] = icon?.iconAnchor || [0, h / 2];
  return icon?.popupAnchor ? -icon.popupAnchor[1] : ay;
};

export function Marker({ position, icon, draggable = false, eventHandlers, zIndexOffset = 0, children }) {
  const map = useMap();
  const [marker, setMarker] = useState(null);
  const handlers = useRef(eventHandlers);
  handlers.current = eventHandlers;

  useEffect(() => {
    const element = document.createElement("div");
    const m = new maplibregl.Marker({ element, anchor: "center", draggable }).setLngLat(toLngLat(position)).addTo(map);
    element.addEventListener("click", (e) => {
      e.stopPropagation(); // don't also count as a tap on the map underneath
      handlers.current?.click?.(e);
    });
    m.on("dragend", () => {
      const { lat, lng } = m.getLngLat();
      handlers.current?.dragend?.({ target: { getLatLng: () => ({ lat, lng }) } });
    });
    setMarker(m);
    return () => m.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  useEffect(() => {
    marker?.setLngLat(toLngLat(position));
  }, [marker, position[0], position[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (marker) applyIcon(marker, icon);
  }, [marker, icon]);
  useEffect(() => {
    marker?.setDraggable(draggable);
  }, [marker, draggable]);
  useEffect(() => {
    if (marker) marker.getElement().style.zIndex = String(zIndexOffset || "");
  }, [marker, zIndexOffset]);

  const value = useMemo(() => marker && { marker, icon }, [marker, icon]);
  return value ? <MarkerCtx.Provider value={value}>{children}</MarkerCtx.Provider> : null;
}

/** A popup: inside a <Marker> it opens on tap; with `position` it is shown at that spot. */
export function Popup({ position, children, eventHandlers, className = "" }) {
  const map = useMap();
  const mk = useContext(MarkerCtx);
  const [container] = useState(() => document.createElement("div"));
  const handlers = useRef(eventHandlers);
  handlers.current = eventHandlers;
  const popup = useRef(null);
  const offset = mk ? popupOffset(mk.icon) : 8;

  useEffect(() => {
    const p = new maplibregl.Popup({ offset, maxWidth: "300px", className: ["nn-popup", className].filter(Boolean).join(" "), closeOnClick: !!mk, focusAfterOpen: false }).setDOMContent(container);
    popup.current = p;
    const onClose = () => handlers.current?.remove?.();
    if (mk) mk.marker.setPopup(p);
    else {
      p.setLngLat(toLngLat(position)).addTo(map);
      p.on("close", onClose);
    }
    return () => {
      p.off("close", onClose); // unmounting isn't the user closing it
      if (mk) mk.marker.setPopup(null);
      p.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mk?.marker]);

  useEffect(() => {
    if (!mk && position) popup.current?.setLngLat(toLngLat(position));
  }, [mk, position?.[0], position?.[1]]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(children, container);
}

/** Hover / long-press label on a marker. */
export function Tooltip({ children }) {
  const map = useMap();
  const mk = useContext(MarkerCtx);
  const [container] = useState(() => document.createElement("div"));
  useEffect(() => {
    if (!mk) return undefined;
    const p = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: "nn-tooltip", offset: popupOffset(mk.icon) }).setDOMContent(container);
    const el = mk.marker.getElement();
    const show = () => p.setLngLat(mk.marker.getLngLat()).addTo(map);
    const hide = () => p.remove();
    el.addEventListener("mouseenter", show);
    el.addEventListener("mouseleave", hide);
    return () => {
      el.removeEventListener("mouseenter", show);
      el.removeEventListener("mouseleave", hide);
      p.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, mk?.marker]);
  return createPortal(children, container);
}

// ───────────────────────── Lines ─────────────────────────

function firstSymbolLayer(map) {
  return map.getStyle()?.layers?.find((l) => l.type === "symbol")?.id;
}

/** A route line. Drawn under the basemap's labels so place names stay readable. */
export function Polyline({ positions, pathOptions = {} }) {
  const map = useMap();
  const styleVersion = useStyleVersion();
  const id = `nn-line-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const data = useMemo(() => ({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: (positions || []).map(toLngLat) } }), [positions]);
  const { color = "#2E9672", weight = 4, opacity = 1, dashArray } = pathOptions;

  useEffect(() => {
    try {
      if (!map.getSource(id)) map.addSource(id, { type: "geojson", data });
      if (!map.getLayer(id)) {
        const dash = dashArray ? String(dashArray).split(/[ ,]+/).map((n) => Number(n) / weight) : undefined;
        map.addLayer(
          {
            id,
            type: "line",
            source: id,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": color, "line-width": weight, "line-opacity": opacity, ...(dash ? { "line-dasharray": dash } : {}) },
          },
          firstSymbolLayer(map),
        );
      }
    } catch {
      /* style still loading; the next styleVersion re-runs this */
    }
    return () => {
      try {
        if (map.getLayer(id)) map.removeLayer(id);
        if (map.getSource(id)) map.removeSource(id);
      } catch {
        /* map already removed */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, styleVersion, color, weight, opacity, dashArray]);

  useEffect(() => {
    map.getSource(id)?.setData(data);
  }, [map, id, data, styleVersion]);

  return null;
}
