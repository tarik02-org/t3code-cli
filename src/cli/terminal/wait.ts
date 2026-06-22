import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type { TerminalMetadataStreamEvent, TerminalSummary } from "@t3tools/contracts";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { T3Application } from "../../application/service.ts";
import { CliRuntime } from "../../cli/runtime/service.ts";
import { loadT3CliEnv } from "../../config/env/env.ts";
import { formatFlag, threadFlag } from "../flags.ts";
import { resolveOutputFormat } from "../format/output.ts";
import { T3Output } from "../output/service.ts";
import { TerminalCliError } from "./error.ts";
import { requireCommandThreadId } from "./scope.ts";

const terminalWaitTargetChoices = ["exited", "closed", "ended"] as const;
type TerminalWaitTarget = (typeof terminalWaitTargetChoices)[number];

type WaitResult =
  | {
      readonly threadId: string;
      readonly terminalId: string;
      readonly target: TerminalWaitTarget;
      readonly status: string;
      readonly exitCode?: number | null;
      readonly exitSignal?: number | null;
      readonly updatedAt?: string;
      readonly sequence?: number;
      readonly alreadySatisfied: boolean;
      readonly missingTreatedAsClosed?: true;
    }
  | {
      readonly threadId: string;
      readonly terminalId: string;
      readonly target: TerminalWaitTarget;
      readonly status: "exited" | "closed";
      readonly exitCode?: number | null;
      readonly exitSignal?: number | null;
      readonly sequence?: number;
      readonly alreadySatisfied: false;
    };

type WaitResolution =
  | { readonly kind: "result"; readonly value: WaitResult }
  | { readonly kind: "fail"; readonly error: TerminalCliError };

export const waitTerminalCommand = Command.make(
  "wait",
  {
    thread: threadFlag,
    terminalId: Argument.string("terminal-id"),
    target: Flag.choice("for", terminalWaitTargetChoices).pipe(Flag.withDefault("exited")),
    format: formatFlag,
  },
  ({ thread, terminalId, target, format }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const threadId = yield* requireCommandThreadId({ thread });
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");

      const resolution = yield* application.watchTerminalMetadata().pipe(
        Stream.map((event) => resolveMetadataWait(event, target, threadId, terminalId)),
        Stream.filter((value): value is WaitResolution => value !== null),
        Stream.runHead,
      );

      if (Option.isNone(resolution)) {
        yield* Effect.fail(
          new TerminalCliError({
            message: "terminal wait stream ended unexpectedly",
            threadId,
            terminalId,
          }),
        );
      } else if (resolution.value.kind === "fail") {
        yield* Effect.fail(resolution.value.error);
      } else {
        const result = resolution.value.value;
        if (resolvedFormat === "json") {
          yield* output.printJson(result);
        } else {
          yield* output.printInfo(formatWaitHuman(result));
        }
      }
    }),
).pipe(Command.withDescription("wait for terminal lifecycle events"));

function terminalClosedBeforeExitError(threadId: string, terminalId: string) {
  return new TerminalCliError({
    message: `terminal closed before an exited event was observed: ${terminalId}`,
    threadId,
    terminalId,
  });
}

export function resolveMetadataWait(
  event: TerminalMetadataStreamEvent,
  target: TerminalWaitTarget,
  threadId: string,
  terminalId: string,
): WaitResolution | null {
  if (event.type === "snapshot") {
    const terminal = event.terminals.find(
      (candidate) => candidate.threadId === threadId && candidate.terminalId === terminalId,
    );
    if (terminal !== undefined) {
      if (targetSatisfiedBySummary(target, terminal)) {
        return {
          kind: "result",
          value: {
            threadId: terminal.threadId,
            terminalId: terminal.terminalId,
            target,
            status: terminal.status,
            exitCode: terminal.exitCode,
            exitSignal: terminal.exitSignal,
            updatedAt: terminal.updatedAt,
            alreadySatisfied: true,
          },
        };
      }
      return null;
    }
    if (target === "closed" || target === "ended") {
      return {
        kind: "result",
        value: {
          threadId,
          terminalId,
          target,
          status: "closed",
          alreadySatisfied: true,
          missingTreatedAsClosed: true,
        },
      };
    }
    return {
      kind: "fail",
      error: terminalClosedBeforeExitError(threadId, terminalId),
    };
  }

  if (event.type === "upsert") {
    if (event.terminal.threadId !== threadId || event.terminal.terminalId !== terminalId) {
      return null;
    }
    if ((target === "exited" || target === "ended") && event.terminal.status === "exited") {
      return {
        kind: "result",
        value: {
          threadId,
          terminalId,
          target,
          status: "exited",
          exitCode: event.terminal.exitCode,
          exitSignal: event.terminal.exitSignal,
          alreadySatisfied: false,
        },
      };
    }
    return null;
  }

  if (event.threadId !== threadId || event.terminalId !== terminalId) {
    return null;
  }

  if (target === "exited") {
    return {
      kind: "fail",
      error: terminalClosedBeforeExitError(threadId, terminalId),
    };
  }

  if (target === "closed" || target === "ended") {
    return {
      kind: "result",
      value: {
        threadId,
        terminalId,
        target,
        status: "closed",
        alreadySatisfied: false,
      },
    };
  }

  return null;
}

function targetSatisfiedBySummary(target: TerminalWaitTarget, terminal: TerminalSummary) {
  if (target === "exited") {
    return terminal.status === "exited";
  }
  if (target === "closed") {
    return false;
  }
  return terminal.status === "exited";
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
