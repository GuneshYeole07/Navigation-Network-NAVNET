import { Router } from "express";
import * as c from "../controllers/trip.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { audioUpload } from "../middleware/upload.js";
import {
  announcementSchema,
  createTripSchema,
  joinTripSchema,
  leaderSchema,
  messageSchema,
  messagesQuerySchema,
  tripActionSchema,
  sweepSchema,
  checklistSchema,
  expenseSchema,
  poiQuerySchema,
} from "../validation/schemas.js";

const r = Router();
r.use(requireAuth);

// Admin-scoped collection
r.post("/", requireRole("ADMIN"), validate(createTripSchema), c.create);
r.get("/mine", requireRole("ADMIN"), c.listMine);

// User-scoped
r.post("/join", requireRole("USER"), authLimiter, validate(joinTripSchema), c.join);
r.get("/joined", requireRole("USER"), c.listJoined);

// Alerts (ownership checked in service)
r.patch("/alerts/:alertId/ack", requireRole("ADMIN"), c.ackAlert);

// Single trip (access = trip admin or active member; checked in service)
r.get("/:id", c.getOne);
r.get("/:id/report", c.report);
r.get("/:id/insights", c.insightsFor); // Python analytics service
r.get("/:id/eta", c.smartEta); // machine-learned arrival time
r.get("/:id/messages", validate(messagesQuerySchema, "query"), c.messages);
r.post("/:id/messages", validate(messageSchema), c.sendMessage);
r.post("/:id/leave", requireRole("USER"), c.leave);

r.patch("/:id/status", requireRole("ADMIN"), validate(tripActionSchema), c.changeStatus);
r.patch("/:id/leader", requireRole("ADMIN"), validate(leaderSchema), c.setLeader);
r.delete("/:id/members/:userId", requireRole("ADMIN"), c.removeMember);
r.post("/:id/broadcast", requireRole("ADMIN"), validate(announcementSchema), c.broadcast);
r.get("/:id/alerts", requireRole("ADMIN"), c.alerts);
r.get("/:id/threads", requireRole("ADMIN"), c.threads);
r.post("/:id/invite", requireRole("ADMIN"), c.invite);
r.get("/:id/contacts", c.contacts); // admin or riding captain (checked in service)

// Group riding
r.post("/:id/ride", requireRole("ADMIN"), c.rideAsCaptain);
r.patch("/:id/sweep", validate(sweepSchema), c.setSweep);
r.patch("/:id/checklist", validate(checklistSchema), c.setChecklist);
r.post("/:id/voice", audioUpload.single("audio"), c.voice);
r.get("/:id/pois", validate(poiQuerySchema, "query"), c.pois);
r.get("/:id/expenses", c.expenses);
r.post("/:id/expenses", validate(expenseSchema), c.addExpense);
r.delete("/:id/expenses/:expenseId", c.deleteExpense);
export default r;
