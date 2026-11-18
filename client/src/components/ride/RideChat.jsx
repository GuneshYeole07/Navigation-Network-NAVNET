import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Clock3, Lock, Megaphone, MessageCircle, Send, X } from "lucide-react";
import toast from "react-hot-toast";
import { useSocket } from "../../context/SocketContext";
import { useAuth } from "../../context/AuthContext";
import { tripService } from "../../services/tripService";
import { formatClock } from "../../utils/format";
import { speak } from "../../utils/voice";
import { assetUrl } from "../../services/api";

const QUICK = ["All good 👍", "Wait for me", "Taking a break", "Fuel stop", "Puncture", "Slow down please"];

const outboxKey = (tripId) => `navnet-outbox-${tripId}`;
const readOutbox = (tripId) => {
  try {
    return JSON.parse(localStorage.getItem(outboxKey(tripId))) || [];
  } catch {
    return [];
  }
};
const writeOutbox = (tripId, list) => {
  try {
    localStorage.setItem(outboxKey(tripId), JSON.stringify(list));
  } catch {
    /* ignore */
  }
};

/**
 * One-tap chat for riders: a floating button with an unread badge opens a sheet over
 * the map. One conversation, with a "To: Everyone / Admin" switch and quick replies.
 * Messages typed with no network wait in an outbox and send themselves on reconnect.
 */
