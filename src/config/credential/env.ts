import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import type { T3CliEnvShape } from "../env/env.ts";

export function credentialTokenFromEnv(
  t3CliEnv: Pick<T3CliEnvShape, "t3codeToken">,
): Option.Option<string> {
  return Option.flatMap(t3CliEnv.t3codeToken, (token) => {
    const value = Redacted.value(token).trim();
    return value.length > 0 ? Option.some(value) : Option.none();
  });
}
