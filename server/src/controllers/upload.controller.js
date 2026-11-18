import { ok } from "../utils/respond.js";
import { ApiError } from "../utils/ApiError.js";

export const uploadImage = async (req, res) => {
  if (!req.file) throw ApiError.badRequest("Attach an image in the 'image' field");
  ok(res, { url: `/uploads/${req.file.filename}` }, 201);
};
