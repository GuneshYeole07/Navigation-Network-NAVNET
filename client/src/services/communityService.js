import api from "./api";
export const communityService = {
  list: (params) => api.get("/communities", { params }),
  owned: () => api.get("/communities/owned"),
  get: (id) => api.get(`/communities/${id}`),
  create: (body) => api.post("/communities", body),
  join: (id, message) => api.post(`/communities/${id}/join`, { message }),
  requests: (id) => api.get(`/communities/${id}/requests`),
  decide: (id, memberId, decision) => api.patch(`/communities/${id}/requests/${memberId}`, { decision }),
  announce: (id, body) => api.post(`/communities/${id}/announcements`, body),
};
