import { Router } from "express";
import * as c from "../controllers/community.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import {
  communityAnnouncementSchema,
  communityQuerySchema,
  createCommunitySchema,
  decideRequestSchema,
  joinCommunitySchema,
} from "../validation/schemas.js";

const r = Router();
r.use(requireAuth);
r.get("/", validate(communityQuerySchema, "query"), c.list);
r.post("/", requireRole("ADMIN"), validate(createCommunitySchema), c.create);
r.get("/owned", requireRole("ADMIN"), c.listOwned);
r.get("/:id", c.getOne);
r.post("/:id/join", requireRole("USER"), validate(joinCommunitySchema), c.requestJoin);
r.get("/:id/requests", requireRole("ADMIN"), c.requests);
r.patch("/:id/requests/:memberId", requireRole("ADMIN"), validate(decideRequestSchema), c.decide);
r.post("/:id/announcements", requireRole("ADMIN"), validate(communityAnnouncementSchema), c.announce);
export default r;
