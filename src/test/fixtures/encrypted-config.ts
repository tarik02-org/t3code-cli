import type { EncryptedConfig } from "../../config/types.ts";

export const sampleEncrypted = (input: {
  readonly default?: string;
  readonly environments?: EncryptedConfig["environments"];
}): EncryptedConfig => ({
  version: 2,
  ...(input.default !== undefined ? { default: input.default } : {}),
  environments: input.environments ?? {},
});

export const sampleEncryptedToken = () =>
  ({
    kind: "encrypted" as const,
    alg: "aes-256-gcm" as const,
    key: "default" as const,
    nonce: "n",
    ciphertext: "c",
    tag: "t",
  }) as const;
