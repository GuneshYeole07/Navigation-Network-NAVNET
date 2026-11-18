import { useEffect, useRef, useState } from "react";
import { Timer } from "lucide-react";
import { speak } from "../../utils/voice";

/** "Leaving in 08:32" — with spoken reminders at 5 min, 1 min and departure. */
export default function Countdown({ departAt, className = "" }) {
  const [now, setNow] = useState(Date.now());
  const said = useRef(new Set());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = departAt ? Math.round((new Date(departAt).getTime() - now) / 1000) : null;
  useEffect(() => {
    said.current = new Set();
  }, [departAt]);
  useEffect(() => {
    if (left == null) return;
    for (const [at, text] of [
      [300, "Five minutes to departure."],
      [60, "One minute. Helmets on."],
      [0, "Time to ride. Let's go."],
    ]) {
      if (left <= at && left > at - 5 && !said.current.has(at)) {
        said.current.add(at);
        speak(text, { urgent: at === 0 });
      }
    }
  }, [left]);
  if (left == null) return null;
  const late = left <= 0;
  const mm = String(Math.floor(Math.abs(left) / 60)).padStart(2, "0");
  const ss = String(Math.abs(left) % 60).padStart(2, "0");
  return (
    <span className={`chip !px-3 !py-1.5 text-sm ${late ? "bg-signal text-white" : left <= 300 ? "bg-stone-cap text-asphalt" : "bg-asphalt text-white"} ${className}`} role="timer" aria-live="off">
      <Timer size={14} /> {late ? `Time to ride (${mm}:${ss} ago)` : `Leaving in ${mm}:${ss}`}
    </span>
  );
}
