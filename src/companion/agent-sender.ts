import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import { T3LocalAuthOrigin } from "../auth/local-origin.ts";
import { T3LocalAuthToken } from "../auth/local-token.ts";
import { loadT3CliEnv } from "../config/env/env.ts";
import { normalizeHttpBaseUrl } from "../config/url/url.ts";
import { CompanionAgentSendError } from "./error.ts";

/**
 * Sends a message the way T3 Code's own MCP tools do, so the target thread shows it as from an
 * agent. A websocket dispatch is always restamped as the user's, so this goes through `/mcp`.
 */
export interface AgentSender {
  readonly send: (input: {
    readonly threadId: string;
    readonly message: string;
    readonly mode: "auto" | "steer";
  }) => Effect.Effect<void, CompanionAgentSendError>;
}

// T3 Code's MCP endpoint speaks this revision only; effect's MCP client does not, hence the
// three JSON-RPC calls below.
const protocolVersion = "2025-06-18";
const sessionLabel = "t3cli companion";
/** Mint a new session this long before the current one expires. */
const renewBefore = Duration.days(1);

const JsonRpcResponse = Schema.Struct({
  result: Schema.optional(
    Schema.Struct({
      isError: Schema.optional(Schema.Boolean),
      content: Schema.optional(
        Schema.Array(Schema.Struct({ type: Schema.String, text: Schema.optional(Schema.String) })),
      ),
    }),
  ),
  error: Schema.optional(Schema.Struct({ code: Schema.Number, message: Schema.String })),
});
const decodeResponse = Schema.decodeUnknownEffect(Schema.fromJsonString(JsonRpcResponse));

/** A streamable HTTP reply is plain JSON or an event stream whose last data line holds it. */
export const responseJson = (contentType: string | undefined, body: string) =>
  contentType?.includes("text/event-stream") === true
    ? (body
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .at(-1) ?? "")
    : body;

const sendError =
  (operation: string) =>
  (cause: unknown): CompanionAgentSendError =>
    cause instanceof CompanionAgentSendError
      ? cause
      : new CompanionAgentSendError({
          message: `agent send ${operation} failed`,
          operation,
          cause,
        });

/**
 * Finds the T3 home whose running server answers at `url`: \`T3CODE_HOME\`, \`~/.t3\`, or a
 * sibling \`~/.t3-*\` such as a headless install.
 */
const findLocalBaseDir = Effect.fn("findLocalBaseDir")(function* (url: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const origins = yield* T3LocalAuthOrigin;
  const env = yield* loadT3CliEnv;
  const home = Option.getOrUndefined(env.home);
  const siblings =
    home === undefined
      ? []
      : (yield* fs.readDirectory(home).pipe(Effect.orElseSucceed(() => [] as Array<string>)))
          .filter((name) => name === ".t3" || name.startsWith(".t3-"))
          .map((name) => path.join(home, name));
  const candidates = [...Option.toArray(env.t3codeHome), ...siblings];
  const wanted = yield* normalizeHttpBaseUrl(url).pipe(Effect.orElseSucceed(() => url));
  for (const baseDir of candidates) {
    const origin = yield* origins.resolve({ baseDir }).pipe(Effect.option);
    if (Option.isSome(origin) && origin.value === wanted) {
      return Option.some(baseDir);
    }
  }
  return Option.none<string>();
});

/**
 * An agent sender for a local environment, or none when no T3 home on this machine serves it.
 * Its MCP client session is minted into that home's auth database, like `t3cli auth local`.
 */
