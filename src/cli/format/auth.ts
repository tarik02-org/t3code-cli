import type {
  AuthEnvironmentListItem,
  AuthStatusResult,
  LocalAuthResult,
  PairResult,
} from "../../auth/type.ts";
import { formatRecord, formatTable } from "./human.ts";

export function formatAuthPaired(result: PairResult & { readonly name: string }) {
  return `paired\n${formatRecord([
    { field: "url", value: result.url },
    { field: "name", value: result.name },
    { field: "role", value: result.role },
    { field: "expires", value: result.expiresAt },
  ])}`;
}

export function formatAuthLocalHuman(result: LocalAuthResult & { readonly name: string }) {
  return `paired\n${formatRecord([
    { field: "url", value: result.url },
    { field: "name", value: result.name },
    { field: "role", value: result.role },
    { field: "expires", value: result.expiresAt },
    { field: "base dir", value: result.baseDir },
  ])}`;
}

export function formatAuthLocalJson(result: LocalAuthResult & { readonly name: string }) {
  return result;
}

export function formatAuthStatusHuman(input: AuthStatusResult) {
  return formatRecord([
    ...(input.config.environment !== undefined
      ? [{ field: "environment", value: input.config.environment }]
      : []),
    { field: "url", value: input.config.url },
    { field: "local", value: input.config.local ? "yes" : "no" },
    { field: "source", value: input.config.source },
    { field: "authenticated", value: input.session.authenticated ? "yes" : "no" },
    ...(input.session.role !== undefined ? [{ field: "role", value: input.session.role }] : []),
    ...(input.session.expiresAt !== undefined
      ? [{ field: "expires", value: input.session.expiresAt }]
      : []),
  ]);
}

export function formatAuthStatusJson(input: AuthStatusResult) {
  return {
    ...input.session,
    ...(input.config.environment !== undefined ? { environment: input.config.environment } : {}),
    url: input.config.url,
    source: input.config.source,
    local: input.config.local,
  };
}

export function formatAuthListHuman(environments: readonly AuthEnvironmentListItem[]) {
  if (environments.length === 0) {
    return "no environments";
  }
  return formatTable(
    [
      { header: "name", value: (environment) => environment.name, maxWidth: 24 },
      { header: "url", value: (environment) => environment.url, maxWidth: 72 },
      { header: "local", value: (environment) => (environment.local ? "yes" : "no"), maxWidth: 6 },
      {
        header: "default",
        value: (environment) => (environment.default ? "yes" : "no"),
        maxWidth: 7,
      },
      {
        header: "active",
        value: (environment) => (environment.active ? "yes" : "no"),
        maxWidth: 6,
      },
    ],
    environments,
  );
}

export function formatAuthListJson(environments: readonly AuthEnvironmentListItem[]) {
  return environments;
}

export function formatAuthUseHuman(result: { readonly name: string }) {
  return `default environment: ${result.name}`;
}

export function formatAuthUnpairHuman(result: { readonly name: string }) {
  return `removed environment: ${result.name}`;
}
