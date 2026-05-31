import * as Context from "effect/Context";

export type EnvironmentShape = {
  readonly cwd: string;
  readonly homeDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
};

export class Environment extends Context.Service<Environment, EnvironmentShape>()(
  "t3cli/Environment",
) {}
