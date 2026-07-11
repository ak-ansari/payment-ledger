import { ErrorRequestHandler } from "express";
import { DomainError } from "../../domain/errors.js";

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof DomainError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
  }
  console.error("unexpected error:", err);
  res.status(500).json({
    error: { code: "internal_error", message: "something went wrong" },
  });
};
