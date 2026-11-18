import multer from "multer";
import { ApiError } from "../utils/ApiError.js";
import { env } from "../config/env.js";

export function notFound(req, _res, next) {
  next(ApiError.notFound(`Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  let status = err.status || 500;
  let message = err.message || "Internal server error";
  let details = err.details;

  // Prisma known errors → HTTP semantics
  if (err.code === "P2002") {
    status = 409;
    message = "A record with that value already exists";
    details = err.meta;
  } else if (err.code === "P2025") {
    status = 404;
    message = "Resource not found";
  } else if (["P1000", "P1001", "P1002", "P1003", "P1017", "P2021", "P2022"].includes(err.code) || err.name === "PrismaClientInitializationError") {
    // DB unreachable, wrong credentials, database or tables missing: never leak Prisma internals.
    console.error(`[db] ${err.code || err.name}: ${err.message?.split("\n").filter(Boolean).pop()}`);
    status = 503;
    message =
      err.code === "P1003" || err.code === "P2021" || err.code === "P2022"
        ? "The database isn't set up yet. Run `npm run db:migrate` and `npm run db:seed` on the server."
        : "Can't reach the database right now. Check that PostgreSQL is running and DATABASE_URL is correct.";
    details = undefined;
  } else if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "Image must be 3 MB or smaller" : err.message;
  } else if (err.type === "entity.parse.failed") {
    status = 400;
    message = "Malformed JSON body";
  }

  if (status >= 500 && status !== 503) {
    console.error(`[error] ${req.method} ${req.originalUrl}`, err);
    if (env.isProd) message = "Internal server error";
  }

  res.status(status).json({
    success: false,
    error: { message, ...(details ? { details } : {}) },
  });
}

export { ApiError };
