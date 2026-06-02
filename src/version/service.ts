import * as Context from "effect/Context";

export class T3Version extends Context.Service<
  T3Version,
  {
    readonly version: string;
  }
>()("t3cli/T3Version") {}
