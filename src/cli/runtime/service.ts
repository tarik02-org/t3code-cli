import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export class CliRuntime extends Context.Service<
  CliRuntime,
  {
    readonly cwd: string;
    readonly stdoutIsTTY: boolean;
    readonly stderrIsTTY: boolean;
  }
>()("t3cli/CliRuntime") {
  static layerTest = (input?: {
    readonly cwd?: string;
    readonly stdoutIsTTY?: boolean;
    readonly stderrIsTTY?: boolean;
  }) =>
    Layer.succeed(
      CliRuntime,
      CliRuntime.of({
        cwd: input?.cwd ?? process.cwd(),
        stdoutIsTTY: input?.stdoutIsTTY ?? false,
        stderrIsTTY: input?.stderrIsTTY ?? false,
      }),
    );
}

export const layer = Layer.succeed(
  CliRuntime,
  CliRuntime.of({
    cwd: process.cwd(),
    stdoutIsTTY: process.stdout.isTTY ?? false,
    stderrIsTTY: process.stderr.isTTY ?? false,
  }),
);
