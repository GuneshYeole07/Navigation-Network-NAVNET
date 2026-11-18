import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { BarChart3, Bike, Bus, Car, ChevronLeft, Footprints, Radar, Users } from "lucide-react";

const VEHICLE_ICON = { BIKE: Bike, BICYCLE: Bike, CAR: Car, BUS: Bus, WALKING: Footprints, MIXED: Users };
import { tripService } from "../../services/tripService";
import { ListSkeleton } from "../../components/ui/Skeleton";
import EmptyState from "../../components/ui/EmptyState";
import { TripStatusPill } from "../../components/ui/StatusPill";
import { formatDateTime, formatDistance } from "../../utils/format";
import { assetUrl } from "../../services/api";

const GROUPS = [
  ["Live now", ["ACTIVE", "PAUSED"]],
  ["Upcoming", ["PLANNED"]],
  ["Past", ["COMPLETED", "CANCELLED"]],
];

export default function MonitoringList() {
  const navigate = useNavigate();
  const [trips, setTrips] = useState(null);
  useEffect(() => {
    tripService.mine().then(setTrips).catch(() => setTrips([]));
  }, []);

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-nh">
        <ChevronLeft size={16} /> Admin dashboard
      </Link>
      <h1 className="text-5xl leading-none">Group monitoring</h1>
      <p className="mt-2 muted">Open a trip to watch the convoy live, message riders and respond to alerts.</p>

      <div className="mt-8 space-y-8">
        {trips === null && <ListSkeleton rows={3} />}
        {trips?.length === 0 && (
          <EmptyState icon={Radar} title="No trips yet" action={<Link to="/admin/create-group" className="btn-primary">Create a group</Link>}>
            Create a group and share its Group ID. Riders appear here as soon as they join.
          </EmptyState>
        )}
        {trips?.length > 0 &&
          GROUPS.map(([label, statuses]) => {
            const list = trips.filter((t) => statuses.includes(t.status));
            if (!list.length) return null;
            return (
              <section key={label}>
                <h2 className="mb-3 text-2xl">{label}</h2>
                <ul className="space-y-3">
                  {list.map((t) => (
                    <li key={t.id} className="panel flex items-center gap-4 p-4">
                      <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-control bg-nh-50 text-nh dark:bg-nh/20 dark:text-nh-100">
                        {t.imageUrl ? (
                          <img src={assetUrl(t.imageUrl)} alt="" className="h-full w-full object-cover" />
                        ) : (
                          (() => {
                            const Icon = VEHICLE_ICON[t.vehicleType] || Bike;
                            return <Icon size={24} aria-hidden="true" />;
                          })()
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-xl leading-tight">{t.name}</h3>
                          <TripStatusPill status={t.status} />
                        </div>
                        <p className="text-sm muted">
                          {formatDateTime(t.departureTime)} · {formatDistance(t.routeDistance)} · {t._count.members}/{t.maxMembers} riders · ID{" "}
                          <span className="font-display font-semibold text-asphalt dark:text-road">{t.groupCode}</span>
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
                        {(t.status === "COMPLETED" || t.status === "CANCELLED") && (
                          <Link to={`/trips/${t.id}/report`} className="btn-secondary !px-3" aria-label={`Analytics for ${t.name}`}>
                            <BarChart3 size={16} /> <span className="hidden sm:inline">Analytics</span>
                          </Link>
                        )}
                        {(t.status === "PLANNED" || t.status === "ACTIVE" || t.status === "PAUSED") && (
                          <button
                            className="btn-secondary !px-3"
                            title="Ride along with captain tools on your phone"
                            onClick={() =>
                              tripService
                                .ride(t.id)
                                .then(() => navigate(`/admin/ride/${t.id}`))
                                .catch((e) => toast.error(e.message))
                            }
                          >
                            <Bike size={16} /> <span className="hidden sm:inline">Ride</span>
                          </button>
                        )}
                        <Link to={`/admin/monitor/${t.id}`} className="btn-primary !px-3">
                          <Radar size={16} /> <span className="hidden sm:inline">{t.status === "COMPLETED" || t.status === "CANCELLED" ? "View" : "Monitor"}</span>
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
      </div>
    </div>
  );
}
