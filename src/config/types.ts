import type { EncryptedToken, StoredConfigV2File, StoredEnvironmentFile } from "./schema.ts";

export type EncryptedEnvironment = StoredEnvironmentFile;

export type EncryptedConfig = StoredConfigV2File;

export type DecryptedEnvironment = {
  readonly url: string;
  readonly local: boolean;
  readonly token: string;
};

export type DecryptedConfig = {
  readonly version: 2;
  readonly default?: string;
  readonly environments: Readonly<Record<string, DecryptedEnvironment>>;
};

export type EnvironmentSummary = {
  readonly name: string;
  readonly url: string;
  readonly local: boolean;
  readonly default: boolean;
};

export type ResolvedConfig = {
  readonly url: string;
  readonly token: string;
  readonly source: "env" | "config";
  readonly local: boolean;
  readonly environment?: string;
};

export type UpsertEnvironmentInput = {
  readonly name: string;
  readonly url: string;
  readonly token: string;
  readonly local: boolean;
  readonly makeDefault?: boolean;
};

export type StoredConfig = DecryptedConfig;
export type StoredEnvironment = DecryptedEnvironment;

export type { EncryptedToken };
