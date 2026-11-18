import { MapPin } from "lucide-react";
import Modal from "../ui/Modal";

/** Shown before the browser's own permission prompt, so riders know why to tap "Allow". */
export default function LocationExplainer({ open, onAllow, onLater }) {
  return (
    <Modal open={open} onClose={onLater} title="Share your location" size="sm">
      <div className="space-y-4">
        <div className="flex gap-3">
          <MapPin className="mt-0.5 shrink-0 text-nh" />
          <ul className="space-y-1.5 text-sm">
            <li>Your group and the admin see where you are, so nobody gets left behind.</li>
            <li>The map can guide you to every stop, even with no network.</li>
            <li>SOS sends your exact position instantly.</li>
          </ul>
        </div>
        <p className="text-xs muted">Shared only with this trip, and only while you're on it. You can switch it off anytime.</p>
        <button className="btn-primary w-full !py-3" onClick={onAllow}>
          Share my location
        </button>
        <button className="btn-ghost w-full" onClick={onLater}>
          Not now
        </button>
      </div>
    </Modal>
  );
}
