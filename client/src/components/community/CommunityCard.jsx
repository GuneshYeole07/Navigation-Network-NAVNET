import { Link } from "react-router-dom";
import { MapPin, Users } from "lucide-react";
import { assetUrl } from "../../services/api";

const JOIN_LABEL = { APPROVED: "Member", PENDING: "Request pending", REJECTED: "Request declined" };

export default function CommunityCard({ c, to }) {
  return (
    <Link to={to} className="panel group flex flex-col overflow-hidden transition-shadow hover:shadow-float">
      <div className="relative h-24 bg-nh-700">
        {c.coverImage ? (
          <img src={assetUrl(c.coverImage)} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="h-full w-full" aria-hidden="true">
            <path d="M0 70 L60 35 L110 60 L170 20 L230 55 L300 30 V100 H0Z" fill="#0A5640" />
            <path d="M0 85 L80 60 L150 80 L220 55 L300 75 V100 H0Z" fill="#08402F" />
          </svg>
        )}
        <span className="chip absolute left-3 top-3 bg-white/90 text-asphalt">{c.category}</span>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <h3 className="text-2xl leading-tight">{c.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm muted">{c.description}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-xs muted">
          {c.city && (
            <span className="inline-flex items-center gap-1">
              <MapPin size={12} /> {c.city}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users size={12} /> {c._count?.members ?? 0} {c._count?.members === 1 ? "member" : "members"}
          </span>
          <span>{c._count?.trips ?? 0} {c._count?.trips === 1 ? "trip" : "trips"}</span>
          {c.myStatus && <span className="chip bg-nh-50 text-nh dark:bg-nh/20 dark:text-nh-100">{JOIN_LABEL[c.myStatus]}</span>}
        </div>
      </div>
    </Link>
  );
}
