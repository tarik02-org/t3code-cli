import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import { CommandId } from "@t3tools/contracts";

/** Prefixed so commands from the CLI are recognizable in server logs. */
export const makeCommandId = Effect.fn("makeCommandId")(function* (kind: string) {
  const crypto = yield* Crypto.Crypto;
  return CommandId.make(`t3cli:${kind}:${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`);
});
