import { Link } from "react-router-dom";
import Milestone from "../components/ui/Milestone";

export default function NotFound() {
  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="flex flex-col items-center text-center">
        <Milestone place="Nowhere" value="404" unit="page" size="lg" />
        <h1 className="mt-6 text-4xl">Wrong turn</h1>
        <p className="mt-2 muted">This road doesn't go anywhere. Head back to a known route.</p>
        <Link to="/" className="btn-primary mt-6">
          Go to NavNet home
        </Link>
      </div>
    </div>
  );
}
