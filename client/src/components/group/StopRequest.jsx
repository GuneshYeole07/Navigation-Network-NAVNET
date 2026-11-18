import { useState } from "react";
import { Hand } from "lucide-react";
import toast from "react-hot-toast";
import Modal from "../ui/Modal";
import { STOP_REASONS } from "../../utils/constants";
import { speak } from "../../utils/voice";

/** "Need a stop" — tells the captain why, in two taps, without anyone typing on a bike. */
export default function StopRequest({ emit, getFix, connected, captainName }) {
  const [open, setOpen] = useState(false);
  const send = async (reason) => {
    setOpen(false);
    if (!connected) {
      toast.error("No network. Use push-to-talk or signal the captain; it will retry when you're online.");
      return;
    }
    try {
      const fix = getFix();
      await emit("stop:request", { reason, ...(fix ? { lat: fix.lat, lng: fix.lng } : {}) });
      toast.success(`${captainName || "The captain"} has been told you need: ${STOP_REASONS[reason].label.toLowerCase()}`);
      speak("Stop request sent to the captain.");
    } catch (e) {
      toast.error(e.message);
    }
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass grid h-12 w-12 place-items-center rounded-full shadow-float"
        aria-label="Need a stop: tell the captain"
        title="Need a stop"
      >
        <Hand size={20} />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Need a stop?" size="sm">
        <p className="mb-3 text-sm muted">The captain hears it straight away and can pick a safe spot for everyone.</p>
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(STOP_REASONS).map(([k, v]) => (
            <button key={k} className="btn-secondary !justify-start !py-3 text-base" onClick={() => send(k)}>
              <span aria-hidden="true">{v.emoji}</span> {v.label}
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
