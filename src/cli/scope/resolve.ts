import type { T3CliEnvScope } from "../../config/env/env.ts";

export function resolveProjectRef(input: {
  readonly value: string | undefined;
  readonly scope: T3CliEnvScope;
}): string | undefined {
  if (input.value !== undefined && input.value.length > 0) {
    return input.value;
  }
  const fromRoot = input.scope.t3codeProjectRoot;
  if (fromRoot !== undefined && fromRoot.length > 0) {
    return fromRoot;
  }
  const fromId = input.scope.t3codeProjectId;
  if (fromId !== undefined && fromId.length > 0) {
    return fromId;
  }
  return undefined;
}

export function resolveCommandProjectRef(input: {
  readonly value: string | undefined;
  readonly scope: T3CliEnvScope;
  readonly cwd: string;
  readonly isLocal?: boolean;
}): string | undefined {
  const explicit = resolveProjectRef({ value: input.value, scope: input.scope });
  if (explicit !== undefined) {
    return explicit;
  }
  if (input.isLocal ?? false) {
    return input.cwd;
  }
  return undefined;
}

export function resolveWorktreePath(input: {
  readonly value: string | undefined;
  readonly scope: T3CliEnvScope;
  readonly inferred?: string;
}): string | undefined {
  if (input.value !== undefined && input.value.length > 0) {
    return input.value;
  }
  const fromEnv = input.scope.t3codeWorktreePath;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return input.inferred;
}

export function resolveThreadId(input: {
  readonly value: string | undefined;
  readonly scope: T3CliEnvScope;
}): string | undefined {
  if (input.value !== undefined && input.value.length > 0) {
    return input.value;
  }
  const fromEnv = input.scope.t3codeThreadId;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}
