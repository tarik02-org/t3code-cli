export function resolveConfiguredEnvironment(input: {
  readonly cliFlag?: string | undefined;
  readonly t3cliEnv?: string | undefined;
}): string | undefined {
  const fromFlag = input.cliFlag?.trim();
  if (fromFlag !== undefined && fromFlag.length > 0) {
    return fromFlag;
  }
  const fromEnv = input.t3cliEnv?.trim();
  if (fromEnv !== undefined && fromEnv.length > 0) {
    return fromEnv;
  }
  return undefined;
}
