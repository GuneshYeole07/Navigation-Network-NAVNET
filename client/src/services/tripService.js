import api from "./api";
export const tripService = {
  create: (body) => api.post("/trips", body),
  mine: () => api.get("/trips/mine"),
  joined: () => api.get("/trips/joined"),
  join: (body) => api.post("/trips/join", body),
  get: (id) => api.get(`/trips/${id}`),
  setStatus: (id, action) => api.patch(`/trips/${id}/status`, { action }),
  setLeader: (id, userId) => api.patch(`/trips/${id}/leader`, { userId }),
  removeMember: (id, userId) => api.delete(`/trips/${id}/members/${userId}`),
  leave: (id) => api.post(`/trips/${id}/leave`),
  broadcast: (id, body) => api.post(`/trips/${id}/broadcast`, { body }),
  alerts: (id) => api.get(`/trips/${id}/alerts`),
  ackAlert: (alertId) => api.patch(`/trips/alerts/${alertId}/ack`),
  messages: (id, params) => api.get(`/trips/${id}/messages`, { params }),
  sendMessage: (id, body) => api.post(`/trips/${id}/messages`, body),
  threads: (id) => api.get(`/trips/${id}/threads`),
  report: (id) => api.get(`/trips/${id}/report`),
  // From the Python analytics service (via the API); { available: false } when it's off.
  insights: (id) => api.get(`/trips/${id}/insights`),
  smartEta: (id) => api.get(`/trips/${id}/eta`),
  contacts: (id) => api.get(`/trips/${id}/contacts`),
  invite: (id) => api.post(`/trips/${id}/invite`),
  ride: (id) => api.post(`/trips/${id}/ride`),
  setSweep: (id, userId) => api.patch(`/trips/${id}/sweep`, { userId }),
  setChecklist: (id, items) => api.patch(`/trips/${id}/checklist`, { items }),
  pois: (id, refresh = false) => api.get(`/trips/${id}/pois`, { params: { refresh } }),
  expenses: (id) => api.get(`/trips/${id}/expenses`),
  addExpense: (id, body) => api.post(`/trips/${id}/expenses`, body),
  deleteExpense: (id, expenseId) => api.delete(`/trips/${id}/expenses/${expenseId}`),
  voice: (id, blob, durationMs, recipientId) => {
    const fd = new FormData();
    const ext = blob.type.includes("mp4") ? "m4a" : blob.type.includes("ogg") ? "ogg" : "webm";
    fd.append("audio", blob, `ptt.${ext}`);
    fd.append("durationMs", String(Math.round(durationMs)));
    if (recipientId) fd.append("recipientId", recipientId);
    return api.post(`/trips/${id}/voice`, fd);
  },
};
