import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Megaphone, X } from "lucide-react";
import { useSocket } from "../../context/SocketContext";
import { speak } from "../../utils/voice";

/** Shows the latest admin announcement over the map until dismissed. */
export default function AnnouncementBanner({ tripId }) {
  const { socket } = useSocket();
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    if (!socket) return undefined;
    const on = (m) => {
      if (m.tripId !== tripId) return;
      setMsg(m);
      speak(`Announcement from ${m.senderName}: ${m.body}`);
    };
    socket.on("announcement", on);
    return () => socket.off("announcement", on);
  }, [socket, tripId]);

  return (
    <AnimatePresence>
      {msg && (
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: -20, opacity: 0 }}
          role="status"
          className="flex items-start gap-3 rounded-control bg-stone-cap p-3 text-asphalt shadow-float"
        >
          <Megaphone size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="flex-1 text-sm">
            <p className="font-semibold">{msg.senderName}</p>
            <p>{msg.body}</p>
          </div>
          <button onClick={() => setMsg(null)} aria-label="Dismiss announcement" className="-m-1 p-1">
            <X size={16} />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
