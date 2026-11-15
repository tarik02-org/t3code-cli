import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { Command, Flag } from "effect/cli";

import { loadT3CliEnv } from "../config/env/env.ts";
import { withRunningCompanion } from "../companion/client.ts";
import type { WaitsListing } from "../companion/schema.ts";
import { MissingThreadError } from "./error.ts";
import { extraArgsConfig } from "./extra-args.ts";
import { formatFlag, threadFlag } from "./flags.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { T3Output } from "./output/service.ts";
import { CliRuntime } from "./runtime/service.ts";
import { resolveThreadId } from "./scope/index.ts";

function formatListing(listing: WaitsListing): string {
  const pending = listing.pending.flatMap((wait) => [
    `[${wait.id}] ${wait.owner.environment}/${wait.owner.threadId}${wait.label === null ? "" : ` "${wait.label}"`}: ${wait.condition} (wake ${wait.wake}${wait.repeat ? ", repeats" : ""}${wait.deadlineAt === null ? "" : `, deadline ${wait.deadlineAt}`})`,
    ...wait.leaves.map((leaf) => `    ${leaf.state.padEnd(7)} ${leaf.detail}`),
  ]);
  const fired = listing.fired.map(
    (wait) =>
      `[${wait.id}]${wait.label === null ? "" : ` "${wait.label}"`} ${wait.result.outcome} at ${wait.result.at}, not picked up yet: ${wait.summary}`,
  );
  return pending.length + fired.length === 0 ? "no waits" : [...pending, ...fired].join("\n");
}

export const waitsCommand = Command.make(
  "waits",
  {
    thread: threadFlag,
    callerEnv: Flag.String("caller-env").pipe(
      Flag.withDescription("Environment of the owner thread (default: the default environment)"),
      Flag.optional,
    ),
    all: Flag.Boolean("all").pipe(
      Flag.withDescription("List every thread's waits, not only the owner's"),
      Flag.withDefault(false),
    ),
    cancel: Flag.Int("cancel").pipe(
      Flag.withDescription("Cancel the owner's pending wait with this id; repeat for several"),
      Flag.atLeast(0),
    ),
    format: formatFlag,
    ...extraArgsConfig,
  },
  (input) =>
    Effect.gen(function* () {
      const output = yield* T3Output;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const threadId = input.all
        ? undefined
        : resolveThreadId({ value: Option.getOrUndefined(input.thread), scope: t3CliEnv.scope });
      const owner =
        threadId === undefined
          ? undefined
          : { threadId, environment: Option.getOrUndefined(input.callerEnv) };
      if (input.cancel.length > 0 && owner === undefined) {
        return yield* new MissingThreadError({
          message: "cancelling needs the owner thread: pass --thread or set T3CODE_THREAD_ID",
        });
      }
      const result = yield* withRunningCompanion((client) =>
        Effect.gen(function* () {
          const cancelled =
            owner === undefined || input.cancel.length === 0
              ? 0
              : yield* client.cancel({ owner, ids: input.cancel });
          // A person looking at the list must not take a result away from the agent it is for.
          const listing = yield* client.waits({ owner, collect: false });
          return { cancelled, listing };
        }),
      );
      if (resolveOutputFormat(input.format, cliRuntime, t3CliEnv, "json") === "json") {
        return yield* output.printJson({ ...result.listing, cancelled: result.cancelled });
      }
      return yield* output.printInfo(
        [
          ...(result.cancelled > 0 ? [`cancelled ${result.cancelled}`] : []),
          formatListing(result.listing),
        ].join("\n"),
      );
    }).pipe(Effect.provide(FetchHttpClient.layer)),
).pipe(Command.withDescription("list or cancel the companion's waits"));
