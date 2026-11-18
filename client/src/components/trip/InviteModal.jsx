import { useEffect, useState } from "react";
import QRCode from "qrcode";
import toast from "react-hot-toast";
import { Copy, Share2 } from "lucide-react";
import Modal from "../ui/Modal";
import { tripService } from "../../services/tripService";
import { formatDateTime } from "../../utils/format";

/** Share a one-tap join link: QR code for in-person, WhatsApp / share sheet for remote. */
export default function InviteModal({ open, onClose, tripId }) {
  const [invite, setInvite] = useState(null);
  const [qr, setQr] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open || invite) return;
    tripService
      .invite(tripId)
      .then(async (inv) => {
        const url = `${window.location.origin}/user/join?invite=${encodeURIComponent(inv.token)}`;
        setInvite({ ...inv, url });
        setQr(await QRCode.toDataURL(url, { width: 480, margin: 1, color: { dark: "#1C2226", light: "#ffffff" } }));
      })
      .catch((e) => setError(e.message));
  }, [open, invite, tripId]);

  const text = invite ? `Join "${invite.name}" on NavNet 🏍️\nTap to join: ${invite.url}\n(Or use Group ID ${invite.groupCode} + the password)` : "";

  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: `Join ${invite.name}`, text, url: invite.url });
        return;
      } catch {
        /* cancelled */
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  };

  return (
    <Modal open={open} onClose={onClose} title="Invite riders" size="sm">
      {error ? (
        <p className="text-sm text-signal">{error}</p>
      ) : !invite ? (
        <p className="text-sm muted">Creating invite link…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">Riders scan this or tap the link and they're in. No Group ID or password to type.</p>
          {qr && <img src={qr} alt="QR code to join the trip" className="mx-auto w-56 rounded-control ring-1 ring-road-line" />}
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-primary" onClick={share}>
              <Share2 size={16} /> Share
            </button>
            <button
              className="btn-secondary"
              onClick={() => navigator.clipboard?.writeText(text).then(() => toast.success("Invite copied"))}
            >
              <Copy size={16} /> Copy
            </button>
          </div>
          <p className="text-center text-xs muted">Link works until {formatDateTime(invite.expiresAt)}.</p>
        </div>
      )}
    </Modal>
  );
}
