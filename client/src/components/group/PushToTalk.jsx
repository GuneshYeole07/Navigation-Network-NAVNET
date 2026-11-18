import { useCallback, useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import toast from "react-hot-toast";
import { tripService } from "../../services/tripService";

const MAX_MS = 20000;
const queueKey = (tripId) => `navnet-outbox-voice-${tripId}`;

function pickMime() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) {
    if (MediaRecorder.isTypeSupported?.(t)) return t;
  }
  return "";
}

const toB64 = (blob) =>
  new Promise((res) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
const fromB64 = async (dataUrl) => (await fetch(dataUrl)).blob();

/**
 * Walkie-talkie for riders: hold to talk (≤ 20 s), release to send to the whole group.
 * Recorded with no network → saved on the phone and sent when signal returns.
 */
export default function PushToTalk({ tripId, connected, disabled }) {
  const [state, setState] = useState("idle"); // idle | starting | recording | sending
  const [secs, setSecs] = useState(0);
  const rec = useRef(null);
  const stream = useRef(null);
  const started = useRef(0);
  const chunks = useRef([]);
  const timer = useRef(null);
  const supported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && pickMime() !== null;

  const upload = useCallback(
    async (blob, ms) => {
      if (!connected) {
        try {
          const list = JSON.parse(localStorage.getItem(queueKey(tripId)) || "[]").slice(-4);
          list.push({ data: await toB64(blob), ms });
          localStorage.setItem(queueKey(tripId), JSON.stringify(list));
          toast("No network. Voice message will send when you're back online.", { icon: "📶" });
        } catch {
          toast.error("Couldn't save the voice message offline");
        }
        return;
      }
      setState("sending");
      try {
        await tripService.voice(tripId, blob, ms);
      } catch (e) {
        toast.error(`Voice message failed: ${e.message}`);
      } finally {
        setState("idle");
      }
    },
    [connected, tripId],
  );

  // Flush clips recorded offline.
  useEffect(() => {
    if (!connected) return;
    let list;
    try {
      list = JSON.parse(localStorage.getItem(queueKey(tripId)) || "[]");
    } catch {
      list = [];
    }
    if (!list.length) return;
    localStorage.removeItem(queueKey(tripId));
    (async () => {
      for (const c of list) {
        try {
          await tripService.voice(tripId, await fromB64(c.data), c.ms);
        } catch {
          /* drop silently: stale clip */
        }
      }
      toast.success(`${list.length} queued voice message(s) sent`);
    })();
  }, [connected, tripId]);

  const stop = useCallback(() => {
    clearInterval(timer.current);
    if (rec.current && rec.current.state === "recording") rec.current.stop();
  }, []);

  const start = useCallback(async () => {
    if (disabled || state !== "idle") return;
    setState("starting");
    try {
      if (!stream.current || !stream.current.active) {
        stream.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      }
      const mime = pickMime();
      const r = new MediaRecorder(stream.current, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
      chunks.current = [];
      r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
      r.onstop = () => {
        const ms = Date.now() - started.current;
        setState("idle");
        setSecs(0);
        if (ms < 700) {
          toast("Hold the button while you talk", { icon: "🎙" });
          return;
        }
        upload(new Blob(chunks.current, { type: r.mimeType || mime || "audio/webm" }), ms);
      };
      rec.current = r;
      started.current = Date.now();
      r.start();
      setState("recording");
      try {
        navigator.vibrate?.(40);
      } catch {
        /* ignore */
      }
      timer.current = setInterval(() => {
        const ms = Date.now() - started.current;
        setSecs(Math.floor(ms / 1000));
        if (ms >= MAX_MS) stop();
      }, 250);
    } catch {
      setState("idle");
      toast.error("Microphone blocked. Allow mic access in your browser settings to use push-to-talk.");
    }
  }, [disabled, state, stop, upload]);

  useEffect(
    () => () => {
      clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  if (!supported) return null;
  const recording = state === "recording";
  return (
    <button
      type="button"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => (e.key === " " || e.key === "Enter") && !e.repeat && start()}
      onKeyUp={(e) => (e.key === " " || e.key === "Enter") && stop()}
      onContextMenu={(e) => e.preventDefault()}
      disabled={disabled}
      className={`relative grid h-16 w-16 select-none place-items-center rounded-full shadow-float [touch-action:none] ${recording ? "scale-110 bg-signal text-white" : "bg-nh text-white"} transition-transform`}
      aria-label={recording ? `Recording, ${secs} seconds. Release to send` : "Push to talk: hold to send a voice message to the group"}
      aria-pressed={recording}
    >
      <Mic size={26} />
      {recording && <span className="absolute -top-7 rounded-full bg-signal px-2 py-0.5 font-display text-sm font-bold text-white">{secs}s</span>}
      {state === "sending" && <span className="absolute -top-7 rounded-full bg-asphalt px-2 py-0.5 text-xs text-white">Sending…</span>}
    </button>
  );
}
