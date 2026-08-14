import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Command, Flag } from "effect/unstable/cli";
import {
  resolveSnoozePresets,
  type SnoozePresetId,
} from "@t3tools/client-runtime/state/thread-settled";

import { T3Application } from "../../application/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import {
  InvalidFlagCombinationError,
  InvalidSnoozeUntilError,
  MissingThreadError,
  UnavailableSnoozePresetError,
} from "../error.ts";
import { extraArgsConfig } from "../extra-args.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { CliRuntime } from "../runtime/service.ts";
import { resolveThreadId } from "../scope/index.ts";

const snoozePresetChoices = [
  "hour",
  "evening",
  "tomorrow",
  "next-week",
] as const satisfies ReadonlyArray<SnoozePresetId>;

export const snoozeThreadCommand = Command.make(
  "snooze",
  {
    thread: threadFlag,
    until: Flag.string("until").pipe(Flag.optional),
    preset: Flag.choice("preset", snoozePresetChoices).pipe(Flag.optional),
    format: formatFlag,
    ...extraArgsConfig,
  },
  ({ thread, until, preset, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const threadId = resolveThreadId({
        value: Option.getOrUndefined(thread),
        scope: t3CliEnv.scope,
      });
      if (threadId === undefined) {
        return yield* Effect.fail(
          new MissingThreadError({
            message: "thread id is required: pass --thread or set T3CODE_THREAD_ID",
          }),
        );
      }

      const untilValue = Option.getOrUndefined(until);
      const presetValue = Option.getOrUndefined(preset);
      if (untilValue !== undefined && presetValue !== undefined) {
        return yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "exactly one of --until or --preset is required",
          }),
        );
      }

      let snoozedUntil: string;
      if (untilValue !== undefined) {
        snoozedUntil = yield* Schema.decodeUnknownEffect(Schema.DateTimeUtcFromString)(
          untilValue,
        ).pipe(
          Effect.map(DateTime.formatIso),
          Effect.mapError(
            () =>
              new InvalidSnoozeUntilError({
                message: `invalid ISO-8601 snooze time: ${untilValue}`,
                value: untilValue,
              }),
          ),
        );
      } else if (presetValue !== undefined) {
        snoozedUntil = yield* resolveSnoozePreset(presetValue);
      } else {
        return yield* Effect.fail(
          new InvalidFlagCombinationError({
            message: "exactly one of --until or --preset is required",
          }),
        );
      }

      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const dispatch = yield* application.snoozeThread({ threadId, snoozedUntil });
      if (resolvedFormat === "json") {
        return yield* output.printJson(dispatch);
      }
      return yield* output.printInfo(
        `thread snoozed: ${threadId} until ${snoozedUntil} (sequence ${dispatch.sequence})`,
      );
    }),
).pipe(Command.withDescription("snooze thread"));

const resolveSnoozePreset = Effect.fn("resolveSnoozePreset")(function* (presetId: SnoozePresetId) {
  const now = yield* DateTime.nowAsDate;
  const preset = resolveSnoozePresets(now).find((candidate) => candidate.id === presetId);
  if (preset === undefined) {
    return yield* Effect.fail(
      new UnavailableSnoozePresetError({
        message: `snooze preset is not available at this time: ${presetId}`,
        preset: presetId,
      }),
    );
  }
  return preset.snoozedUntil;
});
