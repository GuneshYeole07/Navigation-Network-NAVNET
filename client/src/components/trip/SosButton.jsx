import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { MessageSquareText, Phone, WifiOff } from "lucide-react";
import Modal from "../ui/Modal";
import { EMERGENCY_TYPES } from "../../utils/constants";
import { formatClock } from "../../utils/format";
import { speak } from "../../utils/voice";

const QUEUE_KEY = (tripId) => `navnet-outbox-sos-${tripId}`;

const mapLink = (fix) => `https://www.openstreetmap.org/?mlat=${fix.lat.toFixed(6)}&mlon=${fix.lng.toFixed(6)}#map=17/${fix.lat.toFixed(6)}/${fix.lng.toFixed(6)}`;

/**
 * SOS works in three layers:
 *  1. Online   → instant alert to the admin over the live connection.
 *  2. Offline  → queued and auto-sent the moment the network returns, plus
 *  3. Fallback → one-tap SMS (works on bare GSM signal) and call buttons.
 */
export default function SosButton({ emit, getFix, connected, tripId, riderName, adminPhone, adminName, className = "" }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("ACCIDENT");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(null);
  const [queued, setQueued] = useState(false);

  // Auto-send a queued SOS once we're back online.
  useEffect(() => {
    if (!connected) return;
    let pending;
    try {
      pending = JSON.parse(localStorage.getItem(QUEUE_KEY(tripId)));
    } catch {
      pending = null;
    }
    if (!pending) return;
    emit("sos:trigger", pending)
      .then(() => {
        localStorage.removeItem(QUEUE_KEY(tripId));
        setQueued(false);
        toast.success("Your queued SOS has now reached the admin.");
        speak("Your S O S has been delivered to the admin.", { urgent: true });
      })
      .catch(() => {});
  }, [connected, emit, tripId]);

  const fix = getFix();
  const smsBody = fix
    ? `SOS from ${riderName} (NavNet): ${EMERGENCY_TYPES[type].label}. ${note ? `${note}. ` : ""}Location: ${mapLink(fix)}`
    : `SOS from ${riderName} (NavNet): ${EMERGENCY_TYPES[type].label}. GPS not available.`;
  const sms = `sms:${adminPhone || ""}${/iPhone|iPad/.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(smsBody)}`;

  const send = async () => {
    if (!fix) {
      toast.error("No GPS fix yet. Use the SMS or call buttons below.");
      return;
    }
    const payload = { lat: fix.lat, lng: fix.lng, speed: fix.speed ?? null, battery: fix.battery ?? null, emergencyType: type, note: note.trim() || undefined };
    if (!connected) {
      localStorage.setItem(QUEUE_KEY(tripId), JSON.stringify(payload));
      setQueued(true);
      return;
    }
    setBusy(true);
    try {
      const res = await emit("sos:trigger", payload);
      setSentAt(res.at);
      toast.success("SOS sent. The admin has your live location.");
    } catch (e) {
      localStorage.setItem(QUEUE_KEY(tripId), JSON.stringify(payload));
      setQueued(true);
      toast.error(`SOS couldn't send (${e.message}). It's queued; also use SMS or call.`);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setSentAt(null);
    setNote("");
  };

  const fallbacks = (
    <div className="grid grid-cols-3 gap-2">
      <a href={sms} className="btn-secondary flex-col !gap-1 !py-2.5 text-xs">
        <MessageSquareText size={18} /> SMS {adminPhone ? "admin" : ""}
      </a>
      {adminPhone ? (
        <a href={`tel:${adminPhone}`} className="btn-secondary flex-col !gap-1 !py-2.5 text-xs">
          <Phone size={18} /> Call {adminName?.split(" ")[0] || "admin"}
        </a>
      ) : (
        <span className="btn-secondary flex-col !gap-1 !py-2.5 text-center text-xs opacity-60" title="The admin hasn't added a phone number">
          <Phone size={18} /> No admin phone
        </span>
      )}
      <a href="tel:112" className="btn-danger flex-col !gap-1 !py-2.5 text-xs">
        <Phone size={18} /> Call 112
      </a>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`sos-pulse grid h-16 w-16 place-items-center rounded-full bg-signal font-display text-xl font-bold text-white shadow-float hover:bg-signal-700 ${className}`}
        aria-label="SOS — send emergency alert"
      >
        SOS
      </button>
      <Modal open={open} onClose={close} title={sentAt ? "SOS sent" : queued ? "SOS queued" : "Send an emergency alert"} tone="danger" size="sm">
        {sentAt ? (
          <div className="space-y-4">
            <p>Sent at {formatClock(sentAt)}. Your admin can see your live location, speed and battery. Stay where it's safe.</p>
            {fallbacks}
            <button className="btn-secondary w-full" onClick={close}>
              Close
            </button>
          </div>
        ) : queued ? (
          <div className="space-y-4">
            <p className="flex gap-2">
              <WifiOff className="mt-0.5 shrink-0 text-signal" size={18} />
              <span>No network right now. Your SOS will send automatically the moment signal returns. <strong>Send an SMS now</strong>, it often goes through when data doesn't.</span>
            </p>
            {fallbacks}
          </div>
        ) : (
          <div className="space-y-4">
            {!connected && (
              <p className="flex gap-2 rounded-control bg-stone-cap/20 p-2.5 text-sm">
                <WifiOff className="mt-0.5 shrink-0" size={16} /> You're offline. SOS will be queued; use SMS or call below too.
              </p>
            )}
            <fieldset>
              <legend className="field-label">What happened?</legend>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(EMERGENCY_TYPES).map(([k, v]) => (
                  <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-control p-2.5 text-sm font-medium ring-1 ${type === k ? "bg-signal-50 text-signal ring-signal dark:bg-signal/20" : "ring-road-line dark:ring-asphalt-500"}`}>
                    <input type="radio" name="sos-type" value={k} checked={type === k} onChange={() => setType(k)} className="sr-only" />
                    <span aria-hidden="true">{v.emoji}</span> {v.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <input className="input" placeholder="Optional note (e.g. near the toll booth)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            <button className="btn-danger w-full !py-3 text-base" onClick={send} disabled={busy}>
              {busy ? "Sending…" : "Send SOS now"}
            </button>
            {fallbacks}
          </div>
        )}
      </Modal>
    </>
  );
}
