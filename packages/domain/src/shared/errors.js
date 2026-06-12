export class HttpError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
        this.name = this.constructor.name;
    }
}
export class NotFoundError extends HttpError {
    constructor(message = "Not found.") {
        super(message, 404);
    }
}
export class ConflictError extends HttpError {
    constructor(message = "Resource already exists.") {
        super(message, 409);
    }
}
export class ForbiddenError extends HttpError {
    constructor(message = "Forbidden.") {
        super(message, 403);
    }
}
export class ValidationError extends HttpError {
    constructor(message = "Validation failed.") {
        super(message, 400);
    }
}
export class IntegrityError extends HttpError {
    constructor(message = "Data integrity violation.") {
        super(message, 500);
    }
}
