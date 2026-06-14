import type { EnvironmentShape } from "../environment/service.ts";

export const humanJsonFormatChoices = ["auto", "human", "json"] as const;
export const humanNdjsonFormatChoices = ["auto", "human", "ndjson"] as const;
export const humanJsonNdjsonFormatChoices = ["auto", "human", "json", "ndjson"] as const;

export type HumanJsonFormat = (typeof humanJsonFormatChoices)[number];
export type HumanNdjsonFormat = (typeof humanNdjsonFormatChoices)[number];
export type HumanJsonNdjsonFormat = (typeof humanJsonNdjsonFormatChoices)[number];

export function resolveOutputFormat<T extends "json" | "ndjson">(
  format: "auto" | "human" | T,
  environment: EnvironmentShape,
  nonHumanFormat: T,
): "human" | T {
  if (format !== "auto") {
    return format;
  }
  return isHumanTerminal(environment) ? "human" : nonHumanFormat;
}

export function canRenderLiveTerminal(environment: EnvironmentShape) {
  return (
    environment.stderrIsTTY && environment.env.TERM !== "dumb" && !isAgentEnvironment(environment)
  );
}

export function isInteractiveHumanTerminal(environment: EnvironmentShape) {
  return (
    environment.stdoutIsTTY && !isAgentEnvironment(environment) && environment.env.TERM !== "dumb"
  );
}

function isHumanTerminal(environment: EnvironmentShape) {
  return isInteractiveHumanTerminal(environment);
}

function isAgentEnvironment(environment: EnvironmentShape) {
  return (
    environment.env.CI !== undefined ||
    environment.env.CODEX_CI !== undefined ||
    environment.env.CODEX_THREAD_ID !== undefined ||
    environment.env.T3CLI_AGENT !== undefined
  );
}
