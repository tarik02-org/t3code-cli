import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { TerminalEvent, TerminalSummary } from "#t3tools/contracts";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { TerminalLookupError } from "../../domain/error.ts";
import { T3Application } from "../../application/service.ts";
import { Environment } from "../../environment/service.ts";
import { humanJsonFormatChoices, resolveOutputFormat } from "../output-format.ts";
import { T3Output } from "../output/service.ts";

const terminalWaitTargetChoices = ["exited", "closed", "ended"] as const;
type TerminalWaitTarget = (typeof terminalWaitTargetChoices)[number];

export const waitTerminalCommand = Command.make(
  "wait",
  {
    thread: Argument.string("thread"),
    terminalId: Argument.string("terminal-id"),
    target: Flag.choice("for", terminalWaitTargetChoices).pipe(Flag.withDefault("exited")),
    format: Flag.choice("format", humanJsonFormatChoices).pipe(Flag.withDefault("auto")),
  },
  ({ thread, terminalId, target, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, environment, "json");

      const currentResult = yield* Effect.exit(
        application.getTerminal({
          threadId: thread,
          terminalId,
        }),
      );

      if (Exit.isFailure(currentResult)) {
        const failure = Cause.findErrorOption(currentResult.cause);
        if (Option.isNone(failure)) {
          yield* Effect.fail(new Error("terminal lookup failed without an error value"));
        } else {
          const error = failure.value;
          if (error instanceof TerminalLookupError && (target === "closed" || target === "ended")) {
            const result = {
              threadId: thread,
              terminalId,
              target,
              status: "closed",
              alreadySatisfied: true,
              missingTreatedAsClosed: true,
            } as const;
            if (resolvedFormat === "json") {
              yield* output.printJson(result);
            } else {
              yield* output.printInfo(`terminal closed: ${terminalId} (${thread})`);
            }
            return;
          }
          yield* Effect.fail(error);
        }
      } else {
        const current = currentResult.value;
        if (targetSatisfiedBySummary(target, current)) {
          const result = {
            threadId: current.threadId,
            terminalId: current.terminalId,
            target,
            status: current.status,
            exitCode: current.exitCode,
            exitSignal: current.exitSignal,
            updatedAt: current.updatedAt,
            alreadySatisfied: true,
          } as const;
          if (resolvedFormat === "json") {
            yield* output.printJson(result);
          } else {
            yield* output.printInfo(formatWaitHuman(result));
          }
          return;
        }

        const item = yield* Stream.runHead(
          waitEventStream(application, target, thread, terminalId),
        );
        const matched = Option.getOrUndefined(item);
        if (matched === undefined) {
          yield* Effect.fail(new Error("terminal wait stream ended unexpectedly"));
        } else {
          if (target === "exited" && matched.type === "closed") {
            yield* Effect.fail(
              new Error(`terminal closed before an exited event was observed: ${terminalId}`),
            );
          }

          const result =
            matched.type === "exited"
              ? ({
                  threadId: thread,
                  terminalId,
                  target,
                  status: matched.type,
                  exitCode: matched.exitCode,
                  exitSignal: matched.exitSignal,
                  ...(typeof matched.sequence === "number" ? { sequence: matched.sequence } : {}),
                  alreadySatisfied: false,
                } as const)
              : ({
                  threadId: thread,
                  terminalId,
                  target,
                  status: matched.type,
                  ...(typeof matched.sequence === "number" ? { sequence: matched.sequence } : {}),
                  alreadySatisfied: false,
                } as const);
          if (resolvedFormat === "json") {
            yield* output.printJson(result);
          } else {
            yield* output.printInfo(formatWaitHuman(result));
          }
        }
      }
    }),
).pipe(Command.withDescription("wait for terminal lifecycle events"));

function targetSatisfiedBySummary(target: TerminalWaitTarget, terminal: TerminalSummary) {
  if (target === "exited") {
    return terminal.status === "exited";
  }
  if (target === "closed") {
    return false;
  }
  return terminal.status === "exited";
}

function waitEventStream(
  application: T3Application["Service"],
  target: TerminalWaitTarget,
  threadId: string,
  terminalId: string,
) {
  const stream = application.watchTerminalEvents({
    threadId,
    terminalId,
  });

  if (target === "exited") {
    return stream.pipe(
      Stream.filter(
        (event): event is Extract<TerminalEvent, { readonly type: "exited" | "closed" }> =>
          event.type === "exited" || event.type === "closed",
      ),
    );
  }

  if (target === "closed") {
    return stream.pipe(
      Stream.filter(
        (event): event is Extract<TerminalEvent, { readonly type: "closed" }> =>
          event.type === "closed",
      ),
    );
  }

  return stream.pipe(
    Stream.filter(
      (event): event is Extract<TerminalEvent, { readonly type: "exited" | "closed" }> =>
        event.type === "exited" || event.type === "closed",
    ),
  );
}

function formatWaitHuman(input: {
  readonly threadId: string;
  readonly terminalId: string;
  readonly status: string;
  readonly alreadySatisfied: boolean;
  readonly exitCode?: number | null;
  readonly exitSignal?: number | null;
}) {
  const details = [
    typeof input.exitCode === "number" ? `code ${input.exitCode}` : null,
    typeof input.exitSignal === "number" ? `signal ${input.exitSignal}` : null,
  ]
    .filter((value): value is string => value !== null)
    .join(", ");
  return details.length > 0
    ? `terminal ${input.status}: ${input.terminalId} (${input.threadId}) ${details}`
    : `terminal ${input.status}: ${input.terminalId} (${input.threadId})`;
}
