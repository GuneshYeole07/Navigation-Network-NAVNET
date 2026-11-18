import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Check, ChevronLeft, X } from "lucide-react";
import Field from "../../components/ui/Field";
import { communityService } from "../../services/communityService";
import { geoService } from "../../services/geoService";
import { formatDateTime } from "../../utils/format";

function ManageCommunity({ c, onClose }) {
  const [requests, setRequests] = useState(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    communityService.requests(c.id).then(setRequests).catch((e) => toast.error(e.message));
  }, [c.id]);

  const decide = async (r, decision) => {
    try {
      await communityService.decide(c.id, r.id, decision);
      setRequests((list) => list.map((x) => (x.id === r.id ? { ...x, status: decision } : x)));
      toast.success(decision === "APPROVED" ? `${r.user.name} approved` : "Request declined");
    } catch (e) {
      toast.error(e.message);
    }
  };

  const post = async (e) => {
    e.preventDefault();
    setPosting(true);
    try {
      await communityService.announce(c.id, { title, body });
      setTitle("");
      setBody("");
      toast.success("Announcement posted");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPosting(false);
    }
  };

  const pending = requests?.filter((r) => r.status === "PENDING") ?? [];
  const decided = requests?.filter((r) => r.status !== "PENDING") ?? [];

  return (
    <div className="panel space-y-6 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-3xl leading-tight">{c.name}</h2>
          <p className="text-sm muted">
            {c.category}
            {c.city ? `, ${c.city}` : ""}
          </p>
        </div>
        <button className="btn-ghost !p-2" onClick={onClose} aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <section>
        <h3 className="text-xl">Join requests</h3>
        {requests === null ? (
          <p className="mt-2 text-sm muted">Loading…</p>
        ) : pending.length === 0 ? (
          <p className="mt-2 text-sm muted">No pending requests.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {pending.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-control bg-road p-3 dark:bg-asphalt-600">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">{r.user.name}</p>
                  <p className="text-xs muted">
                    {r.user.email}
                    {r.user.vehicleNumber ? ` · ${r.user.vehicleNumber}` : ""}
                  </p>
                  {r.message && <p className="mt-1">“{r.message}”</p>}
                </div>
                <button className="btn-primary !px-2.5 !py-1.5" onClick={() => decide(r, "APPROVED")} aria-label={`Approve ${r.user.name}`}>
                  <Check size={15} />
                </button>
                <button className="btn-secondary !px-2.5 !py-1.5" onClick={() => decide(r, "REJECTED")} aria-label={`Decline ${r.user.name}`}>
                  <X size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {decided.length > 0 && (
          <p className="mt-2 text-xs muted">
            {decided.filter((r) => r.status === "APPROVED").length} approved · {decided.filter((r) => r.status === "REJECTED").length} declined
          </p>
        )}
      </section>

      <form onSubmit={post} className="space-y-3">
        <h3 className="text-xl">Post an announcement</h3>
        <input className="input" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} minLength={3} maxLength={120} required aria-label="Announcement title" />
        <textarea className="input min-h-[90px]" placeholder="What members need to know" value={body} onChange={(e) => setBody(e.target.value)} required maxLength={3000} aria-label="Announcement text" />
        <button className="btn-primary" disabled={posting}>
          {posting ? "Posting…" : "Post announcement"}
        </button>
      </form>
    </div>
  );
}

export default function CreateCommunity() {
  const [owned, setOwned] = useState(null);
  const [managing, setManaging] = useState(null);
  const [cover, setCover] = useState(null);
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: { category: "Motorcycling", isPublic: true } });

  const load = () => communityService.owned().then(setOwned).catch(() => setOwned([]));
  useEffect(() => {
    load();
  }, []);

  const onSubmit = async (v) => {
    try {
      const c = await communityService.create({ ...v, coverImage: cover, isPublic: !!v.isPublic });
      toast.success(`${c.name} created`);
      reset();
      setCover(null);
      load();
    } catch (e) {
      toast.error(e.message);
    }
  };

  return (
    <div>
      <Link to="/admin" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-nh">
        <ChevronLeft size={16} /> Admin dashboard
      </Link>
      <h1 className="text-5xl leading-none">Create community</h1>
      <p className="mt-2 muted">Communities help riders find you, see upcoming trips and follow announcements.</p>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <form onSubmit={handleSubmit(onSubmit)} className="panel space-y-4 p-5" noValidate>
          <Field label="Name" placeholder="Pune Riders" error={errors.name?.message} {...register("name", { required: "Name the community", minLength: { value: 3, message: "At least 3 characters" } })} />
          <Field as="textarea" label="Description" placeholder="Who it's for and how you ride" error={errors.description?.message} {...register("description", { required: "Add a description", minLength: { value: 10, message: "At least 10 characters" } })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="City" placeholder="Pune" {...register("city")} />
            <Field as="select" label="Category" {...register("category")}>
              {["Motorcycling", "Road Trips", "Cycling", "Trekking", "College", "Tourism", "General"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Field>
          </div>
          <div>
            <span className="field-label">Cover image (optional)</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="block text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  setCover((await geoService.uploadImage(f)).url);
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[#0E6B4E]" {...register("isPublic")} /> Visible in Explore Community
          </label>
          <button className="btn-primary w-full" disabled={isSubmitting}>
            {isSubmitting ? "Creating…" : "Create community"}
          </button>
        </form>

        <div className="space-y-4">
          {managing ? (
            <ManageCommunity c={managing} onClose={() => (setManaging(null), load())} />
          ) : (
            <section>
              <h2 className="text-2xl">Your communities</h2>
              {owned === null ? (
                <p className="mt-2 text-sm muted">Loading…</p>
              ) : owned.length === 0 ? (
                <p className="mt-2 text-sm muted">You haven't created any communities yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {owned.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => setManaging(c)} className="panel flex w-full items-center gap-3 p-4 text-left hover:shadow-float">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold">{c.name}</p>
                          <p className="text-xs muted">
                            {c.category} · {c._count.trips} trips · created {formatDateTime(c.createdAt)}
                          </p>
                        </div>
                        {c._count.members > 0 && <span className="chip bg-stone-cap text-asphalt">{c._count.members} pending</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
