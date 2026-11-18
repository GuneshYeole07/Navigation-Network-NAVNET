import { initials, memberColor } from "../../utils/format";

export default function Avatar({ id, name, size = 36, className = "" }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-display font-bold text-white ${className}`}
      style={{ width: size, height: size, background: memberColor(id), fontSize: size * 0.4 }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}
