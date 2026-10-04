/** A management call to the Evolution API failed (network, timeout or non-2xx). */
export class EvolutionApiError extends Error {
  constructor(
    message: string,
    /** HTTP status of the provider's response; undefined for network errors and timeouts. */
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "EvolutionApiError";
  }
}

/** `EVOLUTION_API_URL` or `EVOLUTION_API_KEY` is not set. */
export class EvolutionNotConfiguredError extends Error {
  constructor() {
    super("EVOLUTION_API_URL and EVOLUTION_API_KEY must be configured.");
    this.name = "EvolutionNotConfiguredError";
  }
}
