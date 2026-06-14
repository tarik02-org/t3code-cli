import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";
import { Command, Flag } from "effect/unstable/cli";

import { threadFlag } from "../flags.ts";
import { MissingThreadError } from "../error.ts";
import { resolveThreadId } from "../../scope/index.ts";
import { Environment } from "../../environment/service.ts";
import { T3Application } from "../../application/service.ts";
import { T3Output } from "../output/service.ts";
import { CliPath } from "../../cli-path/service.ts";

export const callbackThreadCommand = Command.make(
  "callback",
  {
    from: Flag.string("from").pipe(Flag.withDescription("Thread ID to watch for completion")),
    thread: threadFlag,
    prompt: Flag.string("prompt").pipe(Flag.withDescription("Message to send to target thread")),
    background: Flag.boolean("background").pipe(
      Flag.withDescription("Fork and detach as background process"),
      Flag.optional,
    ),
  },
  ({ from, thread, prompt, background }) =>
    Effect.gen(function* () {
      const application = yield* T3Application;
      const environment = yield* Environment;
      const output = yield* T3Output;
      const cliPath = yield* CliPath;
      const spawner = yield* ChildProcessSpawner;

      const fromThreadId = from;

      const targetThreadId = resolveThreadId({
        value: Option.getOrUndefined(thread),
        env: environment.env,
      });
      if (targetThreadId === undefined) {
        return yield* Effect.fail(
          new MissingThreadError({
            message: "target thread id is required: pass --thread or set T3CODE_THREAD_ID",
          }),
        );
      }

      const isBackground = Option.getOrElse(background, () => false);
      if (isBackground) {
        const args = [
          cliPath.path,
          "thread",
          "callback",
          "--from",
          fromThreadId,
          "--thread",
          targetThreadId,
          "--prompt",
          prompt,
        ];

        const proc = ChildProcess.make(process.execPath, args, {
          detached: true,
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
        });

        const handle = yield* spawner.spawn(proc);
        yield* handle.unref.pipe(Effect.ignore);

        yield* output.printInfo(
          `background callback scheduled: ${fromThreadId} -> ${targetThreadId} (pid: ${handle.pid})`,
        );
        return undefined;
      }

      yield* output.printInfo(`watching thread ${fromThreadId} for completion...`);

      const result = yield* application.callbackThread({
        fromThreadId,
        targetThreadId,
        prompt,
      });

      yield* output.printInfo(
        `callback sent to ${result.targetThreadId} (dispatch: ${result.dispatch.sequence})`,
      );
      return undefined;
    }),
).pipe(Command.withDescription("watch a thread and send a message when it completes"));
