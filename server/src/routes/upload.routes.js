import { Router } from "express";
import * as c from "../controllers/upload.controller.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { imageUpload } from "../middleware/upload.js";

const r = Router();
r.post("/image", requireAuth, requireRole("ADMIN"), imageUpload.single("image"), c.uploadImage);
export default r;
