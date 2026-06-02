import type { AuthSessionState } from "../auth/schema.ts";
import type { ResolvedConfig } from "../config/service.ts";
import type { LocalAuthResult, PairResult } from "../auth/type.ts";

export function formatAuthPaired(result: PairResult) {
  return `paired: ${result.url}\nrole: ${result.role}\nexpires: ${result.expiresAt}`;
}

export function formatAuthLocalHuman(result: LocalAuthResult) {
  return [
    `paired: ${result.url}`,
    `role: ${result.role}`,
    `expires: ${result.expiresAt}`,
    `baseDir: ${result.baseDir}`,
  ].join("\n");
}

export function formatAuthLocalJson(result: LocalAuthResult) {
  return result;
}

export function formatAuthStatusHuman(input: {
  readonly config: ResolvedConfig;
  readonly result: AuthSessionState;
}) {
  return [
    `url: ${input.config.url}`,
    `authenticated: ${input.result.authenticated ? "yes" : "no"}`,
    ...(input.result.role !== undefined ? [`role: ${input.result.role}`] : []),
    ...(input.result.expiresAt !== undefined ? [`expires: ${input.result.expiresAt}`] : []),
  ].join("\n");
}

export function formatAuthStatusJson(input: {
  readonly config: ResolvedConfig;
  readonly result: AuthSessionState;
}) {
  return {
    ...input.result,
    url: input.config.url,
    source: input.config.source,
  };
}
