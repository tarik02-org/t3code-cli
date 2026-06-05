import * as Schema from "effect/Schema";

export const AuthBearerBootstrapResultSchema = Schema.Struct({
  authenticated: Schema.Literal(true),
  role: Schema.Literals(["owner", "client"]),
  sessionMethod: Schema.Literal("bearer-session-token"),
  expiresAt: Schema.String,
  sessionToken: Schema.String,
});
export type AuthBearerBootstrapResult = typeof AuthBearerBootstrapResultSchema.Type;

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

export const decodeAuthBearerBootstrapResult = Schema.decodeUnknownEffect(
  AuthBearerBootstrapResultSchema,
);
export const decodeAuthSessionState = Schema.decodeUnknownEffect(AuthSessionStateSchema);
export const decodeAuthWebSocketTokenResult = Schema.decodeUnknownEffect(
  AuthWebSocketTokenResultSchema,
);
export const decodeAuthLocalRuntimeState = Schema.decodeUnknownEffect(AuthLocalRuntimeStateSchema);
export const decodeAuthLocalRuntimeStateFromJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(AuthLocalRuntimeStateSchema),
);
