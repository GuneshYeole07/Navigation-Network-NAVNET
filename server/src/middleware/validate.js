import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";

/**
 * Zod validation middleware.
 * body → replaces req.body with the parsed (coerced, stripped) value.
 * query/params → stored on req.q / req.p (Express 5 makes req.query read-only).
 */
export const validate =
  (schema, source = "body") =>
  (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) {
      const details = result.error.issues.map((i) => ({
        field: i.path.join("."),
        message: i.message,
      }));
      if (!env.isProd && !env.isTest) console.warn(`[validate] ${req.method} ${req.originalUrl}`, JSON.stringify(details));
      return next(ApiError.badRequest(details[0]?.message || "Invalid input", details));
    }
    if (source === "body") req.body = result.data;
    else if (source === "query") req.q = result.data;
    else if (source === "params") req.p = result.data;
    next();
  };
