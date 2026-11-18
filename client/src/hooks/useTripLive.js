import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";
import { tripService } from "../services/tripService";
import { ALERT_META, EMERGENCY_TYPES } from "../utils/constants";
import { speak } from "../utils/voice";

/**
 * Single source of truth for a live trip screen (user dashboard or admin monitor).
 * Loads a REST snapshot, then subscribes over Socket.IO and keeps members, stats,
 * trip status and (for admins) alerts current.
 */
export function useTripLive(tripId) {
  const { socket, connected } = useSocket();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [trip, setTrip] = useState(null);
  const [members, setMembers] = useState({});
  const [stats, setStats] = useState(null);
  const [role, setRole] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savedAt, setSavedAt] = useState(null); // set when showing the on-device copy
  const [readyAsk, setReadyAsk] = useState(null); // captain's "ready to roll?"
  const [helpRequest, setHelpRequest] = useState(null); // a nearby friend's SOS
  const tripRef = useRef(null);
  const roleRef = useRef(null);

  const applySnapshot = useCallback((snap) => {
    // Keep the latest snapshot on the device so the trip still opens with no network.
    try {
      localStorage.setItem(`navnet-trip-${snap.trip.id}`, JSON.stringify({ ...snap, savedAt: Date.now() }));
    } catch {
      /* storage full / private mode */
    }
    setTrip(snap.trip);
    tripRef.current = snap.trip;
    setMembers(Object.fromEntries(snap.members.map((m) => [m.userId, m])));
    setStats(snap.stats);
    setRole(snap.role);
    roleRef.current = snap.role;
  }, []);

  // Initial REST load (works even before the socket connects).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    tripService
      .get(tripId)
      .then((snap) => {
        if (!alive) return;
        applySnapshot(snap);
        if (snap.role === "ADMIN") tripService.alerts(tripId).then((a) => alive && setAlerts(a)).catch(() => {});
      })
      .catch((e) => {
        if (!alive) return;
        // Offline (or server down): fall back to the copy saved on this device.
        const saved = (() => {
          try {
            return JSON.parse(localStorage.getItem(`navnet-trip-${tripId}`));
          } catch {
            return null;
          }
        })();
        if (saved && (!e.status || e.status >= 500)) {
          setTrip(saved.trip);
          setMembers(Object.fromEntries(saved.members.map((m) => [m.userId, { ...m, status: m.userId === user?.id ? m.status : "OFFLINE" }])));
          setStats(saved.stats);
          setRole(saved.role);
          roleRef.current = saved.role;
          setSavedAt(saved.savedAt);
        } else setError(e);
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tripId, applySnapshot, user?.id]);

  const emit = useCallback(
    (event, data) =>
      new Promise((resolve, reject) => {
        if (!socket?.connected) return reject(new Error("You're offline. Reconnecting…"));
        socket.timeout(10000).emit(event, { tripId, ...data }, (err, res) => {
          if (err) {
            // No answer in 10 s: the link is dead even if the socket hasn't noticed yet (tunnels
            // often drop silently, and the heartbeat takes up to 20 s to give up). Drop the
            // transport now, so the app switches to "No signal" (and starts saving positions on
            // the phone) at once and reconnects by itself when signal returns.
            if (socket.connected) socket.io.engine?.close();
            return reject(new Error("The server didn't respond in time."));
          }
          if (!res?.ok) return reject(new Error(res?.error || "Request failed"));
          resolve(res.data);
        });
      }),
    [socket, tripId],
  );

  // Subscribe (and re-subscribe after every reconnect).
  useEffect(() => {
    if (!socket || !connected) return undefined;
    let alive = true;
    const join = () =>
      emit("trip:join")
        .then((snap) => {
          if (!alive) return;
          applySnapshot(snap);
          setSavedAt(null);
          setError(null);
          // Catch up on alerts (an SOS!) raised while this phone had no signal.
          if (snap.role === "ADMIN") tripService.alerts(tripId).then((a) => alive && setAlerts(a)).catch(() => {});
        })
        .catch(() => {});
    join();

    const isAdmin = () => roleRef.current === "ADMIN";
    const isCaptain = () => isAdmin() || tripRef.current?.leaderId === user?.id;
    const patchTrip = (fields) =>
      setTrip((t) => {
        const next = t && { ...t, ...fields };
        tripRef.current = next;
        return next;
      });
    const forThisTrip = (fn) => (d) => (!d?.tripId || d.tripId === tripId) && fn(d);
    const upsert = (m) => setMembers((prev) => ({ ...prev, [m.userId]: { ...prev[m.userId], ...m } }));

    const handlers = {
      "member:location": upsert,
      "member:status": upsert,
      "members:update": (list) => setMembers((prev) => ({ ...prev, ...Object.fromEntries(list.map((m) => [m.userId, m])) })),
      "member:joined": (d) => {
        if (d.userId !== user?.id) toast(`${d.name} joined the trip`, { icon: "👋" });
        join();
      },
      "member:left": (d) =>
        setMembers((prev) => {
          const next = { ...prev };
          delete next[d.userId];
          return next;
        }),
      "convoy:stats": setStats,
      "trip:status": forThisTrip((d) => {
        setTrip((t) => t && { ...t, status: d.status });
        const msg = { start: "Trip started — ride safe!", pause: "Trip paused by the admin", resume: "Trip resumed", end: "Trip ended", cancel: "Trip cancelled" }[d.action];
        if (msg) {
          toast(msg, { icon: d.action === "pause" ? "⏸️" : d.action === "start" || d.action === "resume" ? "🏍️" : "🏁" });
          // (spoken via the matching announcement message, so not repeated here)
        }
      }),
      "trip:leader": forThisTrip((d) => {
        setTrip((t) => t && { ...t, leaderId: d.leaderId });
        setMembers((prev) => Object.fromEntries(Object.entries(prev).map(([k, m]) => [k, { ...m, isLeader: k === d.leaderId }])));
      }),
      "checkpoint:visited": forThisTrip((d) => {
        if (d.userId === user?.id) {
          toast.success(`Checkpoint reached: ${d.checkpointName}`);
          speak(`Checkpoint reached: ${d.checkpointName}`);
        }
      }),
      "member:arrived": forThisTrip((d) => {
        if (d.userId === user?.id) toast.success("You've arrived at the destination 🏁");
        else if (isAdmin()) toast(`${d.name} arrived`, { icon: "🏁" });
      }),
      "alert:new": forThisTrip((a) => {
        setAlerts((prev) => [a, ...prev]);
        const meta = ALERT_META[a.type];
        const crash = a.type === "POSSIBLE_CRASH";
        toast(a.message, { icon: meta?.emoji, duration: crash ? 20000 : 6000 });
        // The captain rides with eyes on the road: group-safety alerts are spoken.
        if (isCaptain() && (a.type === "GAP" || a.type === "STOP_REQUEST" || crash)) speak(a.message, { urgent: a.type === "GAP" || crash });
        if (crash) {
          try {
            navigator.vibrate?.([300, 100, 300]);
          } catch {
            /* unsupported */
          }
        }
      }),
      "sos:alert": forThisTrip((a) => {
        setAlerts((prev) => [a, ...prev]);
        speak(`Emergency. ${a.userName} triggered S O S: ${EMERGENCY_TYPES[a.data?.emergencyType]?.label ?? "emergency"}.`, { urgent: true });
        toast.error(`SOS — ${a.userName}: ${EMERGENCY_TYPES[a.data?.emergencyType]?.label ?? "Emergency"}`, { duration: 15000, icon: "🆘" });
        try {
          navigator.vibrate?.([300, 100, 300]);
        } catch {
          /* unsupported */
        }
      }),
      "sos:broadcast": forThisTrip((d) =>
        toast.error(`${d.name} raised an SOS (${EMERGENCY_TYPES[d.emergencyType]?.label ?? "emergency"}). The admin has been alerted.`, { duration: 8000 }),
      ),
      "sos:acknowledged": forThisTrip((d) => {
        toast.success(`${d.by} has seen your SOS and is responding.`, { duration: 10000 });
        speak(`${d.by} has seen your S O S and is responding.`, { urgent: true });
      }),
      notification: forThisTrip((n) => {
        toast(n.message, { icon: "⚠️", duration: 7000 });
        if (n.title !== "OFF ROUTE") speak(n.message); // off-route is already spoken by on-device nav
      }),
      // ── Group riding ──
      "trip:meet": forThisTrip((d) => {
        patchTrip({ meet: d.meet });
        if (d.meet) {
          toast(`Group stop: ${d.meet.name}`, { icon: "📍" });
          speak(`Group stop at ${d.meet.name}. Follow the guidance to the meeting point.`);
        }
      }),
      "trip:depart": forThisTrip((d) => {
        patchTrip({ departAt: d.departAt });
        if (d.departAt && d.minutes) speak(`We leave in ${d.minutes} minutes.`);
      }),
      "trip:sweep": forThisTrip((d) => {
        patchTrip({ sweepId: d.sweepId });
        setMembers((prev) => Object.fromEntries(Object.entries(prev).map(([k, m]) => [k, { ...m, isSweep: k === d.sweepId }])));
        if (d.sweepId === user?.id) speak("You are the sweep. Ride last and keep the group together.");
      }),
      "ready:check": forThisTrip((d) => {
        if (!isCaptain()) {
          setReadyAsk(d);
          speak(`${d.by} asks: ready to roll?`);
        }
      }),
      "ready:all": forThisTrip((d) => {
        toast.success(`All ${d.count} riders are ready`);
        speak(`Everyone is ready. ${d.count} riders.`);
      }),
      "group:together": forThisTrip(() => {
        toast.success("Group is back together", { duration: 6000 });
        speak("Group is back together.");
      }),
      "convoy:turn-cleared": forThisTrip((d) => {
        const who = d.bySweep ? "The sweep has passed the turn" : "Everyone has taken the turn";
        toast(`${who} at km ${d.km}`, { icon: "✅", duration: 6000 });
        speak(`${who}. Nobody missed it.`);
      }),
      "sos:nearby": forThisTrip((d) => {
        setHelpRequest(d);
        try {
          navigator.vibrate?.([400, 150, 400, 150, 400]);
        } catch {
          /* unsupported */
        }
        speak(`${d.name} needs help, ${d.distance < 1000 ? `${d.distance} metres` : `${(d.distance / 1000).toFixed(1)} kilometres`} from you.`, { urgent: true });
      }),
      "member:removed": forThisTrip((d) => {
        toast.error(`You were removed from ${d.tripName}`);
        navigate("/user", { replace: true });
      }),
    };

    for (const [ev, fn] of Object.entries(handlers)) socket.on(ev, fn);
    return () => {
      alive = false;
      for (const [ev, fn] of Object.entries(handlers)) socket.off(ev, fn);
      socket.emit("trip:leave", { tripId });
    };
  }, [socket, connected, tripId, emit, applySnapshot, navigate, user?.id]);

  const ackAlert = useCallback(async (id) => {
    const updated = await tripService.ackAlert(id);
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledgedAt: updated.acknowledgedAt } : a)));
  }, []);

  return {
    trip,
    setTrip,
    members,
    stats,
    role,
    alerts,
    ackAlert,
    error,
    loading,
    emit,
    connected,
    savedAt,
    readyAsk,
    clearReadyAsk: () => setReadyAsk(null),
    helpRequest,
    clearHelpRequest: () => setHelpRequest(null),
  };
}
