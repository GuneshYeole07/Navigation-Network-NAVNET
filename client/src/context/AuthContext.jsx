import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { authService } from "../services/authService";
import { tokenStore } from "../services/api";
import { clearPrivateCaches } from "../utils/offlineMap";

const AuthContext = createContext(null);

const USER_KEY = "navnet-user";
const cachedUser = () => {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY));
  } catch {
    return null;
  }
};
const saveUser = (u) => {
  try {
    if (u) localStorage.setItem(USER_KEY, JSON.stringify(u));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* ignore */
  }
};

export function AuthProvider({ children }) {
  // Start from the profile saved on this device, so the app opens instantly — and offline.
  const [user, setUserState] = useState(() => (tokenStore.get() ? cachedUser() : null));
  const setUser = useCallback((u) => {
    saveUser(u);
    setUserState(u);
  }, []);
  const [token, setToken] = useState(() => tokenStore.get());
  const [loading, setLoading] = useState(!!tokenStore.get() && !cachedUser());

  const logout = useCallback(() => {
    clearPrivateCaches();
    tokenStore.clear();
    setToken(null);
    setUser(null);
  }, [setUser]);

  // Restore session on reload.
  useEffect(() => {
    if (!token) return setLoading(false);
    let alive = true;
    authService
      .me()
      .then((d) => alive && setUser(d.user))
      .catch((e) => {
        // Only a real "session invalid" answer logs out. No network ≠ logged out:
        // a rider opening the app in a dead zone keeps their session and saved trip.
        if (alive && (e.status === 401 || e.status === 403 || (e.status === 404 && !cachedUser()))) logout();
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token, logout, setUser]);

  useEffect(() => {
    const onExpired = () => logout();
    window.addEventListener("navnet:unauthorized", onExpired);
    return () => window.removeEventListener("navnet:unauthorized", onExpired);
  }, [logout]);

  const startSession = useCallback(
    ({ token: t, user: u }) => {
      tokenStore.set(t);
      setUser(u);
      setToken(t);
      return u;
    },
    [setUser],
  );

  const login = useCallback(async (body) => startSession(await authService.login(body)), [startSession]);
  const register = useCallback(async (body) => startSession(await authService.register(body)), [startSession]);

  const value = useMemo(
    () => ({ user, token, loading, isAdmin: user?.role === "ADMIN", login, register, logout, setUser }),
    [user, token, loading, login, register, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
