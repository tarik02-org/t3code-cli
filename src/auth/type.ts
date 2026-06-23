import type { AuthBearerBootstrapResult } from "./schema.ts";
import type { AuthSessionState } from "./schema.ts";

export type AuthSessionRole = AuthBearerBootstrapResult["role"];

export type PairingUrl = {
  readonly baseUrl: string;
  readonly credential: string;
};

export type AuthConfigInput = {
  readonly name: string;
  readonly url: string;
  readonly token: string;
  readonly local: boolean;
  readonly makeDefault?: boolean;
};

export type PersistEnvironmentInput = {
  readonly name: string;
  readonly url: string;
  readonly token: string;
  readonly local: boolean;
  readonly replace?: boolean;
  readonly allowReplace: boolean;
};

export type AuthResolvedConfig = {
  readonly url: string;
  readonly token: string;
  readonly source: "env" | "config";
  readonly local: boolean;
  readonly environment?: string;
};

export type AuthEnvironmentSummary = {
  readonly name: string;
  readonly url: string;
  readonly local: boolean;
  readonly default: boolean;
};

export type AuthStatusResult = {
  readonly config: AuthResolvedConfig;
  readonly session: AuthSessionState;
};

export type AuthEnvironmentListItem = AuthEnvironmentSummary & {
  readonly active: boolean;
};

export type PairResult = {
  readonly url: string;
  readonly token: string;
  readonly role: AuthBearerBootstrapResult["role"];
  readonly expiresAt: string;
};

export type LocalAuthInput = {
  readonly baseDir?: string;
  readonly origin?: string;
  readonly role: AuthSessionRole;
  readonly label: string;
  readonly subject: string;
};

export type LocalAuthTokenInput = Omit<LocalAuthInput, "origin">;

export type LocalAuthOriginInput = {
  readonly baseDir?: string;
  readonly origin?: string;
};

export type LocalAuthTokenResult = {
  readonly token: string;
  readonly role: AuthSessionRole;
  readonly expiresAt: string;
  readonly source: "local";
  readonly baseDir: string;
};

export type LocalAuthResult = {
  readonly url: string;
  readonly token: string;
  readonly role: AuthSessionRole;
  readonly expiresAt: string;
  readonly source: "local";
  readonly baseDir: string;
};

export type AuthUseResult = {
  readonly name: string;
  readonly default: true;
};

export type AuthUnpairResult = {
  readonly name: string;
  readonly removed: true;
};
