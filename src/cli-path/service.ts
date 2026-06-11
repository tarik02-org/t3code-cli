import * as Context from "effect/Context";

export type CliPathShape = {
  readonly path: string;
};

export class CliPath extends Context.Service<CliPath, CliPathShape>()("t3cli/CliPath") {}
