import { Router } from "express";
import * as c from "../controllers/geo.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { geoLimiter } from "../middleware/rateLimit.js";
import { geocodeQuerySchema, reverseQuerySchema, routeRequestSchema } from "../validation/schemas.js";

const r = Router();
r.use(requireAuth, geoLimiter);
r.post("/route", validate(routeRequestSchema), c.route);
r.get("/search", validate(geocodeQuerySchema, "query"), c.search);
r.get("/reverse", validate(reverseQuerySchema, "query"), c.reverse);
export default r;
