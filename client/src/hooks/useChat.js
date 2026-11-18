import { useCallback, useEffect, useState } from "react";
import { useSocket } from "../context/SocketContext";
import { useAuth } from "../context/AuthContext";
import { tripService } from "../services/tripService";

/**
 * Messages for one conversation.
 *   scope "group"   → everyone in the trip (chat + announcements + system lines)
 *   scope "private" → me ↔ peerId (admin ↔ member)
 */
export function useChat(tripId, { scope = "group", peerId = null, enabled = true } = {}) {
  const { socket } = useSocket();
  const { user } = useAuth();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled || (scope === "private" && !peerId && user?.role === "ADMIN")) {
      setMessages([]);
      setLoading(false);
      return undefined;
    }
    let alive = true;
    setLoading(true);
    tripService
      .messages(tripId, { scope, ...(peerId ? { with: peerId } : {}) })
      .then((m) => alive && setMessages(m))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tripId, scope, peerId, enabled, user?.role]);

  useEffect(() => {
    if (!socket || !enabled) return undefined;
    const onMsg = (m) => {
      if (m.tripId !== tripId) return;
      const isPrivate = !!m.recipientId;
      if (scope === "group" && isPrivate) return;
      if (scope === "private") {
        if (!isPrivate) return;
        if (peerId && m.senderId !== peerId && m.recipientId !== peerId) return;
      }
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    };
    socket.on("chat:message", onMsg);
    return () => socket.off("chat:message", onMsg);
  }, [socket, tripId, scope, peerId, enabled]);

  const send = useCallback(
    async (body, recipientId = null) => {
      const payload = { body, recipientId };
      if (socket?.connected) {
        const res = await socket.timeout(10000).emitWithAck("chat:send", { tripId, ...payload });
        if (!res.ok) throw new Error(res.error);
        return res.data;
      }
      return tripService.sendMessage(tripId, payload); // REST fallback
    },
    [socket, tripId],
  );

  return { messages, loading, send };
}
