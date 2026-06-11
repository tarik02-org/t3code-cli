import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { CliPath } from "./service.ts";

const makeCliPath = Effect.sync(() => ({
  path: process.argv[1] ?? "dist/bin.js",
}));

export const NodeCliPathLayer = Layer.effect(CliPath, makeCliPath);
