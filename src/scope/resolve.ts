export function resolveProjectRef(input: {
  readonly value: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  if (input.value !== undefined && input.value.length > 0) {
    return input.value;
  }
  const fromRoot = input.env.T3CODE_PROJECT_ROOT;
  if (fromRoot !== undefined && fromRoot.length > 0) {
    return fromRoot;
  }
  const fromId = input.env.T3CODE_PROJECT_ID;
  if (fromId !== undefined && fromId.length > 0) {
    return fromId;
  }
  return undefined;
}

export function resolveCommandProjectRef(input: {
  readonly value: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly isLocal?: boolean;
}): string | undefined {
  const explicit = resolveProjectRef({ value: input.value, env: input.env });
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
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly inferred?: string;
}): string | undefined {
  if (input.value !== undefined && input.value.length > 0) {
    return input.value;
  }
  const fromEnv = input.env.T3CODE_WORKTREE_PATH;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return input.inferred;
}

export function resolveThreadId(input: {
  readonly value: string | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}): string | undefined {
  if (input.value !== undefined && input.value.length > 0) {
    return input.value;
  }
  const fromEnv = input.env.T3CODE_THREAD_ID;
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}
