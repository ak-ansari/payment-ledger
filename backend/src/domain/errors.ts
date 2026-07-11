export class DomainError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = code;
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(404, "not_found", `${what} not found`);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(400, "validation_error", message);
  }
}

export class UnbalancedTransactionError extends DomainError {
  constructor(sum: number) {
    super(422, "unbalanced_transaction", `entries must sum to zero, got ${sum}`);
  }
}

export class InvalidTransitionError extends DomainError {
  constructor(from: string, to: string) {
    super(409, "invalid_transition", `cannot move invoice from ${from} to ${to}`);
  }
}

export class OverpaymentError extends DomainError {
  constructor(remaining: number, attempted: number) {
    super(
      422,
      "overpayment",
      `payment of ${attempted} exceeds remaining balance of ${remaining}`
    );
  }
}

export class IdempotencyConflictError extends DomainError {
  constructor() {
    super(
      409,
      "idempotency_conflict",
      "idempotency key already used with a different payload"
    );
  }
}
