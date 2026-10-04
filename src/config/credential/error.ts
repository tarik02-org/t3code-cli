import * as Schema from "effect/Schema";

export class CredentialCipherError extends Schema.TaggedError<CredentialCipherError>()(
  "CredentialCipherError",
  {
    operation: Schema.Literals(["encrypt", "decrypt"]),
    cause: Schema.Defect(),
  },
) {}
