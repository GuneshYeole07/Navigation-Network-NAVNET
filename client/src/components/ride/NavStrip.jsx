import { ArrowUp, ArrowUpLeft, ArrowUpRight, ChevronLeft, CloudOff, CloudUpload, CornerUpLeft, CornerUpRight, Flag, Route } from "lucide-react";
import { Link } from "react-router-dom";
import { turnText } from "../../utils/geo";
import { formatClock, formatDistance } from "../../utils/format";
import { CHECKPOINT_CATEGORIES } from "../../utils/constants";

const TURN_ICON = {
  slight: { left: ArrowUpLeft, right: ArrowUpRight },
  turn: { left: CornerUpLeft, right: CornerUpRight },
  sharp: { left: CornerUpLeft, right: CornerUpRight },
};

/**
 * Glanceable top strip for riding: the next manoeuvre in big type, km to go and ETA.
 * Everything here comes from on-device navigation, so it keeps working offline.
 */
export default function NavStrip({ nav, trip, offline, savedAt, sharing, backTo = "/user", smartEta = null, unsent = 0, synced = null }) {
  let Icon = ArrowUp;
  let headline = "Follow the route";
  let sub = null;
  let tone = "bg-nh text-white";

  if (!sharing) {
    Icon = Route;
    headline = "Location sharing is off";
    sub = "Turn it on to navigate";
    tone = "bg-asphalt text-white";
  } else if (!nav) {
    Icon = Route;
    headline = "Waiting for GPS…";
    sub = "Allow location and stay under open sky";
    tone = "bg-asphalt text-white";
  } else if (nav.arrived) {
    Icon = Flag;
    headline = "You've arrived";
    sub = trip.destination.name.split(",")[0];
  } else if (nav.offRoute) {
    Icon = Route;
    headline = `Off route by ${formatDistance(nav.offRouteBy)}`;
    sub = "Head back to the green line";
    tone = "bg-signal text-white";
  } else if (nav.nextTurn && nav.nextTurn.distance < 3000) {
    Icon = TURN_ICON[nav.nextTurn.type][nav.nextTurn.side];
    headline = `${turnText(nav.nextTurn)} in ${formatDistance(Math.round(nav.nextTurn.distance / 10) * 10)}`;
    if (nav.nextCheckpoint) sub = `Then ${nav.nextCheckpoint.name} in ${formatDistance(nav.nextCheckpoint.distance)}`;
  } else if (nav.nextCheckpoint) {
    headline = `${formatDistance(nav.nextCheckpoint.distance)} to ${nav.nextCheckpoint.name}`;
    sub = `${CHECKPOINT_CATEGORIES[nav.nextCheckpoint.category]?.label ?? "Checkpoint"}${nav.nextTurn ? ` · next turn in ${formatDistance(nav.nextTurn.distance)}` : ""}`;
  } else {
    headline = `Continue to ${trip.destination.name.split(",")[0]}`;
  }

  return (
    <div className="overflow-hidden rounded-control shadow-float" role="status" aria-live="polite">
      <div className={`flex items-center gap-3 p-3 ${tone}`}>
        <Link to={backTo} className="-ml-1 rounded-control p-1 hover:bg-white/10" aria-label="Back">
          <ChevronLeft size={22} />
        </Link>
        <Icon size={34} strokeWidth={2.5} aria-hidden="true" className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-2xl font-bold leading-tight">{headline}</p>
          {sub && <p className="truncate text-sm opacity-85">{sub}</p>}
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 bg-white px-3 py-2 text-asphalt dark:bg-asphalt-700 dark:text-road">
        <span className="font-display text-xl font-bold leading-none">
          {nav ? formatDistance(nav.remaining) : formatDistance(trip.routeDistance)}
          <span className="ml-1 font-sans text-xs font-medium muted">to go</span>
        </span>
        {offline && (
          <span className="chip bg-stone-cap/25 text-stone-capdark" title={savedAt ? `Trip saved ${formatClock(savedAt)}` : undefined}>
            <CloudOff size={12} /> {unsent ? `No signal · ${unsent} saved` : "Offline"}
          </span>
        )}
        {!offline && synced != null && (
          <span className="chip bg-nh/15 text-nh" title="Positions recorded with no signal were uploaded; your track has no gap">
            <CloudUpload size={12} /> {synced} uploaded
          </span>
        )}
        <span
          className="font-display text-xl font-bold leading-none"
          title={smartEta && !nav?.arrived ? `Learned from past rides (usually within ±${Math.round(smartEta.typical_error_minutes || 0)} min). Plain estimate: ${nav ? formatClock(nav.eta) : "—"}` : undefined}
        >
          {nav?.arrived ? "Here" : smartEta ? formatClock(new Date(smartEta.arrival_at)) : nav ? formatClock(nav.eta) : formatClock(trip.expectedArrival)}
          <span className="ml-1 font-sans text-xs font-medium muted">{smartEta && !nav?.arrived ? "smart ETA" : "ETA"}</span>
        </span>
      </div>
    </div>
  );
}
