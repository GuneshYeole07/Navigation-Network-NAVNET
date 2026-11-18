import { Outlet, useNavigate } from "react-router-dom";
import { LogOut, UserRound } from "lucide-react";
import { Link } from "react-router-dom";
import Logo from "../components/ui/Logo";
import ThemeToggle from "../components/ui/ThemeToggle";
import { useAuth } from "../context/AuthContext";

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const home = user?.role === "ADMIN" ? "/admin" : "/user";
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-[500] border-b border-road-line bg-road/90 backdrop-blur dark:border-asphalt-600 dark:bg-asphalt/90">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4">
          <Logo to={home} />
          <div className="flex items-center gap-1">
            <span className="mr-2 hidden text-sm muted sm:inline">
              {user?.name} · {user?.role === "ADMIN" ? "Admin" : "Rider"}
            </span>
            <Link to="/profile" className="btn-ghost !p-2" aria-label="Profile and emergency card" title="Profile & emergency card">
              <UserRound size={18} />
            </Link>
            <ThemeToggle />
            <button
              className="btn-ghost !p-2"
              onClick={() => {
                logout();
                navigate("/", { replace: true });
              }}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:py-10">
        <Outlet />
      </main>
    </div>
  );
}
