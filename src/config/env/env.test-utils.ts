import * as ConfigProvider from "effect/ConfigProvider";

export function t3CliEnvConfigLayer(
  homeDir: string,
  env: Readonly<Record<string, string | undefined>> = {},
) {
  const record: Record<string, string> = { HOME: homeDir };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      record[key] = value;
    }
  }
  return ConfigProvider.layer(ConfigProvider.fromEnv({ env: record }));
}
