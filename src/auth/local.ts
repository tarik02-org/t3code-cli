import {
  AuthAdministrativeScopes,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "#t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as Filter from "effect/Filter";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { T3Config } from "../config/service.ts";
import { normalizeHttpBaseUrl } from "../config/url.ts";
import { Environment } from "../environment/service.ts";
import { SqlClientFactory } from "../sql/service.ts";
import {
  AuthConfigError,
  AuthLocalDatabaseError,
  AuthLocalError,
  AuthLocalSecretError,
  AuthLocalSigningError,
} from "./error.ts";
import { decodeAuthLocalRuntimeStateFromJson } from "./schema.ts";
import type { LocalAuthInput, LocalAuthResult } from "./type.ts";

export class T3LocalAuth extends Context.Service<
  T3LocalAuth,
  {
    readonly local: (
      input: LocalAuthInput,
    ) => Effect.Effect<LocalAuthResult, AuthConfigError | AuthLocalError>;
  }
>()("t3cli/T3LocalAuth") {}

export const makeT3LocalAuth = Effect.fn("makeT3LocalAuth")(function* () {
  const config = yield* T3Config;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const environment = yield* Environment;
  const crypto = yield* Crypto.Crypto;
  const sqlClientFactory = yield* SqlClientFactory;

  function resolveLocalBaseDir(input: string | undefined) {
    const envBaseDir = environment.env["T3CODE_HOME"];
    const raw = input ?? envBaseDir;
    if (raw === undefined || raw.length === 0) {
      return path.join(environment.homeDir, ".t3");
    }
    if (raw === "~") {
      return environment.homeDir;
    }
    if (raw.startsWith("~/") || raw.startsWith("~\\")) {
      return path.join(environment.homeDir, raw.slice(2));
    }
    return path.resolve(environment.cwd, raw);
  }

  function resolveLocalOrigin(input: { readonly baseDir: string; readonly origin?: string }) {
    return Effect.gen(function* () {
      if (input.origin !== undefined) {
        return yield* normalizeLocalOrigin(input.origin);
      }

      const runtimeStatePath = path.join(input.baseDir, "userdata", "server-runtime.json");
      const raw = yield* fs.readFileString(runtimeStatePath).pipe(
        Effect.mapError(
          (error) =>
            new AuthLocalError({
              message: `local runtime state not found: ${runtimeStatePath}. Make sure T3 Code is running with Network access enabled, or pass --origin manually.`,
              cause: error,
            }),
        ),
      );
      const state = yield* decodeAuthLocalRuntimeStateFromJson(raw).pipe(
        Effect.mapError(
          (error) =>
            new AuthLocalError({ message: "local runtime state has invalid shape", cause: error }),
        ),
      );
      return yield* normalizeLocalOrigin(state.origin);
    });
  }

  function readSigningSecret(secretPath: string) {
    return fs.readFile(secretPath).pipe(
      Effect.map((bytes) => Uint8Array.from(bytes)),
      Effect.catchFilter(Filter.reason("PlatformError", "NotFound"), () =>
        Effect.succeed(undefined),
      ),
      Effect.mapError(
        (error) =>
          new AuthLocalSecretError({
            message: `failed to read signing secret: ${secretPath}`,
            cause: error,
          }),
      ),
    );
  }

  const readRequiredSigningSecret = Effect.fn("readRequiredSigningSecret")(function* (
    secretsDir: string,
  ) {
    const secretPath = path.join(secretsDir, `${signingSecretName}.bin`);
    const secret = yield* readSigningSecret(secretPath);
    if (secret === undefined) {
      return yield* Effect.fail(
        new AuthLocalSecretError({
          message: `local signing secret not found: ${secretPath}`,
        }),
      );
    }
    return secret;
  });

  const hmacSha256 = (secret: Uint8Array, payload: Uint8Array) =>
    Effect.gen(function* () {
      const key =
        secret.byteLength > sha256BlockSize ? yield* crypto.digest("SHA-256", secret) : secret;
      const block = new Uint8Array(sha256BlockSize);
      block.set(key);
      const outerPad = block.map((byte) => byte ^ 0x5c);
      const innerPad = block.map((byte) => byte ^ 0x36);
      const innerHash = yield* crypto.digest("SHA-256", concatBytes(innerPad, payload));
      return yield* crypto.digest("SHA-256", concatBytes(outerPad, innerHash));
    });

  const signPayload = (payload: string, secret: Uint8Array) =>
    hmacSha256(secret, new TextEncoder().encode(payload)).pipe(
      Effect.map(Encoding.encodeBase64Url),
      Effect.mapError(
        (error) =>
          new AuthLocalSigningError({
            operation: "sign",
            message: "failed to sign local auth payload",
            cause: error,
          }),
      ),
    );

  function openAuthDatabase(dbPath: string) {
    return sqlClientFactory.sqliteClient({ filename: dbPath }).pipe(
      Effect.catchTag("SqlError", (error) =>
        Effect.fail(
          new AuthLocalDatabaseError({
            operation: "connect",
            message: error.message,
          }),
        ),
      ),
    );
  }

  const provideAuthDatabase =
    (dbPath: string) =>
    <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const sql = yield* openAuthDatabase(dbPath);
        return yield* effect.pipe(Effect.provideService(SqlClient.SqlClient, sql));
      }).pipe(Effect.scoped);

  const issueLocalDatabaseSession = Effect.fn("issueLocalDatabaseSession")(function* (
    input: LocalDatabaseSessionInput,
  ) {
    const secret = yield* readRequiredSigningSecret(input.secretsDir);
    const issuedAt = yield* DateTime.now;
    const expiresAt = DateTime.add(issuedAt, { milliseconds: defaultSessionTtlMs });
    const sessionId = yield* crypto.randomUUIDv4.pipe(
      Effect.map((id) => AuthSessionId.make(id)),
      Effect.mapError(
        (error) =>
          new AuthLocalSecretError({
            message: "failed to generate auth session id",
            cause: error,
          }),
      ),
    );
    const scopes = [...AuthAdministrativeScopes];
    const claims: LocalSessionClaims = {
      v: 1,
      kind: "session",
      sid: sessionId,
      sub: input.subject,
      scopes,
      method: "bearer-access-token",
      iat: DateTime.toEpochMillis(issuedAt),
      exp: DateTime.toEpochMillis(expiresAt),
    };
    const encodedPayload = Encoding.encodeBase64Url(JSON.stringify(claims));
    const token = `${encodedPayload}.${yield* signPayload(encodedPayload, secret)}`;
    yield* insertAuthSession({
      sessionId,
      subject: input.subject,
      scopes,
      label: input.label,
      issuedAt: DateTime.formatIso(issuedAt),
      expiresAt: DateTime.formatIso(expiresAt),
    }).pipe(
      provideAuthDatabase(input.dbPath),
      Effect.catchTag("SqlError", (error) =>
        Effect.fail(
          new AuthLocalDatabaseError({
            operation: Predicate.isTagged(error.reason, "ConnectionError") ? "connect" : "query",
            message: error.message,
          }),
        ),
      ),
    );
    return {
      token,
      role: input.role,
      expiresAt: DateTime.formatIso(expiresAt),
    };
  });

  function writeLocalConfig(input: { readonly url: string; readonly token: string }) {
    return Effect.gen(function* () {
      const existing = yield* config.readStored().pipe(
        Effect.catchTags({
          ConfigError: (error) =>
            Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
        }),
      );
      yield* config.writeStored({ ...existing, url: input.url, token: input.token }).pipe(
        Effect.catchTags({
          ConfigError: (error) =>
            Effect.fail(new AuthConfigError({ message: "auth config failed", cause: error })),
        }),
      );
    });
  }

  const local = Effect.fn("T3LocalAuthLive.local")(function* (input: LocalAuthInput) {
    if (input.label.length === 0) {
      return yield* Effect.fail(
        new AuthLocalError({ message: "local auth label cannot be empty" }),
      );
    }
    if (input.subject.length === 0) {
      return yield* Effect.fail(
        new AuthLocalError({ message: "local auth subject cannot be empty" }),
      );
    }

    const baseDir = resolveLocalBaseDir(input.baseDir);
    const session = yield* issueLocalDatabaseSession({
      dbPath: path.join(baseDir, "userdata", "state.sqlite"),
      secretsDir: path.join(baseDir, "userdata", "secrets"),
      role: input.role,
      label: input.label,
      subject: input.subject,
    }).pipe(
      Effect.mapError(
        (error) =>
          new AuthLocalError({ message: `local auth failed: ${error.message}`, cause: error }),
      ),
    );
    const url = yield* resolveLocalOrigin({
      baseDir,
      ...(input.origin !== undefined ? { origin: input.origin } : {}),
    });
    yield* writeLocalConfig({ url, token: session.token });
    return {
      url,
      role: session.role,
      expiresAt: session.expiresAt,
      source: "local" as const,
      baseDir,
    };
  });

  return { local };
});

