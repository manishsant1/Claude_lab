// An error with an HTTP status, turned into a JSON response by the API error handler.
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
