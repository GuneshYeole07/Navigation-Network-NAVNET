import { useEffect, useState } from "react";
import { Layers, Map as MapIcon } from "lucide-react";
import { GLMap } from "./gl";
import { placeholderStyle, registerCacheProtocol, resolveBasemap } from "./mapStyles";
import { useTheme } from "../../context/ThemeContext";

registerCacheProtocol();

const MODE_KEY = "navnet-basemap";
const readMode = () => {
  try {
    return localStorage.getItem(MODE_KEY) === "satellite" ? "satellite" : "map";
  } catch {
    return "map";
  }
};

/** Resolves the best available basemap for the current theme / layer choice. */
export function useBasemap(satellite) {
  const dark = useTheme()?.theme === "dark";
  const [state, setState] = useState(null);
  useEffect(() => {
    let alive = true;
    resolveBasemap({ dark, satellite }).then((b) => alive && setState(b));
    return () => {
      alive = false;
    };
  }, [dark, satellite]);
  return { basemap: state, dark };
}

/** Map vs satellite, remembered on this device. */
export function useBasemapMode() {
  const [mode, setMode] = useState(readMode);
  const toggle = () => {
    const next = mode === "satellite" ? "map" : "satellite";
    setMode(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      /* private mode */
    }
  };
  return [mode, toggle];
}

/**
 * Vector map (OpenFreeMap / self-hosted Protomaps), sharp at any zoom, real dark style,
 * rotate + tilt. Falls back to OpenStreetMap raster tiles if neither is reachable.
 */
export default function BaseMap({ center = [18.52, 73.85], zoom = 11, children, className = "", zoomPosition = "topright", layerToggle = true, mode: controlledMode }) {
  const [ownMode, toggle] = useBasemapMode();
  const mode = controlledMode || ownMode;
  const { basemap, dark } = useBasemap(mode === "satellite");
  return (
    <GLMap style={basemap?.style} basemapName={basemap?.name} placeholder={placeholderStyle(dark)} center={center} zoom={zoom} className={className} zoomPosition={zoomPosition}>
      {children}
      {layerToggle && (
        <button
          type="button"
          onClick={toggle}
          className={`nn-layer-toggle absolute z-[2] grid h-10 w-10 place-items-center rounded-control bg-white/95 text-asphalt shadow-float ring-1 ring-road-line hover:bg-white dark:bg-asphalt-700/95 dark:text-road dark:ring-asphalt-500 ${zoomPosition.startsWith("bottom") ? "bottom-[132px] right-2.5" : "right-2.5 top-[112px]"} max-lg:top-2.5 max-lg:bottom-auto`}
          aria-label={mode === "satellite" ? "Show map" : "Show satellite view"}
          title={mode === "satellite" ? "Map view" : "Satellite view (needs internet)"}
        >
          {mode === "satellite" ? <MapIcon size={18} /> : <Layers size={18} />}
        </button>
      )}
    </GLMap>
  );
}
