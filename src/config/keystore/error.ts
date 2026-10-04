import * as Schema from "effect/Schema";

export class KeystoreUnavailableError extends Schema.TaggedError<KeystoreUnavailableError>()(
  "KeystoreUnavailableError",
  {
    reason: Schema.Literals(["module-not-found", "backend-unavailable"]),
    cause: Schema.Defect(),
  },
) {}
