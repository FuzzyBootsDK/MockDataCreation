import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { ValidationIssue } from "@mockgen/core";

export class HttpError extends Error {
  readonly statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export class ValidationFailed extends Error {
  readonly issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super("Validation failed");
    this.issues = issues;
  }
}

export function errorHandler(err: FastifyError | Error, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof ValidationFailed) return reply.status(400).send({ errors: err.issues });
  if (err instanceof HttpError) return reply.status(err.statusCode).send({ error: err.message });
  const status = (err as FastifyError).statusCode;
  if (status && status >= 400 && status < 500) return reply.status(status).send({ error: err.message });
  req.log.error(err);
  return reply.status(500).send({ error: "Internal server error" });
}
