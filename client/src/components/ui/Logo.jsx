import { Link } from "react-router-dom";

/** Mark: a kilometre stone. Wordmark set in the signage face. */
export default function Logo({ to = "/", className = "" }) {
  return (
    <Link to={to} className={`inline-flex items-center gap-2 ${className}`} aria-label="NavNet home">
      <svg viewBox="0 0 32 32" className="h-8 w-8" aria-hidden="true">
        <path d="M6 30V12a10 10 0 0 1 20 0v18z" fill="#fff" stroke="currentColor" strokeWidth="2" />
        <path d="M6 12a10 10 0 0 1 20 0z" fill="#F2B705" stroke="currentColor" strokeWidth="2" />
        <path d="M11 24h10" stroke="#0E6B4E" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
      <span className="font-display text-2xl font-bold tracking-tight">NavNet</span>
    </Link>
  );
}
