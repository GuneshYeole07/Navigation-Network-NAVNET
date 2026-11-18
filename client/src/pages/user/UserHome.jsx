import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users2, KeyRound } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { tripService } from "../../services/tripService";
import { TripStatusPill } from "../../components/ui/StatusPill";
import { formatDateTime } from "../../utils/format";

/** Rider home: exactly two options. Trips already joined surface inside "Join Trip". */
export default function UserHome() {
  const { user } = useAuth();
  const [joined, setJoined] = useState(null);
  useEffect(() => {
    tripService.joined().then(setJoined).catch(() => setJoined([]));
  }, []);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-5xl leading-none">Hi {user.name.split(" ")[0]}, where to?</h1>
      <p className="mt-2 muted">Join your group's trip, or find a riding community near you.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <section className="panel flex flex-col p-6">
          <span className="grid h-12 w-12 place-items-center rounded-control bg-nh text-white">
            <KeyRound size={24} aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-3xl">Join Trip</h2>
          <p className="mt-1 text-sm muted">Enter the Group ID and password your trip admin shared.</p>
          {joined?.length > 0 && (
            <ul className="mt-4 space-y-2">
              {joined.map((t) => (
                <li key={t.id}>
                  <Link to={`/user/trip/${t.id}`} className="flex items-center justify-between gap-3 rounded-control bg-road p-3 hover:bg-road-line dark:bg-asphalt-600 dark:hover:bg-asphalt-500">
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{t.name}</span>
                      <span className="text-xs muted">{formatDateTime(t.departureTime)}</span>
                    </span>
                    <TripStatusPill status={t.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link to="/user/join" className="btn-primary mt-auto self-start !mt-6">
            {joined?.length ? "Join another trip" : "Join a trip"}
          </Link>
        </section>

        <section className="panel flex flex-col p-6">
          <span className="grid h-12 w-12 place-items-center rounded-control bg-stone-cap text-asphalt">
            <Users2 size={24} aria-hidden="true" />
          </span>
          <h2 className="mt-4 text-3xl">Explore Community</h2>
          <p className="mt-1 text-sm muted">Riding clubs, cycling groups, trekkers and college travel clubs. See their upcoming trips and announcements.</p>
          <Link to="/user/communities" className="btn-secondary mt-auto self-start !mt-6">
            Browse communities
          </Link>
        </section>
      </div>
    </div>
  );
}
