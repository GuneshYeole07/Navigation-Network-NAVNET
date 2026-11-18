import { useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Flag, MapPin, Play, Shield, Timer, UserCheck, Users, X } from "lucide-react";
import Modal from "../ui/Modal";
import Countdown from "./Countdown";
import { formatDistance } from "../../utils/format";
import { STOP_REASONS } from "../../utils/constants";
import { tripService } from "../../services/tripService";

/**
 * The ride captain's dashboard on the phone: one glanceable line that answers
 * "is my group together?", plus the handful of actions a leader actually uses.
 */
export default function CaptainBar({ trip, members, me, emit, nav, alerts, isAdmin, onStarted }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => Object.values(members), [members]);
  const riding = list.filter((m) => m.status === "MOVING" || m.status === "STOPPED");
  const total = list.length;
  const stopReqs = alerts.filter((a) => a.type === "STOP_REQUEST" && !a.acknowledgedAt && Date.now() - new Date(a.createdAt).getTime() < 15 * 60000);

  const run = async (fn, ok) => {
    setBusy(true);
    try {
      await fn();
      if (ok) toast.success(ok);
      setOpen(false);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  // ── What the captain sees at a glance ──
  let line;
  let tone = "bg-white dark:bg-asphalt-700";
  if (trip.status === "PLANNED") {
    const here = list.filter((m) => m.atStart).length;
    const ready = list.filter((m) => m.ready).length;
    const checked = list.filter((m) => m.checklistDone === m.checklistTotal).length;
    line = (
      <>
        <b>{here}/{total}</b> at start · <b>{ready}/{total}</b> ready · <b>{checked}/{total}</b> checklist
      </>
    );
  } else if (trip.meet) {
    const at = list.filter((m) => m.atMeet);
    const missing = list.filter((m) => !m.atMeet).sort((a, b) => (b.distanceToMeet ?? 0) - (a.distanceToMeet ?? 0));
    const far = missing[0];
    line = (
      <>
        Stop <b>{trip.meet.name}</b>: <b>{at.length}/{total}</b> here
        {far ? ` · waiting for ${far.name.split(" ")[0]}${far.distanceToMeet != null ? ` (${formatDistance(far.distanceToMeet)})` : ""}` : " · everyone's here ✓"}
      </>
    );
    if (!far) tone = "bg-nh-50 dark:bg-nh/20";
  } else {
    const ref = Math.max(...riding.map((m) => m.progress), 0);
    const last = [...riding].sort((a, b) => a.progress - b.progress)[0];
    const spread = last ? ref - last.progress : 0;
    const limit = trip.gapAlertMeters || 1500;
    tone = spread > limit ? "bg-signal-50 dark:bg-signal/20" : spread > limit * 0.6 ? "bg-stone-cap/20" : "bg-white dark:bg-asphalt-700";
    line = (
      <>
        Group spread <b>{formatDistance(spread)}</b>
        {last && last.userId !== me?.userId ? ` · last: ${last.name.split(" ")[0]}` : ""}
        {` · ${riding.length}/${total} online`}
      </>
    );
  }

  const sweep = list.find((m) => m.isSweep);
  const myPos = me?.lat != null ? { lat: me.lat, lng: me.lng } : null;

  const meetHere = () =>
    run(async () => {
      if (!myPos) throw new Error("Waiting for your GPS position");
      await emit("meet:set", { ...myPos, name: "Captain's stop" });
    }, "Meet pin dropped — everyone's being guided here");
  const meetAtNextCheckpoint = () =>
    run(async () => {
      const c = nav?.nextCheckpoint;
      if (!c) throw new Error("No checkpoint ahead");
      await emit("meet:set", { lat: c.lat, lng: c.lng, name: c.name });
    }, "Group stop set at the next checkpoint");

  return (
    <>
      <div className={`overflow-hidden rounded-control shadow-float ring-1 ring-road-line dark:ring-asphalt-500 ${tone}`}>
        <div className="flex items-center gap-2 px-3 py-2 text-sm">
          <Shield size={16} className="shrink-0 text-nh" aria-label="Captain" />
          <p className="min-w-0 flex-1 truncate">{line}</p>
          {stopReqs.length > 0 && <span className="chip bg-stone-cap text-asphalt">✋ {stopReqs.length}</span>}
        </div>
        <div className="flex items-center gap-1.5 border-t border-road-line px-2 py-1.5 dark:border-asphalt-500">
          {trip.status === "PLANNED" ? (
            <>
              <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => run(() => emit("ready:check"), "Asked everyone: ready to roll?")} disabled={busy}>
                <UserCheck size={14} /> Ready check
              </button>
              {isAdmin && (
                <button
                  className="btn-primary !px-2.5 !py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => run(async () => (await tripService.setStatus(trip.id, "start"), onStarted?.()), "Ride started")}
                >
                  <Play size={14} /> Start ride
                </button>
              )}
            </>
          ) : trip.meet ? (
            <>
              <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => setOpen("depart")}>
                <Timer size={14} /> Leave in…
              </button>
              <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={() => run(() => emit("meet:clear"), "Stop cleared")} disabled={busy}>
                <X size={14} /> End stop
              </button>
            </>
          ) : (
            <>
              <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={meetHere} disabled={busy}>
                <MapPin size={14} /> Stop here
              </button>
              <button className="btn-secondary !px-2.5 !py-1.5 text-xs" onClick={meetAtNextCheckpoint} disabled={busy || !nav?.nextCheckpoint}>
                <Flag size={14} /> Next checkpoint
              </button>
            </>
          )}
          <button className="btn-ghost ml-auto !px-2 !py-1.5 text-xs" onClick={() => setOpen("more")} aria-label="Captain tools">
            <Users size={14} /> {sweep ? `Sweep: ${sweep.name.split(" ")[0]}` : "Set sweep"}
          </button>
        </div>
        {trip.departAt && (
          <div className="px-3 pb-2">
            <Countdown departAt={trip.departAt} />
          </div>
        )}
      </div>

      <Modal open={open === "depart"} onClose={() => setOpen(false)} title="Leave in…" size="sm">
        <div className="grid grid-cols-3 gap-2">
          {[5, 10, 15, 20, 30, 45].map((m) => (
            <button key={m} className="btn-secondary !py-3 text-base" onClick={() => run(() => emit("depart:set", { minutes: m }), `Leaving in ${m} min — everyone's been told`)}>
              {m} min
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={open === "more"} onClose={() => setOpen(false)} title="Captain tools" size="sm">
        <div className="space-y-5">
          {stopReqs.length > 0 && (
            <section>
              <h3 className="mb-2 text-lg">Stop requests</h3>
              <ul className="space-y-2">
                {stopReqs.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-control bg-stone-cap/15 p-2.5 text-sm">
                    <span>
                      {STOP_REASONS[a.data?.reason]?.emoji} {a.message}
                    </span>
                    <button className="btn-primary !px-2.5 !py-1.5 text-xs" onClick={meetHere}>
                      Stop here
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section>
            <h3 className="text-lg">Sweep (rides last)</h3>
            <p className="mb-2 text-xs muted">Your most experienced rider. NavNet warns you if anyone falls behind them and tells you when they've cleared each turn.</p>
            <div className="flex flex-wrap gap-2">
              {list
                .filter((m) => m.userId !== me?.userId)
                .map((m) => (
                  <button
                    key={m.userId}
                    className={`chip !px-3 !py-1.5 text-sm ring-1 ${m.isSweep ? "bg-nh text-white ring-nh" : "bg-white ring-road-line dark:bg-asphalt-700 dark:ring-asphalt-500"}`}
                    onClick={() => run(() => emit("sweep:set", { userId: m.isSweep ? null : m.userId }), m.isSweep ? "Sweep removed" : `${m.name} is the sweep`)}
                  >
                    {m.name}
                  </button>
                ))}
            </div>
          </section>
          <section className="grid grid-cols-2 gap-2">
            <button className="btn-secondary" onClick={() => run(() => emit("ready:check"), "Ready check sent")}>
              <UserCheck size={16} /> Ready check
            </button>
            <button className="btn-secondary" onClick={meetHere}>
              <MapPin size={16} /> Stop here
            </button>
          </section>
        </div>
      </Modal>
    </>
  );
}
