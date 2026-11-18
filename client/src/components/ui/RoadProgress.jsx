/** Progress bar drawn as a road: asphalt track, dashed centre line, green travelled section. */
export default function RoadProgress({ percent = 0, label = "Trip progress" }) {
  const p = Math.max(0, Math.min(100, percent));
  return (
    <div
      className="relative h-3 overflow-hidden rounded-full bg-asphalt-600"
      role="progressbar"
      aria-valuenow={Math.round(p)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div
        className="absolute inset-y-[5px] left-0 right-0"
        style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(255,255,255,.55) 0 10px, transparent 10px 20px)" }}
      />
      <div className="absolute inset-y-0 left-0 rounded-full bg-nh-400 transition-[width] duration-700" style={{ width: `${p}%` }} />
    </div>
  );
}
