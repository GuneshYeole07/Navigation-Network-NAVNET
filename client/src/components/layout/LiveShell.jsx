import { useState } from "react";
import { useMediaQuery } from "../../hooks/useMediaQuery";

/**
 * Map-first layout used by the rider dashboard and admin monitor.
 * Desktop: fixed side panel + map. Mobile: full-screen map + bottom sheet
 * (tap the handle to expand/collapse). The panel mounts exactly once either way,
 * so chat subscriptions and REST loads aren't duplicated.
 */
export default function LiveShell({ topBar, mobileTopBar = topBar, panel, map, mapOverlay, floating, floatingLeft, peek = "30vh" }) {
  const [expanded, setExpanded] = useState(false);
  const desktop = useMediaQuery("(min-width: 1024px)");

  if (desktop) {
    return (
      <div className="grid h-full grid-cols-[420px_1fr] overflow-hidden">
        <aside className="flex min-h-0 flex-col border-r border-road-line bg-white dark:border-asphalt-600 dark:bg-asphalt-700">
          {topBar}
          <div className="min-h-0 flex-1 overflow-hidden">{panel}</div>
        </aside>
        <section className="relative h-full">
          {map}
          {mapOverlay && <div className="pointer-events-none absolute inset-x-0 top-3 z-[440] flex flex-col items-center gap-2 px-3">{mapOverlay}</div>}
          {floating && <div className="absolute bottom-6 right-4 z-[460] flex flex-col items-end gap-3">{floating}</div>}
          {floatingLeft && <div className="absolute bottom-6 left-4 z-[460] flex flex-col items-start gap-3">{floatingLeft}</div>}
        </section>
      </div>
    );
  }

  return (
    <div className="relative h-full overflow-hidden">
      <section className="absolute inset-0">{map}</section>
      {mobileTopBar && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[450] p-3">
          <div className="pointer-events-auto glass rounded-control shadow-float">{mobileTopBar}</div>
        </div>
      )}
      {mapOverlay && (
        <div className={`pointer-events-none absolute inset-x-0 z-[440] flex flex-col items-center gap-2 px-3 ${mobileTopBar ? "top-[124px]" : "top-3"}`}>{mapOverlay}</div>
      )}
      {floating && (
        <div className="absolute right-4 z-[460] flex flex-col items-end gap-3 transition-[bottom] duration-300" style={{ bottom: `calc(${expanded ? "72vh" : peek} + 16px)` }}>
          {floating}
        </div>
      )}
      {floatingLeft && (
        <div className="absolute left-4 z-[460] flex flex-col items-start gap-3 transition-[bottom] duration-300" style={{ bottom: `calc(${expanded ? "72vh" : peek} + 16px)` }}>
          {floatingLeft}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 z-[470] flex flex-col rounded-t-sheet bg-white shadow-sheet transition-[height] duration-300 dark:bg-asphalt-700" style={{ height: expanded ? "72vh" : peek }}>
        <button className="flex w-full justify-center py-2.5" onClick={() => setExpanded((e) => !e)} aria-label={expanded ? "Collapse panel" : "Expand panel"} aria-expanded={expanded}>
          <span className="h-1.5 w-12 rounded-full bg-road-line dark:bg-asphalt-500" />
        </button>
        <div className="min-h-0 flex-1 overflow-hidden">{panel}</div>
      </div>
    </div>
  );
}