export default function RideChat({ tripId, adminId, adminName, disabled, groupOnly = false, onVoice }) {
  const { socket, connected } = useSocket();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("all");
  const [messages, setMessages] = useState([]);
  const [outbox, setOutbox] = useState(() => readOutbox(tripId));
  const [unread, setUnread] = useState(0);
  const [text, setText] = useState("");
  const openRef = useRef(open);
  openRef.current = open;
  const end = useRef(null);

  const load = useCallback(async () => {
    try {
      const [group, priv] = await Promise.all([
        tripService.messages(tripId, { scope: "group" }),
        tripService.messages(tripId, { scope: "private" }),
      ]);
      const all = [...group, ...priv].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      setMessages(all);
      try {
        localStorage.setItem(`navnet-trip-${tripId}-chat`, JSON.stringify(all.slice(-100)));
      } catch {
        /* ignore */
      }
    } catch {
      try {
        setMessages(JSON.parse(localStorage.getItem(`navnet-trip-${tripId}-chat`)) || []);
      } catch {
        /* nothing saved */
      }
    }
  }, [tripId]);

  useEffect(() => {
    load();
  }, [load]);

  // Live messages
  useEffect(() => {
    if (!socket) return undefined;
    const on = (m) => {
      if (m.tripId !== tripId) return;
      setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      if (m.type === "VOICE" && m.senderId !== user?.id) onVoice?.(m);
      if (m.senderId !== user?.id && m.type !== "SYSTEM" && !openRef.current) {
        setUnread((n) => n + 1);
        if (m.recipientId) speak(`Private message from ${m.senderName}: ${m.body}`);
      }
    };
    socket.on("chat:message", on);
    return () => socket.off("chat:message", on);
  }, [socket, tripId, user?.id, onVoice]);

  // Flush the outbox whenever we (re)connect.
  useEffect(() => {
    if (!connected || !socket) return;
    const pending = readOutbox(tripId);
    if (!pending.length) return;
    (async () => {
      const left = [];
      for (const m of pending) {
        try {
          const res = await socket.timeout(10000).emitWithAck("chat:send", { tripId, body: m.body, recipientId: m.recipientId });
          if (!res.ok) throw new Error(res.error);
        } catch {
          left.push(m);
        }
      }
      writeOutbox(tripId, left);
      setOutbox(left);
      if (left.length < pending.length) toast.success(`${pending.length - left.length} queued message(s) sent`);
      load();
    })();
  }, [connected, socket, tripId, load]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      setTimeout(() => end.current?.scrollIntoView({ block: "end" }), 50);
    }
  }, [open, messages.length, outbox.length]);

  const send = async (body) => {
    body = body.trim();
    if (!body) return;
    const recipientId = to === "admin" ? adminId : null;
    if (!connected) {
      const next = [...readOutbox(tripId), { id: `local-${Date.now()}`, body, recipientId, createdAt: new Date().toISOString() }];
      writeOutbox(tripId, next);
      setOutbox(next);
      setText("");
      toast("No network. Message will send when you're back online.", { icon: "📶" });
      return;
    }
    try {
      const res = await socket.timeout(10000).emitWithAck("chat:send", { tripId, body, recipientId });
      if (!res.ok) throw new Error(res.error);
      setText("");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const shown = useMemo(() => messages.slice(-150), [messages]);
  const adminFirst = adminName?.split(" ")[0] || "Admin";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="relative grid h-14 w-14 place-items-center rounded-full bg-asphalt text-white shadow-float dark:bg-road dark:text-asphalt"
        aria-label={`Open chat${unread ? `, ${unread} unread` : ""}`}
      >
        <MessageCircle size={24} />
        {(unread > 0 || outbox.length > 0) && (
          <span className={`absolute -right-1 -top-1 grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-bold text-white ring-2 ring-white ${unread ? "bg-signal" : "bg-stone-capdark"}`}>
            {unread || <Clock3 size={12} />}
          </span>
        )}
      </button>

      {createPortal(
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-[900] flex items-end justify-center sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-asphalt/40" onClick={() => setOpen(false)} />
            <motion.section
              role="dialog"
              aria-label="Trip chat"
              className="relative flex h-[82vh] w-full flex-col overflow-hidden rounded-t-sheet bg-white shadow-float dark:bg-asphalt-700 sm:h-[640px] sm:max-w-md sm:rounded-sheet"
              initial={{ y: 60 }}
              animate={{ y: 0 }}
              exit={{ y: 60 }}
              transition={{ type: "spring", stiffness: 420, damping: 36 }}
            >
              <header className="flex items-center justify-between border-b border-road-line px-4 py-3 dark:border-asphalt-500">
                <h2 className="text-2xl">Chat</h2>
                <button onClick={() => setOpen(false)} className="btn-ghost !p-2" aria-label="Close chat">
                  <X size={20} />
                </button>
              </header>

              <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
                {shown.length === 0 && outbox.length === 0 && <p className="py-8 text-center text-sm muted">No messages yet. Tap a quick reply below.</p>}
                {shown.map((m) => {
                  if (m.type === "SYSTEM")
                    return (
                      <p key={m.id} className="py-0.5 text-center text-xs muted">
                        {m.body} · {formatClock(m.createdAt)}
                      </p>
                    );
                  if (m.type === "ANNOUNCEMENT")
                    return (
                      <div key={m.id} className="flex gap-2 rounded-control border-l-4 border-stone-cap bg-stone-cap/10 p-2.5 text-sm">
                        <Megaphone size={16} className="mt-0.5 shrink-0 text-stone-capdark" aria-label="Announcement" />
                        <p>
                          {m.body} <span className="text-[11px] muted">· {formatClock(m.createdAt)}</span>
                        </p>
                      </div>
                    );
                  const mine = m.senderId === user?.id;
                  return (
                    <div key={m.id} className={`flex ${mine ? "justify-end" : ""}`}>
                      <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${mine ? "rounded-br-sm bg-nh text-white" : "rounded-bl-sm bg-road dark:bg-asphalt-600"}`}>
                        {(!mine || m.recipientId) && (
                          <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold opacity-75">
                            {m.recipientId && <Lock size={10} />}
                            {mine ? `To ${adminFirst}` : `${m.senderName}${m.senderRole === "ADMIN" ? " · Admin" : ""}`}
                          </p>
                        )}
                        {m.type === "VOICE" && m.audioUrl ? (
                          <audio controls preload="none" src={assetUrl(m.audioUrl)} className="h-9 max-w-[220px]" aria-label={`Voice message from ${m.senderName}`} />
                        ) : (
                          <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        )}
                        <p className={`mt-0.5 text-right text-[10px] ${mine ? "text-white/70" : "muted"}`}>{formatClock(m.createdAt)}</p>
                      </div>
                    </div>
                  );
                })}
                {outbox.map((m) => (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-nh/60 px-3 py-2 text-sm text-white">
                      <p>{m.body}</p>
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] text-white/80">
                        <Clock3 size={10} /> Sends when back online
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={end} />
              </div>

              <div className="space-y-2 border-t border-road-line p-3 dark:border-asphalt-500">
                {!groupOnly && (
                <div className="flex gap-1 rounded-control bg-road p-1 text-sm font-semibold dark:bg-asphalt-600" role="radiogroup" aria-label="Send to">
                  {[
                    ["all", "To everyone"],
                    ["admin", `Only ${adminFirst}`],
                  ].map(([k, label]) => (
                    <button key={k} role="radio" aria-checked={to === k} onClick={() => setTo(k)} className={`flex-1 rounded-[8px] py-1.5 ${to === k ? "bg-white shadow-sm dark:bg-asphalt-700" : "muted"}`}>
                      {k === "admin" && <Lock size={12} className="mr-1 inline" />}
                      {label}
                    </button>
                  ))}
                </div>
                )}
                <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Quick replies">
                  {QUICK.map((q) => (
                    <button key={q} disabled={disabled} onClick={() => send(q)} className="chip shrink-0 bg-nh-50 !px-3 !py-2 text-sm text-nh ring-1 ring-nh/20 dark:bg-nh/20 dark:text-nh-100">
                      {q}
                    </button>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    send(text);
                  }}
                >
                  <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={to === "admin" ? `Message ${adminFirst} privately` : "Message everyone"} maxLength={2000} aria-label="Message" disabled={disabled} />
                  <button className="btn-primary !px-3" disabled={disabled || !text.trim()} aria-label="Send message">
                    <Send size={16} />
                  </button>
                </form>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </>
  );
}
