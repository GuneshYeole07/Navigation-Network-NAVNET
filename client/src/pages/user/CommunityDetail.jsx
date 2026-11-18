import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { CalendarDays, ChevronLeft, Megaphone } from "lucide-react";
import { communityService } from "../../services/communityService";
import { FullScreenLoader } from "../../components/ui/Skeleton";
import EmptyState from "../../components/ui/EmptyState";
import { TripStatusPill } from "../../components/ui/StatusPill";
import { formatDateTime, formatDistance, timeAgo } from "../../utils/format";
import { VEHICLE_TYPES } from "../../utils/constants";

export default function CommunityDetail() {
  const { id } = useParams();
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    communityService.get(id).then(setC).catch((e) => setError(e.message));
  }, [id]);

  const requestJoin = async () => {
    setBusy(true);
    try {
      await communityService.join(c.id, msg.trim() || undefined);
      setC((x) => ({ ...x, myStatus: "PENDING" }));
      toast.success("Request sent. The organiser will review it.");
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <EmptyState title="Community not found">{error}</EmptyState>;
  if (!c) return <FullScreenLoader label="Loading community" />;

  return (
    <div className="mx-auto max-w-4xl">
      <Link to="/user/communities" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-nh">
        <ChevronLeft size={16} /> All communities
      </Link>
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <p className="text-sm font-semibold text-nh">
            {c.category}
            {c.city ? `, ${c.city}` : ""}
          </p>
          <h1 className="text-5xl leading-none">{c.name}</h1>
          <p className="mt-3 leading-relaxed muted">{c.description}</p>
          <p className="mt-2 text-sm muted">
            Organised by {c.owner.name} · {c._count.members} {c._count.members === 1 ? "member" : "members"}
          </p>
        </div>
        <div className="panel w-full p-4 sm:w-72">
          {c.myStatus === "APPROVED" ? (
            <p className="text-sm">
              <span className="font-semibold text-nh">You're a member.</span> Ask the organiser for a trip's Group ID and password to ride along.
            </p>
          ) : c.myStatus === "PENDING" ? (
            <p className="text-sm">
              <span className="font-semibold">Request pending.</span> You'll be able to see member-only details once the organiser approves.
            </p>
          ) : (
            <div className="space-y-3">
              {c.myStatus === "REJECTED" && <p className="text-sm text-signal">Your earlier request was declined. You can ask again.</p>}
              <textarea className="input min-h-[72px]" placeholder="Say hi — what do you ride?" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={300} aria-label="Message to the organiser" />
              <button className="btn-primary w-full" onClick={requestJoin} disabled={busy}>
                {busy ? "Sending…" : "Request to join"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        <section>
          <h2 className="flex items-center gap-2 text-3xl">
            <CalendarDays size={22} /> Upcoming trips
          </h2>
          {c.trips.length === 0 ? (
            <p className="mt-3 text-sm muted">No trips scheduled right now.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {c.trips.map((t) => (
                <li key={t.id} className="panel p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="text-2xl leading-tight">{t.name}</h3>
                    <TripStatusPill status={t.status} />
                  </div>
                  <p className="mt-1 text-sm muted">{t.description}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                    <div>
                      <dt className="text-xs muted">Departs</dt>
                      <dd className="font-semibold">{formatDateTime(t.departureTime)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs muted">Route</dt>
                      <dd className="font-semibold">
                        {t.startName.split(",")[0]} to {t.destName.split(",")[0]}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs muted">Distance</dt>
                      <dd className="font-semibold">{formatDistance(t.routeDistance)}</dd>
                    </div>
                    <div>
                      <dt className="text-xs muted">Spots</dt>
                      <dd className="font-semibold">
                        {t._count.members}/{t.maxMembers} · {VEHICLE_TYPES[t.vehicleType]}
                      </dd>
                    </div>
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2 className="flex items-center gap-2 text-3xl">
            <Megaphone size={22} /> Announcements
          </h2>
          {c.announcements.length === 0 ? (
            <p className="mt-3 text-sm muted">Nothing announced yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {c.announcements.map((a) => (
                <li key={a.id} className="border-l-4 border-stone-cap pl-4">
                  <h3 className="text-xl leading-tight">{a.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm">{a.body}</p>
                  <p className="mt-1 text-xs muted">
                    {a.author.name} · {timeAgo(a.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
