import { useCallback, useEffect, useMemo, useState } from "react";
import { cumulative } from "../../utils/geo";
import { Link, useNavigate, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { BarChart3, BellOff, Bike, ChevronLeft, Crosshair, Flag, Megaphone, Pause, Play, UserPlus, Wifi, WifiOff } from "lucide-react";
import { Marker } from "../../components/map/gl";
import { targetIcon } from "../../components/map/icons";
import InviteModal from "../../components/trip/InviteModal";
import { startAlarm, stopAlarm } from "../../utils/alarm";
import { useTripLive } from "../../hooks/useTripLive";
import { useNow } from "../../hooks/useNow";
import { tripService } from "../../services/tripService";
import BaseMap from "../../components/map/BaseMap.jsx";
import RouteLayer from "../../components/map/RouteLayer";
import MemberMarkers from "../../components/map/MemberMarkers";
import { FitBounds, InvalidateOnResize } from "../../components/map/MapHelpers";
import LiveShell from "../../components/layout/LiveShell";
import PanelTabs from "../../components/layout/PanelTabs";
import ChatPanel from "../../components/chat/ChatPanel";
import ConvoyStats from "../../components/trip/ConvoyStats";
import { useSmartEta } from "../../hooks/useSmartEta";
import MemberTable from "../../components/trip/MemberTable";
import AlertFeed from "../../components/trip/AlertFeed";
import Modal from "../../components/ui/Modal";
import ThemeToggle from "../../components/ui/ThemeToggle";
import { TripStatusPill } from "../../components/ui/StatusPill";
import { FullScreenLoader } from "../../components/ui/Skeleton";

const PRESETS = ["Regroup at the next checkpoint", "Slow down, keep the group together", "Stop here for a break", "Single file through the ghat", "Headlights on", "Fuel up at the next stop"];

function Controls({ trip, onAction, onBroadcast, onInvite, busy }) {
  const s = trip.status;
  const ended = s === "COMPLETED" || s === "CANCELLED";
  if (ended)
    return (
      <Link to={`/trips/${trip.id}/report`} className="btn-primary flex-1">
        <BarChart3 size={16} /> Trip analytics
      </Link>
    );
  return (
    <>
      {s === "PLANNED" && (
        <button className="btn-primary flex-1" onClick={() => onAction("start")} disabled={busy}>
          <Play size={16} /> Start trip
        </button>
      )}
      {s === "ACTIVE" && (
        <button className="btn-secondary flex-1 !px-2" onClick={() => onAction("pause")} disabled={busy}>
          <Pause size={16} /> Pause
        </button>
      )}
      {s === "PAUSED" && (
        <button className="btn-primary flex-1" onClick={() => onAction("resume")} disabled={busy}>
          <Play size={16} /> Resume
        </button>
      )}
      <button className="btn-secondary flex-1 !px-2" onClick={onInvite} aria-label="Invite riders">
        <UserPlus size={16} /> Invite
      </button>
      <button className="btn-secondary flex-1 !px-2" onClick={onBroadcast}>
        <Megaphone size={16} /> Broadcast
      </button>
      <button className="btn-secondary flex-1 !px-2 !text-signal" onClick={() => onAction("end")} disabled={busy}>
        <Flag size={16} /> End
      </button>
    </>
  );
}

export default function MonitoringPanel() {
  const { id } = useParams();
  const navigate = useNavigate();
  const now = useNow(2000);
  const { trip, setTrip, members, stats, alerts, ackAlert, error, loading, connected, role } = useTripLive(id);
  const smartEta = useSmartEta(id, { active: trip?.status === "ACTIVE", online: connected });
  const [tab, setTab] = useState("members");
  const [view, setView] = useState({ key: "initial", points: null });
  const [focused, setFocused] = useState(null);
  const [dmPeer, setDmPeer] = useState(null);
  const [confirm, setConfirm] = useState(null); // { title, body, cta, run, danger }
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [broadcastText, setBroadcastText] = useState("");
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [contacts, setContacts] = useState({});
  const [muted, setMuted] = useState(false);

  // Riders' phone numbers (admin only) for one-tap calling; refresh when people join.
  const memberCount = Object.keys(members).length;
  useEffect(() => {
    if (role !== "ADMIN") return;
    tripService
      .contacts(id)
      .then((list) => setContacts(Object.fromEntries(list.map((c) => [c.userId, c.phone]))))
      .catch(() => {});
  }, [id, role, memberCount]);

  // Loud alarm until every SOS is acknowledged.
  const openSos = alerts.filter((a) => a.type === "SOS" && !a.acknowledgedAt);
  const sosCount = openSos.length;
  useEffect(() => {
    if (sosCount && !muted) startAlarm();
    else stopAlarm();
    return stopAlarm;
  }, [sosCount, muted]);
  useEffect(() => setMuted(false), [sosCount]);

  const memberList = useMemo(() => Object.values(members), [members]);
  const routeCtx = useMemo(() => (trip?.routeGeometry ? { line: trip.routeGeometry, cum: cumulative(trip.routeGeometry) } : null), [trip?.routeGeometry]);
  const openAlerts = alerts.filter((a) => !a.acknowledgedAt).length;

  const focusMember = useCallback(
    (userId) => {
      const m = members[userId];
      setFocused(userId);
      if (m?.lat != null) setView({ key: `m-${userId}-${Date.now()}`, points: [[m.lat, m.lng]] });
      else toast("No location from this rider yet");
    },
    [members],
  );

  const run = async (fn, success) => {
    setBusy(true);
    try {
      await fn();
      if (success) toast.success(success);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  const onAction = (action) => {
    const doIt = () =>
      run(async () => {
        const r = await tripService.setStatus(id, action);
        setTrip((t) => ({ ...t, status: r.status }));
        if (action === "end") navigate(`/trips/${id}/report`);
      });
    if (action === "end")
      return setConfirm({
        title: "End this trip?",
        body: "Location sharing stops for everyone and NavNet generates the trip analytics. This can't be undone.",
        cta: "End trip",
        danger: true,
        run: doIt,
      });
    doIt();
  };

  if (loading && !trip) return <FullScreenLoader label="Loading convoy" />;
  if (error)
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <h1 className="text-3xl">Can't open this trip</h1>
          <p className="mt-2 muted">{error.message}</p>
          <Link to="/admin/monitor" className="btn-primary mt-6">
            Back to trips
          </Link>
        </div>
      </div>
    );

  const fitPoints = [...trip.routeGeometry.filter((_, i) => i % 10 === 0), ...memberList.filter((m) => m.lat != null).map((m) => [m.lat, m.lng])];

  const topBar = (
    <div className="space-y-3 p-3">
      <div className="flex items-center gap-2">
        <Link to="/admin/monitor" className="btn-ghost !p-2" aria-label="Back to trips">
          <ChevronLeft size={20} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl leading-tight">{trip.name}</h1>
          <div className="flex flex-wrap items-center gap-x-2 text-xs">
            <TripStatusPill status={trip.status} />
            <span className="muted">
              ID <span className="font-display text-sm font-semibold text-asphalt dark:text-road">{trip.groupCode}</span>
            </span>
            <span className={`inline-flex items-center gap-1 ${connected ? "text-nh" : "text-signal"}`}>
              {connected ? <Wifi size={12} /> : <WifiOff size={12} />}
              {connected ? "Live" : "Reconnecting"}
            </span>
          </div>
        </div>
        <button
          className="btn-primary !px-2.5 !py-1.5 text-xs"
          onClick={() =>
            run(async () => {
              await tripService.ride(id);
              navigate(`/admin/ride/${id}`);
            })
          }
          disabled={busy || trip.status === "COMPLETED" || trip.status === "CANCELLED"}
          title="Open the phone ride screen with captain tools"
        >
          <Bike size={14} /> Ride as captain
        </button>
        <ThemeToggle />
      </div>
      <div className="flex gap-2">
        <Controls trip={trip} onAction={onAction} onBroadcast={() => setBroadcastOpen(true)} onInvite={() => setInviteOpen(true)} busy={busy} />
      </div>
    </div>
  );

  const panel = (
    <div className="flex h-full flex-col">
      <PanelTabs
        tabs={[
          { key: "members", label: `Riders (${memberList.length})` },
          { key: "alerts", label: "Alerts", badge: openAlerts || null },
          { key: "chat", label: "Chat" },
          { key: "stats", label: "Convoy" },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "members" && (
          <MemberTable
            members={memberList}
            now={now}
            focusedId={focused}
            phones={contacts}
            onFocus={focusMember}
            onMessage={(uid) => {
              setDmPeer(uid);
              setTab("chat");
            }}
            onMakeLeader={(m) => run(() => tripService.setLeader(id, m.userId), `${m.name} is now the leader`)}
            onMakeSweep={(m) => run(() => tripService.setSweep(id, m.isSweep ? null : m.userId), m.isSweep ? "Sweep removed" : `${m.name} is now the sweep`)}
            onRemove={(m) =>
              setConfirm({
                title: `Remove ${m.name}?`,
                body: "They'll be disconnected from the trip and can't rejoin with the Group ID.",
                cta: "Remove rider",
                danger: true,
                run: () => run(() => tripService.removeMember(id, m.userId), `${m.name} removed`),
              })
            }
          />
        )}
        {tab === "alerts" && (
          <AlertFeed
            alerts={alerts}
            phones={contacts}
            now={now}
            onAck={(aid) => ackAlert(aid).catch((e) => toast.error(e.message))}
            onLocate={(pt, uid) => {
              setFocused(uid);
              setView({ key: `a-${Date.now()}`, points: [pt] });
            }}
          />
        )}
        {tab === "chat" && (
          <div className="h-full">
            <ChatPanel tripId={id} role="ADMIN" members={memberList} initialPeer={dmPeer} disabled={trip.status === "CANCELLED"} />
          </div>
        )}
        {tab === "stats" && (
          <div className="p-4">
            <ConvoyStats stats={stats} smartEta={smartEta} />
          </div>
        )}
      </div>
    </div>
  );

  const sos = openSos[0];

  return (
    <div className="h-full">
      <LiveShell
        topBar={topBar}
        panel={panel}
        mapOverlay={
          <div className="pointer-events-auto w-full max-w-xl space-y-2">
            {sos && (
              <div className="sos-pulse flex w-full items-center gap-2 rounded-control bg-signal p-3 text-white shadow-float">
                <button onClick={() => setTab("alerts")} className="flex flex-1 items-center gap-3 text-left">
                  <span className="font-display text-2xl font-bold">SOS</span>
                  <span className="flex-1 text-sm">
                    <strong>{sos.userName}</strong> needs help{sosCount > 1 ? ` (+${sosCount - 1} more)` : ""}. Open alerts to see location and details.
                  </span>
                </button>
                {!muted && (
                  <button onClick={() => setMuted(true)} className="rounded-control bg-white/15 p-2 hover:bg-white/25" aria-label="Silence alarm" title="Silence alarm">
                    <BellOff size={18} />
                  </button>
                )}
              </div>
            )}
            {stats && (
              <div className="glass hidden items-center justify-around gap-4 rounded-control px-4 py-2 text-center shadow-float sm:flex">
                {[
                  ["Active", stats.activeMembers],
                  ["Offline", stats.offlineMembers],
                  ["Arrived", stats.arrivedMembers],
                  ["Avg km/h", Math.round(stats.averageSpeed)],
                  ["Convoy", `${(stats.convoyLength / 1000).toFixed(1)} km`],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="font-display text-xl font-bold leading-none">{v}</div>
                    <div className="text-[11px] muted">{l}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        }
        map={
          <BaseMap center={[trip.start.lat, trip.start.lng]} zoom={11}>
            <InvalidateOnResize />
            <FitBounds points={view.points || fitPoints} fitKey={view.key} />
            <RouteLayer trip={trip} showWaypoints />
            <MemberMarkers members={memberList} selfId={focused} now={now} onSelect={setFocused} route={routeCtx} selfIsYou={false} />
            {trip.meet && <Marker position={[trip.meet.lat, trip.meet.lng]} icon={targetIcon("meet")} />}
          </BaseMap>
        }
        floating={
          <button className="glass grid h-11 w-11 place-items-center rounded-full shadow-float" onClick={() => setView({ key: `all-${Date.now()}`, points: null })} aria-label="Show whole convoy" title="Whole convoy">
            <Crosshair size={18} />
          </button>
        }
      />

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title={confirm?.title} tone={confirm?.danger ? "danger" : "default"} size="sm">
        <p className="text-sm">{confirm?.body}</p>
        <div className="mt-5 flex gap-2">
          <button className="btn-secondary flex-1" onClick={() => setConfirm(null)}>
            Keep it
          </button>
          <button className={`${confirm?.danger ? "btn-danger" : "btn-primary"} flex-1`} onClick={confirm?.run} disabled={busy}>
            {confirm?.cta}
          </button>
        </div>
      </Modal>

      <InviteModal open={inviteOpen} onClose={() => setInviteOpen(false)} tripId={id} />

      <Modal open={broadcastOpen} onClose={() => setBroadcastOpen(false)} title="Broadcast to all riders" size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!broadcastText.trim()) return;
            run(async () => {
              await tripService.broadcast(id, broadcastText.trim());
              setBroadcastText("");
              setBroadcastOpen(false);
            }, "Broadcast sent");
          }}
          className="space-y-3"
        >
          <div className="flex flex-wrap gap-1.5" aria-label="Quick broadcasts">
            {PRESETS.map((p) => (
              <button type="button" key={p} onClick={() => setBroadcastText(p)} className="chip bg-road !px-2.5 !py-1.5 text-xs ring-1 ring-road-line hover:bg-road-line dark:bg-asphalt-600 dark:ring-asphalt-500">
                {p}
              </button>
            ))}
          </div>
          <textarea className="input min-h-[110px]" value={broadcastText} onChange={(e) => setBroadcastText(e.target.value)} placeholder="Regroup at the next fuel stop. Ride in single file through the ghat." maxLength={2000} aria-label="Broadcast message" />
          <p className="text-xs muted">Shows as a banner on every rider's map and is pinned in group chat.</p>
          <button className="btn-primary w-full" disabled={busy || !broadcastText.trim()}>
            <Megaphone size={16} /> Send broadcast
          </button>
        </form>
      </Modal>
    </div>
  );
}
