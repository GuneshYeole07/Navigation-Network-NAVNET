import { useState } from "react";
import { BatteryWarning, X } from "lucide-react";
import { BackgroundGeolocation, isNativeApp, platform } from "../../native/platform";

const KEY = "navnet-battery-guide-done";

/**
 * Android kills background apps to save battery, which is the #1 reason a rider "freezes" on
 * the map. Shown once in the Android app while sharing; the browser can't change this.
 */
export default function BatteryGuide({ sharing }) {
  const [done, setDone] = useState(() => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch {
      return false;
    }
  });
  if (!isNativeApp || platform !== "android" || !sharing || done) return null;
  const close = () => {
    try {
      localStorage.setItem(KEY, "1");
    } catch {
      /* private mode */
    }
    setDone(true);
  };
  return (
    <div className="card relative border-l-4 border-signal p-4 text-sm">
      <button className="absolute right-2 top-2 p-1 opacity-60" onClick={close} aria-label="Dismiss">
        <X size={16} />
      </button>
      <div className="flex items-center gap-2 font-semibold">
        <BatteryWarning size={18} /> Keep tracking alive with the screen off
      </div>
      <ol className="mt-2 list-decimal space-y-1 pl-5">
        <li>Open app settings below, then Battery, and choose Unrestricted (or "Don't optimise").</li>
        <li>Location permission: Allow all the time.</li>
        <li>Xiaomi, Oppo, Vivo, Realme: also turn on Autostart and lock NavNet in recent apps.</li>
      </ol>
      <div className="mt-3 flex gap-2">
        <button className="btn-primary" onClick={() => BackgroundGeolocation.openSettings?.().catch?.(() => {})}>
          Open app settings
        </button>
        <button className="btn-ghost" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}
