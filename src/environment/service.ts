import * as Context from "effect/Context";
import * as Layer from "effect/Layer";

export type EnvironmentShape = {
  readonly cwd: string;
  readonly homeDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdoutIsTTY: boolean;
  readonly stderrIsTTY: boolean;
};

export class Environment extends Context.Service<Environment, EnvironmentShape>()(
  "t3cli/Environment",
) {
  static layerTest = (input: {
    readonly homeDir: string;
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
  }) =>
    Layer.succeed(Environment, {
      cwd: input.cwd ?? input.homeDir,
      homeDir: input.homeDir,
      env: input.env ?? {},
      stdoutIsTTY: false,
      stderrIsTTY: false,
    });
}
