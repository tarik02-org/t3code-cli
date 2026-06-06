import * as Schema from "effect/Schema";

export const AuthAccessTokenResultSchema = Schema.Struct({
  access_token: Schema.String,
  issued_token_type: Schema.String,
  token_type: Schema.Literal("Bearer"),
  expires_in: Schema.Number,
  scope: Schema.String,
});
export type AuthAccessTokenResult = typeof AuthAccessTokenResultSchema.Type;

export type AuthBearerBootstrapResult = {
  readonly authenticated: true;
  readonly role: "owner" | "client";
  readonly sessionMethod: "bearer-access-token";
  readonly expiresAt: string;
  readonly sessionToken: string;
};

export const AuthSessionStateSchema = Schema.Struct({
  authenticated: Schema.Boolean,
  role: Schema.optionalKey(Schema.Literals(["owner", "client"])),
  sessionMethod: Schema.optionalKey(Schema.String),
  expiresAt: Schema.optionalKey(Schema.String),
});
export type AuthSessionState = typeof AuthSessionStateSchema.Type;

export const AuthWebSocketTokenResultSchema = Schema.Struct({
  token: Schema.String,
  expiresAt: Schema.String,
});
export type AuthWebSocketTokenResult = typeof AuthWebSocketTokenResultSchema.Type;

export const AuthLocalRuntimeStateSchema = Schema.Struct({
  version: Schema.Literal(1),
  origin: Schema.String,
});
export type AuthLocalRuntimeState = typeof AuthLocalRuntimeStateSchema.Type;

export const decodeAuthAccessTokenResult = Schema.decodeUnknownEffect(AuthAccessTokenResultSchema);
export const decodeAuthSessionState = Schema.decodeUnknownEffect(AuthSessionStateSchema);
export const decodeAuthWebSocketTokenResult = Schema.decodeUnknownEffect(
  AuthWebSocketTokenResultSchema,
);
export const decodeAuthLocalRuntimeState = Schema.decodeUnknownEffect(AuthLocalRuntimeStateSchema);
export const decodeAuthLocalRuntimeStateFromJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(AuthLocalRuntimeStateSchema),
);
