import axios from "axios";

const TOKEN_KEY = "navnet-token";
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export const API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");

const api = axios.create({ baseURL: `${API_BASE}/api`, timeout: 20000 });

api.interceptors.request.use((config) => {
  const t = tokenStore.get();
  if (t) config.headers.Authorization = `Bearer ${t}`;
  return config;
});

api.interceptors.response.use(
  (res) => res.data?.data,
  (err) => {
    const status = err.response?.status;
    const message =
      err.response?.data?.error?.message ||
      (err.code === "ECONNABORTED" ? "The server took too long to respond." : null) ||
      (!err.response ? "Can't reach the NavNet server. Check your connection." : "Something went wrong.");
    if (status === 401 && tokenStore.get() && !err.config.url.includes("/auth/login")) {
      tokenStore.clear();
      window.dispatchEvent(new Event("navnet:unauthorized"));
    }
    const e = new Error(message);
    e.status = status;
    e.details = err.response?.data?.error?.details;
    return Promise.reject(e);
  },
);

/** Absolute URL for server-hosted uploads (/uploads/…) when the API lives on another origin. */
export const assetUrl = (u) => (!u ? null : u.startsWith("/") ? `${API_BASE}${u}` : u);

export default api;
