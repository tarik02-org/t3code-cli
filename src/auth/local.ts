import {
  AuthAdministrativeScopes,
  AuthSessionId,
  type AuthEnvironmentScope,
} from "#t3tools/contracts";
import { DatabaseSync } from "node:sqlite";
import * as Crypto from "node:crypto";
import * as NodeFs from "node:fs";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { normalizeHttpBaseUrl } from "../config/url.ts";
import { Environment, type EnvironmentShape } from "../environment/service.ts";
import { AuthLocalError } from "./error.ts";
import { decodeAuthLocalRuntimeStateFromJson } from "./schema.ts";
import type { LocalAuthInput } from "./type.ts";

export const issueLocalSession = Effect.fn("issueLocalSession")(function* (
  input: Pick<LocalAuthInput, "baseDir" | "role" | "label" | "subject">,
) {
  const environment = yield* Environment;
  const baseDir = yield* resolveLocalBaseDir(input.baseDir, environment);
  if (input.label.length === 0) {
    return yield* Effect.fail(new AuthLocalError({ message: "local auth label cannot be empty" }));
  }
  if (input.subject.length === 0) {
    return yield* Effect.fail(
      new AuthLocalError({ message: "local auth subject cannot be empty" }),
    );
  }

  const path = yield* Path.Path;
  const session = yield* issueLocalDatabaseSession({
    dbPath: path.join(baseDir, "userdata", "state.sqlite"),
    secretsDir: path.join(baseDir, "userdata", "secrets"),
    role: input.role,
    label: input.label,
    subject: input.subject,
  });
  return { baseDir, session } as const;
});

export const resolveLocalOrigin = Effect.fn("resolveLocalOrigin")(function* (input: {
  readonly baseDir: string;
  readonly origin?: string;
}) {
  if (input.origin !== undefined) {
    return yield* normalizeLocalOrigin(input.origin);
  }

  const path = yield* Path.Path;
  const runtimeStatePath = path.join(input.baseDir, "userdata", "server-runtime.json");
  const fs = yield* FileSystem.FileSystem;
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

function normalizeLocalOrigin(origin: string) {
  return normalizeHttpBaseUrl(origin).pipe(
    Effect.mapError((error) => new AuthLocalError({ message: error.message, cause: error })),
  );
}

const resolveLocalBaseDir = Effect.fn("resolveLocalBaseDir")(function* (
  input: string | undefined,
  environment: EnvironmentShape,
) {
  const path = yield* Path.Path;
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
});

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

const defaultSessionTtlMs = 30 * 24 * 60 * 60 * 1000;
const signingSecretName = "server-signing-key";

const issueLocalDatabaseSession = Effect.fn("issueLocalDatabaseSession")(function* (
  input: LocalDatabaseSessionInput,
) {
  const secret = yield* getOrCreateSigningSecret(input.secretsDir);
  const issuedAt = new Date();
  const expiresAt = new Date(issuedAt.getTime() + defaultSessionTtlMs);
  const sessionId = AuthSessionId.make(Crypto.randomUUID());
  const scopes = [...AuthAdministrativeScopes];
  const claims: LocalSessionClaims = {
    v: 1,
    kind: "session",
    sid: sessionId,
    sub: input.subject,
    scopes,
    method: "bearer-access-token",
    iat: issuedAt.getTime(),
    exp: expiresAt.getTime(),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(claims));
  const token = `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
  yield* insertAuthSession({
    dbPath: input.dbPath,
    sessionId,
    subject: input.subject,
    scopes,
    label: input.label,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  });
  return {
    token,
    role: input.role,
    expiresAt: expiresAt.toISOString(),
  };
});

const getOrCreateSigningSecret = Effect.fn("getOrCreateSigningSecret")(function* (
  secretsDir: string,
) {
  const path = yield* Path.Path;
  const secretPath = path.join(secretsDir, `${signingSecretName}.bin`);
  return yield* Effect.try({
    try: () => {
      try {
        return Uint8Array.from(NodeFs.readFileSync(secretPath));
      } catch (error) {
        if (!isNodeError(error, "ENOENT")) {
          throw error;
        }
      }

      NodeFs.mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
      NodeFs.chmodSync(secretsDir, 0o700);
      const generated = Crypto.randomBytes(32);
      try {
        NodeFs.writeFileSync(secretPath, generated, { flag: "wx", mode: 0o600 });
        NodeFs.chmodSync(secretPath, 0o600);
        return Uint8Array.from(generated);
      } catch (error) {
        if (isNodeError(error, "EEXIST")) {
          return Uint8Array.from(NodeFs.readFileSync(secretPath));
        }
        throw error;
      }
    },
    catch: (error) =>
      new AuthLocalError({
        message: `local auth failed to load signing secret: ${formatError(error)}`,
      }),
  });
});

type InsertAuthSessionInput = {
  readonly dbPath: string;
  readonly sessionId: AuthSessionId;
  readonly subject: string;
  readonly scopes: ReadonlyArray<AuthEnvironmentScope>;
  readonly label: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
};

function insertAuthSession(input: InsertAuthSessionInput) {
  return Effect.try({
    try: () => {
      const db = new DatabaseSync(input.dbPath);
      try {
        db.exec("PRAGMA busy_timeout = 5000;");
        db.exec("PRAGMA foreign_keys = ON;");
        const columns = db.prepare("PRAGMA table_info(auth_sessions)").all();
        if (!columns.some((column) => column["name"] === "scopes")) {
          throw new Error(
            `local auth database is missing scoped auth_sessions schema: ${input.dbPath}`,
          );
        }
        db.prepare(
          `
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
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, NULL, ?, ?, NULL)
        `,
        ).run(
          input.sessionId,
          input.subject,
          JSON.stringify(input.scopes),
          "bearer-access-token",
          input.label,
          "bot",
          input.issuedAt,
          input.expiresAt,
        );
      } finally {
        db.close();
      }
    },
    catch: (error) =>
      new AuthLocalError({
        message: `local auth failed to write session database: ${formatError(error)}`,
      }),
  });
}

function base64UrlEncode(input: string | Uint8Array): string {
  const buffer = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buffer.toString("base64url");
}

function signPayload(payload: string, secret: Uint8Array): string {
  return Crypto.createHmac("sha256", Buffer.from(secret)).update(payload).digest("base64url");
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
