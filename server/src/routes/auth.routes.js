import { Router } from "express";
import * as c from "../controllers/auth.controller.js";
import { requireAuth } from "../middleware/auth.js";
import { validate } from "../middleware/validate.js";
import { authLimiter } from "../middleware/rateLimit.js";
import { loginSchema, registerSchema, updateProfileSchema } from "../validation/schemas.js";

const r = Router();
r.post("/register", authLimiter, validate(registerSchema), c.register);
r.post("/login", authLimiter, validate(loginSchema), c.login);
r.get("/me", requireAuth, c.me);
r.patch("/me", requireAuth, validate(updateProfileSchema), c.updateMe);
export default r;
