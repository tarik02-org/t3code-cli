import * as Option from "effect/Option";

import type { T3CliEnvShape } from "../../config/env/env.ts";
import type { CliRuntime } from "../runtime/service.ts";

export const humanJsonFormatChoices = ["auto", "human", "json"] as const;
export const humanNdjsonFormatChoices = ["auto", "human", "ndjson"] as const;
export const humanJsonNdjsonFormatChoices = ["auto", "human", "json", "ndjson"] as const;

export type HumanJsonFormat = (typeof humanJsonFormatChoices)[number];
export type HumanNdjsonFormat = (typeof humanNdjsonFormatChoices)[number];
export type HumanJsonNdjsonFormat = (typeof humanJsonNdjsonFormatChoices)[number];

export function resolveOutputFormat<T extends "json" | "ndjson">(
  format: "auto" | "human" | T,
  cliRuntime: CliRuntime["Service"],
  t3CliEnv: T3CliEnvShape,
  nonHumanFormat: T,
): "human" | T {
  if (format !== "auto") {
    return format;
  }
  return isHumanTerminal(cliRuntime, t3CliEnv) ? "human" : nonHumanFormat;
}

export function canRenderLiveTerminal(cliRuntime: CliRuntime["Service"], t3CliEnv: T3CliEnvShape) {
  return (
    cliRuntime.stderrIsTTY &&
    Option.getOrElse(t3CliEnv.term, () => "") !== "dumb" &&
    !isAgentEnvironment(t3CliEnv)
  );
}

export function isInteractiveHumanTerminal(
  cliRuntime: CliRuntime["Service"],
  t3CliEnv: T3CliEnvShape,
) {
  return (
    cliRuntime.stdoutIsTTY &&
    !isAgentEnvironment(t3CliEnv) &&
    Option.getOrElse(t3CliEnv.term, () => "") !== "dumb"
  );
}

function isHumanTerminal(cliRuntime: CliRuntime["Service"], t3CliEnv: T3CliEnvShape) {
  return isInteractiveHumanTerminal(cliRuntime, t3CliEnv);
}

export function isAgentEnvironment(t3CliEnv: T3CliEnvShape) {
  return t3CliEnv.ci || t3CliEnv.codexCi || t3CliEnv.codexThreadId || t3CliEnv.t3cliAgent;
}
