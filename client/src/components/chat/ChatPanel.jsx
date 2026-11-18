import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Megaphone, Send } from "lucide-react";
import toast from "react-hot-toast";
import { useChat } from "../../hooks/useChat";
import { useAuth } from "../../context/AuthContext";
import { formatClock } from "../../utils/format";
import { assetUrl } from "../../services/api";
import Avatar from "../ui/Avatar";

function MessageList({ messages, selfId, loading, empty }) {
  const end = useRef(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);
  if (loading) return <div className="flex-1 p-4 text-sm muted">Loading messages…</div>;
  return (
    <div className="flex-1 space-y-2 overflow-y-auto p-3" aria-live="polite">
      {messages.length === 0 && <p className="py-8 text-center text-sm muted">{empty}</p>}
      {messages.map((m) => {
        if (m.type === "SYSTEM")
          return (
            <p key={m.id} className="py-1 text-center text-xs muted">
              {m.body} · {formatClock(m.createdAt)}
            </p>
          );
        if (m.type === "ANNOUNCEMENT")
          return (
            <div key={m.id} className="flex gap-2 rounded-control border-l-4 border-stone-cap bg-stone-cap/10 p-2.5 text-sm">
              <Megaphone size={16} className="mt-0.5 shrink-0 text-stone-capdark" aria-label="Announcement" />
              <div>
                <p>{m.body}</p>
                <p className="mt-0.5 text-[11px] muted">
                  {m.senderName} · {formatClock(m.createdAt)}
                </p>
              </div>
            </div>
          );
        const mine = m.senderId === selfId;
        return (
          <div key={m.id} className={`flex items-end gap-2 ${mine ? "justify-end" : ""}`}>
            {!mine && <Avatar id={m.senderId} name={m.senderName} size={26} />}
            <div
              className={`max-w-[78%] rounded-2xl px-3 py-2 text-sm ${
                mine ? "rounded-br-sm bg-nh text-white" : "rounded-bl-sm bg-road dark:bg-asphalt-600"
              }`}
            >
              {!mine && (
                <p className="mb-0.5 text-[11px] font-semibold opacity-70">
                  {m.senderName}
                  {m.senderRole === "ADMIN" ? " · Admin" : ""}
                </p>
              )}
              {m.type === "VOICE" && m.audioUrl ? (
                <audio controls preload="none" src={assetUrl(m.audioUrl)} className="mt-1 h-9 w-56 max-w-full" aria-label={`Voice message from ${m.senderName}`} />
              ) : (
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
              )}
              <p className={`mt-0.5 text-right text-[10px] ${mine ? "text-white/70" : "muted"}`}>{formatClock(m.createdAt)}</p>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

function Composer({ onSend, placeholder, disabled }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    try {
      await onSend(body);
      setText("");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex gap-2 border-t border-road-line p-2 dark:border-asphalt-500">
      <input
        className="input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        maxLength={2000}
        disabled={disabled}
        aria-label="Message"
      />
      <button className="btn-primary !px-3" disabled={busy || disabled || !text.trim()} aria-label="Send message">
        <Send size={16} />
      </button>
    </form>
  );
}

function Conversation({ tripId, scope, peerId, recipientId, empty, placeholder, disabled }) {
  const { user } = useAuth();
  const { messages, loading, send } = useChat(tripId, { scope, peerId });
  return (
    <>
      <MessageList messages={messages} selfId={user?.id} loading={loading} empty={empty} />
      <Composer onSend={(b) => send(b, recipientId)} placeholder={placeholder} disabled={disabled} />
    </>
  );
}

/**
 * Group chat for everyone; private chat is strictly admin ↔ member.
 * Members see one private thread (with the admin). Admins pick a member.
 */
export default function ChatPanel({ tripId, role, adminId, adminName, members = [], initialPeer = null, disabled }) {
  const [tab, setTab] = useState(initialPeer ? "private" : "group");
  const [peer, setPeer] = useState(initialPeer);
  const isAdmin = role === "ADMIN";

  useEffect(() => {
    if (initialPeer) {
      setPeer(initialPeer);
      setTab("private");
    }
  }, [initialPeer]);

  const peerName = useMemo(() => members.find((m) => m.userId === peer)?.name, [members, peer]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex gap-1 p-2" role="tablist">
        {[
          ["group", "Group chat"],
          ["private", isAdmin ? "Private" : `Message ${adminName ? adminName.split(" ")[0] : "admin"}`],
        ].map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`flex-1 rounded-control px-3 py-2 text-sm font-semibold ${tab === k ? "bg-asphalt text-white dark:bg-road dark:text-asphalt" : "muted hover:bg-asphalt/5 dark:hover:bg-white/5"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "group" && (
        <Conversation key="g" tripId={tripId} scope="group" empty="No messages yet. Say hi to the group." placeholder="Message everyone" disabled={disabled} />
      )}

      {tab === "private" && !isAdmin && (
        <Conversation key="pa" tripId={tripId} scope="private" peerId={adminId} recipientId={adminId} empty="Only you and the admin can see this conversation." placeholder="Message the admin privately" disabled={disabled} />
      )}

      {tab === "private" && isAdmin && !peer && (
        <ul className="flex-1 overflow-y-auto p-2">
          {members.length === 0 && <li className="p-4 text-center text-sm muted">No members to message yet.</li>}
          {members.map((m) => (
            <li key={m.userId}>
              <button onClick={() => setPeer(m.userId)} className="flex w-full items-center gap-3 rounded-control p-2 text-left hover:bg-road dark:hover:bg-asphalt-600">
                <Avatar id={m.userId} name={m.name} size={32} />
                <span className="text-sm font-medium">{m.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {tab === "private" && isAdmin && peer && (
        <>
          <button onClick={() => setPeer(null)} className="flex items-center gap-1 px-3 pb-1 text-sm font-semibold text-nh">
            <ChevronLeft size={16} /> {peerName || "Member"}
          </button>
          <Conversation key={`p${peer}`} tripId={tripId} scope="private" peerId={peer} recipientId={peer} empty={`Private conversation with ${peerName || "this member"}.`} placeholder={`Message ${peerName?.split(" ")[0] || "member"}`} disabled={disabled} />
        </>
      )}
    </div>
  );
}
