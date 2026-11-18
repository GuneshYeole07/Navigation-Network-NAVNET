import api from "./api";
export const authService = {
  login: (body) => api.post("/auth/login", body),
  register: (body) => api.post("/auth/register", body),
  me: () => api.get("/auth/me"),
  updateMe: (body) => api.patch("/auth/me", body),
};
