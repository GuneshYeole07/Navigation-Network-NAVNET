import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Bike, ShieldCheck } from "lucide-react";
import Logo from "../components/ui/Logo";
import ThemeToggle from "../components/ui/ThemeToggle";
import { useAuth } from "../context/AuthContext";

// One ghat road, drawn once; the convoy rides it. This is the page's single motion moment.
const ROAD = "M -20 330 C 120 300, 160 200, 290 210 S 450 330, 560 250 S 690 90, 820 120";
const RIDERS = [
  { delay: 0, color: "#F2B705", r: 9 }, // leader
  { delay: 0.55, color: "#ffffff", r: 7 },
  { delay: 1.0, color: "#ffffff", r: 7 },
  { delay: 1.4, color: "#ffffff", r: 7 },
  { delay: 1.9, color: "#9fd9c3", r: 7 },
];

function ConvoyRoad() {
  const reduce = useReducedMotion();
  return (
    <svg viewBox="0 0 800 400" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {/* hills */}
      <path d="M0 260 L120 150 L200 210 L330 90 L450 200 L560 120 L700 210 L800 160 V400 H0 Z" fill="#0A5640" />
      <path d="M0 320 L150 230 L260 290 L400 200 L520 280 L650 220 L800 270 V400 H0 Z" fill="#08402F" />
      {/* road */}
      <path d={ROAD} fill="none" stroke="#1C2226" strokeWidth="30" strokeLinecap="round" />
      <path d={ROAD} fill="none" stroke="#F5F7F4" strokeWidth="2.5" strokeDasharray="14 14" opacity=".7" />
      {RIDERS.map((r, i) =>
        reduce ? (
          <circle key={i} r={r.r} fill={r.color} stroke="#1C2226" strokeWidth="3" cx={560 - i * 40} cy={250 + i * 10} />
        ) : (
          <circle key={i} r={r.r} fill={r.color} stroke="#1C2226" strokeWidth="3">
            <animateMotion dur="9s" begin={`${r.delay}s`} repeatCount="indefinite" path={ROAD} keyPoints="0;1" keyTimes="0;1" calcMode="linear" />
          </circle>
        ),
      )}
    </svg>
  );
}

function SignButton({ to, title, sub, icon: Icon, tone }) {
  const styles =
    tone === "admin"
      ? "bg-white text-asphalt hover:bg-road ring-2 ring-white"
      : "bg-nh text-white hover:bg-nh-700 ring-2 ring-white";
  return (
    <Link to={to} className={`group flex items-center gap-4 rounded-control px-5 py-4 shadow-float transition-colors ${styles}`}>
      <Icon size={28} aria-hidden="true" className="shrink-0" />
      <span className="flex-1">
        <span className="block font-display text-2xl font-bold leading-none">{title}</span>
        <span className="mt-1 block text-sm opacity-80">{sub}</span>
      </span>
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0 transition-transform group-hover:translate-x-1">
        <path d="M4 12h13M12 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

export default function Landing() {
  const { user, logout } = useAuth();
  return (
    <div className="relative flex min-h-full flex-col overflow-hidden bg-nh-800 text-white">
      <ConvoyRoad />
      <div className="absolute inset-0 bg-gradient-to-r from-nh-800/95 via-nh-800/70 to-transparent" aria-hidden="true" />

      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5">
        <Logo className="text-white" />
        <ThemeToggle className="!text-white hover:!bg-white/10" />
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-6xl flex-1 items-center px-5 pb-16">
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="max-w-xl">
          <h1 className="font-display text-6xl font-bold leading-[0.95] sm:text-7xl">
            Leave together.
            <br />
            Arrive together.
          </h1>
          <p className="mt-5 max-w-md text-lg leading-relaxed text-white/85">
            One map for the whole convoy. Everyone sees the route, the stops and each other — and the trip admin sees who's falling behind before anyone gets lost.
          </p>

          <div className="mt-9 grid max-w-md gap-3">
            {user ? (
              <SignButton
                to={user.role === "ADMIN" ? "/admin" : "/user"}
                title={`Continue as ${user.name.split(" ")[0]}`}
                sub={user.role === "ADMIN" ? "Open your admin dashboard" : "Open your rider dashboard"}
                icon={user.role === "ADMIN" ? ShieldCheck : Bike}
                tone={user.role === "ADMIN" ? "admin" : "user"}
              />
            ) : null}
            {user ? (
              <button onClick={logout} className="justify-self-start text-sm text-white/75 underline-offset-4 hover:text-white hover:underline">
                Not {user.name.split(" ")[0]}? Sign out
              </button>
            ) : (
              <>
                <SignButton to="/login/user" title="Login as User" sub="Join a trip with a Group ID and ride with your group" icon={Bike} tone="user" />
                <SignButton to="/login/admin" title="Login as Admin" sub="Plan routes, run the convoy, respond to SOS" icon={ShieldCheck} tone="admin" />
              </>
            )}
          </div>
        </motion.div>
      </main>

      <footer className="relative z-10 mx-auto w-full max-w-6xl px-5 pb-5 text-xs text-white/60">
        Maps and routing by OpenStreetMap, OSRM and OpenRouteService.
      </footer>
    </div>
  );
}
