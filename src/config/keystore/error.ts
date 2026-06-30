import * as Schema from "effect/Schema";

export class KeystoreUnavailableError extends Schema.TaggedErrorClass<KeystoreUnavailableError>()(
  "KeystoreUnavailableError",
  {
    reason: Schema.Literals(["module-not-found", "backend-unavailable"]),
    cause: Schema.Defect(),
  },
) {}
