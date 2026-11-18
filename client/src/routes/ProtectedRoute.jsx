import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { FullScreenLoader } from "../components/ui/Skeleton";

/** Gate by session and (optionally) role. Wrong role → their own home. */
export default function ProtectedRoute({ role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullScreenLoader label="Checking your session" />;
  if (!user) return <Navigate to={`/login/${role === "ADMIN" ? "admin" : "user"}`} state={{ from: location }} replace />;
  if (role && user.role !== role) return <Navigate to={user.role === "ADMIN" ? "/admin" : "/user"} replace />;
  return <Outlet />;
}