export const T3LocalAuthLive = Layer.effect(T3LocalAuth, makeT3LocalAuth());

function insertAuthSession(input: InsertAuthSessionInput) {
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA busy_timeout = 5000;`;
    yield* sql`PRAGMA foreign_keys = ON;`;
    const columns = yield* sql<{ readonly name: string }>`PRAGMA table_info(auth_sessions)`;
    if (!columns.some((column) => column.name === "scopes")) {
      return yield* Effect.fail(
        new AuthLocalDatabaseError({
          operation: "schema",
          message: "local auth database is missing scoped auth_sessions schema",
        }),
      );
    }
    yield* sql`
      INSERT INTO auth_sessions (
        session_id,
        subject,
        scopes,
        method,
        client_label,
        client_ip_address,
        client_user_agent,
        client_device_type,
        client_os,
        client_browser,
        issued_at,
        expires_at,
        revoked_at
      )
      VALUES (
        ${input.sessionId},
        ${input.subject},
        ${JSON.stringify(input.scopes)},
        ${"bearer-access-token"},
        ${input.label},
        NULL,
        NULL,
        ${"bot"},
        NULL,
        NULL,
        ${input.issuedAt},
        ${input.expiresAt},
        NULL
      )
    `;
    return undefined;
  });
}

function normalizeLocalOrigin(origin: string) {
  return normalizeHttpBaseUrl(origin).pipe(
    Effect.mapError((error) => new AuthLocalError({ message: error.message, cause: error })),
  );
}

type LocalSessionClaims = {
  readonly v: 1;
  readonly kind: "session";
  readonly sid: AuthSessionId;
  readonly sub: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly method: "bearer-access-token";
  readonly iat: number;
  readonly exp: number;
};

type LocalDatabaseSessionInput = {
  readonly dbPath: string;
  readonly secretsDir: string;
  readonly role: LocalAuthInput["role"];
  readonly label: string;
  readonly subject: string;
};

type InsertAuthSessionInput = {
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly label: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
};

const defaultSessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const signingSecretName = "server-signing-key";
const sha256BlockSize = 64;

function concatBytes(first: Uint8Array, second: Uint8Array) {
  const bytes = new Uint8Array(first.byteLength + second.byteLength);
  bytes.set(first);
  bytes.set(second, first.byteLength);
  return bytes;
}
