import * as Layer from "effect/Layer";

import { CliPath } from "./service.ts";

export const NodeCliPathLive = Layer.succeed(CliPath)({
  path: process.argv[1] ?? "dist/bin.js",
});
