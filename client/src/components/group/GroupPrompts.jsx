import { Navigation } from "lucide-react";
import Modal from "../ui/Modal";
import { EMERGENCY_TYPES } from "../../utils/constants";
import { formatDistance } from "../../utils/format";

/** Captain's "ready to roll?" — one big button. */
export function ReadyPrompt({ ask, onReady, onClose }) {
  return (
    <Modal open={!!ask} onClose={onClose} title="Ready to roll?" size="sm">
      <p className="mb-4 text-sm">{ask?.by} is checking everyone's ready to leave.</p>
      <button className="btn-primary w-full !py-4 text-lg" onClick={onReady}>
        I'm ready 👍
      </button>
      <button className="btn-ghost mt-2 w-full" onClick={onClose}>
        Not yet
      </button>
    </Modal>
  );
}

/** A friend nearby pressed SOS: you may be the fastest help. */
export function HelpRequest({ help, onGuide, onClose }) {
  return (
    <Modal open={!!help} onClose={onClose} title={`${help?.name} needs help`} tone="danger" size="sm">
      {help && (
        <div className="space-y-4">
          <p>
            <strong>{EMERGENCY_TYPES[help.emergencyType]?.emoji} {EMERGENCY_TYPES[help.emergencyType]?.label}</strong> · about{" "}
            <strong>{formatDistance(help.distance)}</strong> from you. You're one of the closest riders. The captain has been alerted too.
          </p>
          <p className="text-sm muted">Only go if it's safe. Pull over before using your phone.</p>
          <button className="btn-danger w-full !py-3 text-base" onClick={onGuide}>
            <Navigation size={18} /> Guide me to {help.name.split(" ")[0]}
          </button>
          <button className="btn-ghost w-full" onClick={onClose}>
            Dismiss
          </button>
        </div>
      )}
    </Modal>
  );
}
