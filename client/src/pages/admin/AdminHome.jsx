import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Radar, Route, Users2 } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { tripService } from "../../services/tripService";

/** Admin home: exactly three primary options. Live count rides on the monitoring tile. */
export default function AdminHome() {
  const { user } = useAuth();
  const [trips, setTrips] = useState(null);
  useEffect(() => {
    tripService.mine().then(setTrips).catch(() => setTrips([]));
  }, []);
  const live = trips?.filter((t) => t.status === "ACTIVE" || t.status === "PAUSED").length ?? 0;
  const upcoming = trips?.filter((t) => t.status === "PLANNED").length ?? 0;

  const tiles = [
    { to: "/admin/create-group", icon: Route, title: "Create Group", body: "Plan a route with waypoints and checkpoints, then set the Group ID riders use to join.", tone: "bg-nh text-white" },
    { to: "/admin/create-community", icon: Users2, title: "Create Community", body: "Start a public club, approve join requests and post announcements.", tone: "bg-stone-cap text-asphalt" },
    {
      to: "/admin/monitor",
      icon: Radar,
      title: "Group Monitoring Panel",
      body: trips === null ? "Loading your trips…" : live ? `${live} trip${live > 1 ? "s" : ""} on the road now · ${upcoming} upcoming` : `${upcoming} upcoming trip${upcoming === 1 ? "" : "s"} · none live right now`,
      tone: "bg-asphalt text-white dark:bg-road dark:text-asphalt",
      live,
    },
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-5xl leading-none">Admin dashboard</h1>
      <p className="mt-2 muted">Signed in as {user.name}.</p>
      <div className="mt-8 grid gap-4 md:grid-cols-3">
        {tiles.map(({ to, icon: Icon, title, body, tone, live: isLive }) => (
          <Link key={to} to={to} className="panel group flex flex-col p-6 transition-shadow hover:shadow-float">
            <span className={`relative grid h-12 w-12 place-items-center rounded-control ${tone}`}>
              <Icon size={24} aria-hidden="true" />
              {isLive > 0 && <span className="absolute -right-1 -top-1 h-3.5 w-3.5 rounded-full bg-signal ring-2 ring-white dark:ring-asphalt-700" aria-label="Live trips" />}
            </span>
            <h2 className="mt-4 text-3xl leading-tight">{title}</h2>
            <p className="mt-1 text-sm muted">{body}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
