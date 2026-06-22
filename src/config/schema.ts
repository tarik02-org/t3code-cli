import * as Schema from "effect/Schema";

export const EncryptedTokenSchema = Schema.Struct({
  kind: Schema.Literal("encrypted"),
  alg: Schema.Literal("aes-256-gcm"),
  key: Schema.Literal("default"),
  nonce: Schema.String,
  ciphertext: Schema.String,
  tag: Schema.String,
});

export const StoredEnvironmentFileSchema = Schema.Struct({
  url: Schema.String,
  local: Schema.Boolean,
  token: EncryptedTokenSchema,
});

export const StoredConfigV2FileSchema = Schema.Struct({
  version: Schema.Literal(2),
  default: Schema.optionalKey(Schema.String),
  environments: Schema.Record(Schema.String, StoredEnvironmentFileSchema),
});

export const StoredConfigV1FileSchema = Schema.Struct({
  url: Schema.optionalKey(Schema.String),
  token: Schema.optionalKey(Schema.String),
  local: Schema.optionalKey(Schema.Boolean),
});

export type EncryptedToken = Schema.Schema.Type<typeof EncryptedTokenSchema>;
export type StoredEnvironmentFile = Schema.Schema.Type<typeof StoredEnvironmentFileSchema>;
export type StoredConfigV2File = Schema.Schema.Type<typeof StoredConfigV2FileSchema>;
export type StoredConfigV1File = Schema.Schema.Type<typeof StoredConfigV1FileSchema>;

export const StoredConfigV1FileJson = Schema.fromJsonString(StoredConfigV1FileSchema);
export const StoredConfigV2FileJson = Schema.fromJsonString(StoredConfigV2FileSchema);
export const UnknownConfigFileJson = Schema.UnknownFromJsonString;
