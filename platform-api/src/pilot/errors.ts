export class PilotError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
  ) {
    super(code);
    this.name = "PilotError";
  }
}
export const invalid = (): never => {
  throw new PilotError("invalid_request");
};
export const notFound = (): never => {
  throw new PilotError("not_found", 404);
};
