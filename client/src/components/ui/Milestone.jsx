/**
 * The Indian kilometre stone — NavNet's signature element.
 * Yellow cap carries the place; white body carries the number.
 */
export default function Milestone({ place, value, unit = "km", size = "md", className = "", label }) {
  const s = {
    sm: { r: 32, w: "w-16", cap: "h-7 text-[10px]", num: "text-2xl", unit: "text-[10px]", body: "pb-2 pt-1" },
    md: { r: 48, w: "w-24", cap: "h-10 text-xs", num: "text-4xl", unit: "text-xs", body: "pb-3 pt-1.5" },
    lg: { r: 64, w: "w-32", cap: "h-14 text-sm", num: "text-6xl", unit: "text-sm", body: "pb-4 pt-2" },
  }[size];
  return (
    <figure
      className={`${s.w} shrink-0 overflow-hidden border-2 border-asphalt bg-white text-center text-asphalt dark:border-road/80 ${className}`}
      style={{ borderRadius: `${s.r}px ${s.r}px 6px 6px` }}
      aria-label={label || `${value} ${unit} to ${place}`}
    >
      <div className={`${s.cap} flex items-end justify-center bg-stone-cap px-2 pb-1 font-display font-bold leading-none`}>
        <span className="truncate">{place}</span>
      </div>
      <div className={`border-t-2 border-asphalt dark:border-road/80 ${s.body}`}>
        <div className={`${s.num} font-display font-bold leading-none text-nh`}>{value}</div>
        <div className={`${s.unit} font-semibold text-asphalt/70`}>{unit}</div>
      </div>
    </figure>
  );
}