export const makeLocalAgentSender = Effect.fn("makeLocalAgentSender")(function* (environment: {
  readonly name: string;
  readonly url: string;
}) {
  const baseDir = yield* findLocalBaseDir(environment.url);
  if (Option.isNone(baseDir)) {
    yield* Effect.logWarning(
      `no local T3 home serves ${environment.name} (${environment.url}); its digests stay user-marked`,
    );
    return Option.none<AgentSender>();
  }
  const tokens = yield* T3LocalAuthToken;
  const http = HttpClient.filterStatusOk(yield* HttpClient.HttpClient);
  const session = yield* Ref.make<{ readonly token: string; readonly expiresAtMs: number } | null>(
    null,
  );
  const endpoint = `${environment.url}/mcp`;

  const token = Effect.gen(function* () {
    const current = yield* Ref.get(session);
    const nowMs = yield* Clock.currentTimeMillis;
    if (current !== null && current.expiresAtMs - Duration.toMillis(renewBefore) > nowMs) {
      return current.token;
    }
    const issued = yield* tokens
      .create({
        baseDir: baseDir.value,
        role: "client",
        label: sessionLabel,
        subject: "mcp-client",
        // Subscriber threads usually run full-access; T3 Code refuses sends above the ceiling.
        runtimeModeCeiling: "full-access",
      })
      .pipe(Effect.mapError(sendError("mint the MCP client session")));
    const expiresAtMs = DateTime.toEpochMillis(DateTime.makeUnsafe(issued.expiresAt));
    yield* Ref.set(session, { token: issued.token, expiresAtMs });
    yield* Effect.logInfo(`minted an MCP client session for ${environment.name}`);
    return issued.token;
  });

  const call = Effect.fn("AgentSender.call")(function* (input: {
    readonly token: string;
    readonly sessionId: string | undefined;
    readonly body: Record<string, unknown>;
  }) {
    const request = HttpClientRequest.post(endpoint).pipe(
      HttpClientRequest.bearerToken(input.token),
      HttpClientRequest.setHeader("accept", "application/json, text/event-stream"),
      HttpClientRequest.setHeader("mcp-protocol-version", protocolVersion),
      input.sessionId === undefined
        ? (self) => self
        : HttpClientRequest.setHeader("mcp-session-id", input.sessionId),
      HttpClientRequest.bodyJsonUnsafe({ jsonrpc: "2.0", ...input.body }),
    );
    const response = yield* http.execute(request);
    return {
      sessionId: response.headers["mcp-session-id"],
      body: responseJson(response.headers["content-type"], yield* response.text),
    };
  });

  const sendOnce = Effect.fn("AgentSender.sendOnce")(function* (input: {
    readonly threadId: string;
    readonly message: string;
    readonly mode: "auto" | "steer";
  }) {
    const bearer = yield* token;
    const opened = yield* call({
      token: bearer,
      sessionId: undefined,
      body: {
        id: 1,
        method: "initialize",
        params: {
          protocolVersion,
          capabilities: {},
          clientInfo: { name: "t3cli-companion", version: "1" },
        },
      },
    });
    yield* call({
      token: bearer,
      sessionId: opened.sessionId,
      body: { method: "notifications/initialized" },
    });
    const sent = yield* call({
      token: bearer,
      sessionId: opened.sessionId,
      body: {
        id: 2,
        method: "tools/call",
        params: {
          name: "t3_thread_send",
          arguments: { threadId: input.threadId, message: input.message, mode: input.mode },
        },
      },
    });
    const reply = yield* decodeResponse(sent.body);
    const failure =
      reply.error?.message ??
      (reply.result?.isError === true
        ? (reply.result.content?.find((part) => part.text !== undefined)?.text ?? "tool error")
        : undefined);
    if (failure !== undefined) {
      yield* new CompanionAgentSendError({
        message: `t3_thread_send was refused: ${failure}`,
        operation: "send",
        cause: reply,
      });
    }
  });

  return Option.some<AgentSender>({
    send: (input) =>
      sendOnce(input).pipe(
        // A revoked or rejected session: mint a fresh one and try once more.
        Effect.catchTag("HttpClientError", () =>
          Ref.set(session, null).pipe(Effect.andThen(sendOnce(input))),
        ),
        Effect.mapError(sendError("send")),
      ),
  });
});
