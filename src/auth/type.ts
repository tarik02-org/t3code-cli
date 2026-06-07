import type { AuthBearerBootstrapResult } from "./schema.ts";

export type AuthSessionRole = AuthBearerBootstrapResult["role"];

export type PairingUrl = {
  readonly baseUrl: string;
  readonly credential: string;
};

export type AuthConfigInput = {
  readonly url: string;
  readonly token: string;
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
