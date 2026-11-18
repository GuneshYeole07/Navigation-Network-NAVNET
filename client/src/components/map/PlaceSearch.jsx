import { useEffect, useRef, useState } from "react";
import { MapPin, Search } from "lucide-react";
import { geoService } from "../../services/geoService";
import { useDebounce } from "../../hooks/useDebounce";

/** Nominatim-backed place search with keyboard navigation. */
export default function PlaceSearch({ placeholder = "Search a place", onPick, value, className = "", near, clearOnPick = false, label, autoFocus = false }) {
  const [q, setQ] = useState(value || "");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [active, setActive] = useState(-1);
  const debounced = useDebounce(q, 450);
  const picked = useRef(false);

  useEffect(() => {
    setQ(value || "");
  }, [value]);

  useEffect(() => {
    if (picked.current) {
      picked.current = false;
      return;
    }
    if (debounced.trim().length < 3) return setResults([]);
    let alive = true;
    setBusy(true);
    geoService
      .search(debounced, near)
      .then((r) => {
        if (!alive) return;
        setResults(r);
        setErr(null);
        setOpen(true);
        setActive(-1);
      })
      .catch((e) => alive && setErr(e.message))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [debounced]);

  const pick = (r) => {
    picked.current = true;
    setQ(clearOnPick ? "" : r.shortName);
    setResults(clearOnPick ? [] : results);
    setOpen(false);
    onPick?.({ name: r.shortName, fullName: r.name, lat: r.lat, lng: r.lng, type: r.type });
  };

  const onKey = (e) => {
    if (!open || !results.length) return;
    if (e.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
    else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (e.key === "Enter") {
      e.preventDefault();
      pick(results[Math.max(0, active)]);
    } else if (e.key === "Escape") setOpen(false);
    else return;
    e.preventDefault();
  };

  return (
    <div className={`relative ${className}`}>
      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" aria-hidden="true" />
      <input
        className="input pl-9"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => results.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={onKey}
        role="combobox"
        aria-label={label || placeholder}
        autoFocus={autoFocus}
        enterKeyHint="search"
        aria-expanded={open}
        aria-autocomplete="list"
      />
      {busy && <span className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin rounded-full border-2 border-nh/20 border-t-nh" />}
      {err && <p className="field-error">{err}</p>}
      {open && !busy && !err && results.length === 0 && debounced.trim().length >= 3 && q === debounced && (
        <p className="absolute z-[1100] mt-1 w-full rounded-control bg-white px-3 py-2 text-sm shadow-float ring-1 ring-road-line dark:bg-asphalt-700 dark:ring-asphalt-500">
          No places found. Try a nearby town or landmark, or tap the map.
        </p>
      )}
      {open && results.length > 0 && (
        <ul role="listbox" className="absolute z-[1100] mt-1 max-h-72 w-full overflow-auto rounded-control bg-white py-1 shadow-float ring-1 ring-road-line dark:bg-asphalt-700 dark:ring-asphalt-500">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(r)}
                className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-road dark:hover:bg-asphalt-600 ${i === active ? "bg-road dark:bg-asphalt-600" : ""}`}
              >
                <MapPin size={15} className="mt-0.5 shrink-0 text-nh" />
                <span>
                  <span className="block font-medium">{r.shortName}</span>
                  <span className="line-clamp-1 text-xs muted">{r.name}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
