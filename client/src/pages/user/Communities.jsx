import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, Compass, Search } from "lucide-react";
import { communityService } from "../../services/communityService";
import { useDebounce } from "../../hooks/useDebounce";
import CommunityCard from "../../components/community/CommunityCard";
import { Skeleton } from "../../components/ui/Skeleton";
import EmptyState from "../../components/ui/EmptyState";

const CATEGORIES = ["All", "Motorcycling", "Road Trips", "Cycling", "Trekking", "College"];

export default function Communities() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const q = useDebounce(search, 300);

  useEffect(() => {
    let alive = true;
    setItems(null);
    communityService
      .list({ search: q || undefined, category: category === "All" ? undefined : category })
      .then((r) => alive && setItems(r))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [q, category]);

  return (
    <div>
      <Link to="/user" className="mb-4 inline-flex items-center gap-1 text-sm font-semibold text-nh">
        <ChevronLeft size={16} /> Back
      </Link>
      <h1 className="text-5xl leading-none">Communities</h1>
      <p className="mt-2 muted">Find people who ride, cycle and trek the routes you love.</p>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative sm:w-80">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
          <input className="input pl-9" placeholder="Search by name or city" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search communities" />
        </div>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Filter by category">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={category === c}
              onClick={() => setCategory(c)}
              className={`chip !px-3 !py-1.5 text-sm ${category === c ? "bg-asphalt text-white dark:bg-road dark:text-asphalt" : "bg-white ring-1 ring-road-line dark:bg-asphalt-700 dark:ring-asphalt-500"}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6">
        {error ? (
          <EmptyState icon={Compass} title="Couldn't load communities">{error}</EmptyState>
        ) : items === null ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-60 !rounded-sheet" />
            ))}
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Compass} title="No communities match">
            Try another search or category.
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <CommunityCard key={c.id} c={c} to={`/user/communities/${c.slug}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
