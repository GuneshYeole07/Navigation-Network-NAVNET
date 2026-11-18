import { MEMBER_STATUS, TRIP_STATUS } from "../../utils/constants";

export function MemberStatusPill({ status }) {
  const m = MEMBER_STATUS[status] || MEMBER_STATUS.OFFLINE;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${m.text}`}>
      <span className={`h-2 w-2 rounded-full ${m.dot}`} aria-hidden="true" />
      {m.label}
    </span>
  );
}

export function TripStatusPill({ status }) {
  const t = TRIP_STATUS[status] || TRIP_STATUS.PLANNED;
  return <span className={`chip ${t.cls}`}>{t.label}</span>;
}
