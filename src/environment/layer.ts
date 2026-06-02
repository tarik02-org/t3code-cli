import { homedir } from "node:os";
import * as Layer from "effect/Layer";

import { Environment } from "./service.ts";

export const NodeEnvironmentLive = Layer.succeed(Environment)({
  cwd: process.cwd(),
  homeDir: homedir(),
  env: process.env,
  stdoutIsTTY: process.stdout.isTTY ?? false,
  stderrIsTTY: process.stderr.isTTY ?? false,
});
