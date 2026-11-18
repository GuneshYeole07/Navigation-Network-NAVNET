import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CheckSquare, Square } from "lucide-react";
import { tripService } from "../../services/tripService";
import { CHECKLIST } from "../../utils/constants";
import { offlineInfo } from "../../utils/offlineMap";
import { useAuth } from "../../context/AuthContext";

/** Pre-ride checklist; the captain sees everyone's progress instead of chasing them on WhatsApp. */
export default function Checklist({ tripId, initial, profileLink = "/profile" }) {
  const { user } = useAuth();
  const [items, setItems] = useState(() => initial || {});
  const saveTimer = useRef(null);

  // Things NavNet can tick for you.
  const auto = {
    offlinemap: !!offlineInfo(tripId),
    emergency: !!(user?.bloodGroup && user?.emergencyPhone),
  };
  const merged = { ...items, ...Object.fromEntries(Object.entries(auto).filter(([, v]) => v)) };
  const done = CHECKLIST.filter((c) => merged[c.key]).length;

  useEffect(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => tripService.setChecklist(tripId, merged).catch(() => {}), 600);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(merged), tripId]);

  return (
    <section className="rounded-control bg-road p-3 dark:bg-asphalt-600">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xl">Before you ride</h2>
        <span className={`chip ${done === CHECKLIST.length ? "bg-nh text-white" : "bg-white dark:bg-asphalt-700"}`}>
          {done}/{CHECKLIST.length}
        </span>
      </div>
      <ul className="space-y-1">
        {CHECKLIST.map((c) => {
          const on = !!merged[c.key];
          const locked = auto[c.key];
          return (
            <li key={c.key}>
              <button
                type="button"
                role="checkbox"
                aria-checked={on}
                disabled={locked}
                onClick={() => setItems((x) => ({ ...x, [c.key]: !x[c.key] }))}
                className="flex w-full items-center gap-2.5 rounded-control px-1.5 py-1.5 text-left text-sm hover:bg-white/60 dark:hover:bg-asphalt-500"
              >
                {on ? <CheckSquare size={18} className="text-nh" /> : <Square size={18} className="text-mist" />}
                <span className={on ? "line-through opacity-70" : ""}>{c.label}</span>
                {c.key === "emergency" && !on && (
                  <Link to={profileLink} className="ml-auto text-xs font-semibold text-nh underline" onClick={(e) => e.stopPropagation()}>
                    Fill in
                  </Link>
                )}
                {c.key === "offlinemap" && !on && <span className="ml-auto text-xs muted">Download below</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
