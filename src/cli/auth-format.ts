import type {
  AuthEnvironmentListItem,
  AuthStatusResult,
  LocalAuthResult,
  PairResult,
} from "../auth/type.ts";

export function formatAuthPaired(result: PairResult & { readonly name: string }) {
  return `paired: ${result.url}\nname: ${result.name}\nrole: ${result.role}\nexpires: ${result.expiresAt}`;
}

export function formatAuthLocalHuman(result: LocalAuthResult & { readonly name: string }) {
  return [
    `paired: ${result.url}`,
    `name: ${result.name}`,
    `role: ${result.role}`,
    `expires: ${result.expiresAt}`,
    `baseDir: ${result.baseDir}`,
  ].join("\n");
}

export function formatAuthLocalJson(result: LocalAuthResult & { readonly name: string }) {
  return result;
}

export function formatAuthStatusHuman(input: AuthStatusResult) {
  return [
    ...(input.config.environment !== undefined ? [`environment: ${input.config.environment}`] : []),
    `url: ${input.config.url}`,
    `local: ${input.config.local ? "yes" : "no"}`,
    `source: ${input.config.source}`,
    `authenticated: ${input.session.authenticated ? "yes" : "no"}`,
    ...(input.session.role !== undefined ? [`role: ${input.session.role}`] : []),
    ...(input.session.expiresAt !== undefined ? [`expires: ${input.session.expiresAt}`] : []),
  ].join("\n");
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
  return environments
    .map((environment) => {
      const markers = [
        environment.default ? "default" : undefined,
        environment.active ? "active" : undefined,
      ].filter((marker) => marker !== undefined);
      const suffix = markers.length > 0 ? ` (${markers.join(", ")})` : "";
      return `${environment.name}: ${environment.url} [local=${environment.local ? "yes" : "no"}]${suffix}`;
    })
    .join("\n");
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
