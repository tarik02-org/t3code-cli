#!/usr/bin/env node

// Upstream T3 Code never emits declarations, so a few of its exports infer types too large
// for declaration emit (TS7056). This adds explicit annotations to them for the duration of
// `vp pack` and restores the upstream sources afterwards. Every edit must match exactly once,
// so an upstream change that moves one fails the build instead of shipping without types.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class PackError extends Schema.TaggedError<PackError>()("PackError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

interface Edit {
  readonly file: string;
  readonly apply: (source: string) => string | PackError;
}

const replaceOnce =
  (file: string, from: string, to: string | ((source: string) => string | PackError)) =>
  (source: string) => {
    const index = source.indexOf(from);
    if (index === -1 || source.indexOf(from, index + 1) !== -1) {
      return new PackError({ message: `${file}: expected exactly one match for ${from}` });
    }
    const replacement = typeof to === "string" ? to : to(source);
    if (typeof replacement !== "string") {
      return replacement;
    }
    return source.slice(0, index) + replacement + source.slice(index + from.length);
  };

const contractsRpc = "upstream-t3code/packages/contracts/src/rpc.ts";
const contractsOrchestration = "upstream-t3code/packages/contracts/src/orchestrationV2.ts";
const clientRpcHttp = "upstream-t3code/packages/client-runtime/src/rpc/http.ts";
const clientRpcProtocol = "upstream-t3code/packages/client-runtime/src/rpc/protocol.ts";
const clientHttpAuth = "upstream-t3code/packages/client-runtime/src/state/environmentHttpAuth.ts";

const wsRpcGroupHead = "export const WsRpcGroup = RpcGroup.make(";
const rpcSchemasHead = "export const OrchestrationV2RpcSchemas = {";

const schemaType = (expression: string | undefined) =>
  expression === undefined
    ? undefined
    : /^\w+$/u.test(expression)
      ? `typeof ${expression}`
      : expression === "Schema.Struct({})"
        ? "Schema.Struct<{}>"
        : undefined;

const edits: ReadonlyArray<Edit> = [
  {
    file: contractsRpc,
    // Names the group's RPCs so the declaration references them instead of inlining schemas.
    apply: replaceOnce(contractsRpc, wsRpcGroupHead, (source) => {
      const start = source.indexOf(wsRpcGroupHead) + wsRpcGroupHead.length;
      const names = source
        .slice(start, source.indexOf(");", start))
        .split(",")
        .map((name) => name.trim())
        .filter((name) => name.length > 0);
      if (names.length === 0 || names.some((name) => !/^\w+$/u.test(name))) {
        return new PackError({
          message: `${contractsRpc}: WsRpcGroup members are not identifiers`,
        });
      }
      return `type WsRpcGroupRpcs = ${names.map((name) => `typeof ${name}`).join(" | ")};
export const WsRpcGroup: RpcGroup.RpcGroup<WsRpcGroupRpcs> = RpcGroup.make(`;
    }),
  },
  {
    file: contractsOrchestration,
    apply: replaceOnce(contractsOrchestration, rpcSchemasHead, (source) => {
      const start = source.indexOf(rpcSchemasHead);
      const body = source.slice(start, source.indexOf("} as const;", start));
      const entries = [
        ...body.matchAll(/(\w+): \{\s*input: ([^,]+),\s*output: ([^,]+),\s*\}/gu),
      ].map(([, method, input, output]) => ({ method, input, output }));
      const fields = entries.map(({ method, input, output }) => {
        const inputType = schemaType(input);
        const outputType = schemaType(output);
        return method === undefined || inputType === undefined || outputType === undefined
          ? undefined
          : `  readonly ${method}: { readonly input: ${inputType}; readonly output: ${outputType} };`;
      });
      if (fields.length === 0 || fields.some((field) => field === undefined)) {
        return new PackError({
          message: `${contractsOrchestration}: OrchestrationV2RpcSchemas has an unsupported entry`,
        });
      }
      return `export const OrchestrationV2RpcSchemas: {\n${fields.join("\n")}\n} = {`;
    }),
  },
  {
    file: clientRpcProtocol,
    apply: replaceOnce(
      clientRpcProtocol,
      `import { RpcClient } from "effect/unstable/rpc";

export const makeWsRpcProtocolClient = RpcClient.make(WsRpcGroup);`,
      `import type * as Scope from "effect/Scope";
import { RpcClient, type RpcClientError, type RpcGroup } from "effect/unstable/rpc";

export const makeWsRpcProtocolClient: Effect.Effect<
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof WsRpcGroup>, RpcClientError.RpcClientError>,
  never,
  RpcClient.Protocol | Scope.Scope
> = RpcClient.make(WsRpcGroup);`,
    ),
  },
  {
    file: clientRpcHttp,
    apply: (source) => {
      const withImports = replaceOnce(
        clientRpcHttp,
        `import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";`,
        `import type * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiClient from "effect/unstable/httpapi/HttpApiClient";
import type * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";`,
      )(source);
      if (typeof withImports !== "string") {
        return withImports;
      }
      return replaceOnce(
        clientRpcHttp,
        `export const makeEnvironmentHttpApiGroupClient = <
  Group extends keyof typeof EnvironmentHttpApi.groups,
>(
  httpBaseUrl: string,
  group: Group,
) =>`,
        `type EnvironmentHttpApiGroups =
  typeof EnvironmentHttpApi extends HttpApi.HttpApi<string, infer Groups> ? Groups : never;

export const makeEnvironmentHttpApiGroupClient = <
  Group extends keyof typeof EnvironmentHttpApi.groups,
>(
  httpBaseUrl: string,
  group: Group,
): Effect.Effect<
  HttpApiClient.Client.Group<
    HttpApiGroup.WithIdentifier<EnvironmentHttpApiGroups, Group>,
    HttpClientError.HttpClientError,
    never
  >,
  never,
  | HttpClient.HttpClient
  | HttpApiGroup.MiddlewareClient<HttpApiGroup.WithIdentifier<EnvironmentHttpApiGroups, Group>>
> =>`,
      )(withImports);
    },
  },
  {
    file: clientHttpAuth,
    // Mirrors the generator's input; an upstream change to it surfaces as a type error.
    apply: replaceOnce(
      clientHttpAuth,
      `export const executeAuthenticatedEnvironmentHttpRequest = Effect.fn(
  "clientRuntime.state.executeAuthenticatedEnvironmentHttpRequest",
)(function* <`,
      `export const executeAuthenticatedEnvironmentHttpRequest: <
  Group extends Parameters<typeof makeEnvironmentHttpApiGroupClient>[1],
  A,
  E,
  R,
>(input: {
  readonly prepared: PreparedConnection;
  readonly signer: Option.Option<ManagedRelayDpopSigner["Service"]>;
  readonly remoteAuthorization?: Option.Option<RemoteEnvironmentAuthorization["Service"]>;
  readonly method: HttpMethod.HttpMethod;
  readonly url: (httpBaseUrl: string) => string;
  readonly timeoutMs: number;
  readonly group: Group;
  readonly request: (input: {
    readonly client: Effect.Success<ReturnType<typeof makeEnvironmentHttpApiGroupClient<Group>>>;
    readonly headers: EnvironmentHttpAuthHeaders;
  }) => Effect.Effect<A, E, R>;
  readonly isUnauthorizedResponse?: (response: NoInfer<A>) => boolean;
}) => Effect.Effect<
  A,
  RemoteEnvironmentRequestError,
  Effect.Services<ReturnType<typeof makeEnvironmentHttpApiGroupClient<Group>>> | R
> = Effect.fn("clientRuntime.state.executeAuthenticatedEnvironmentHttpRequest")(function* <`,
    ),
  },
];

const packError = (message: string) => (cause: unknown) => new PackError({ message, cause });

const annotateUpstream = Effect.fn("annotateUpstream")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const originals = new Map<string, string>();
  yield* Effect.gen(function* () {
    for (const edit of edits) {
      const file = path.join(root, edit.file);
      const source = yield* fs
        .readFileString(file)
        .pipe(Effect.mapError(packError(`failed to read ${file}`)));
      const next = edit.apply(source);
      if (typeof next !== "string") {
        return yield* next;
      }
      originals.set(file, source);
      yield* fs
        .writeFileString(file, next)
        .pipe(Effect.mapError(packError(`failed to write ${file}`)));
    }
    return yield* Effect.void;
  }).pipe(Effect.onError(() => restoreUpstream(originals).pipe(Effect.ignore)));
  return originals;
});

const restoreUpstream = Effect.fn("restoreUpstream")(function* (
  originals: ReadonlyMap<string, string>,
) {
  const fs = yield* FileSystem.FileSystem;
  for (const [file, source] of originals) {
    yield* fs
      .writeFileString(file, source)
      .pipe(Effect.mapError(packError(`failed to restore ${file}`)));
  }
});

const pack = Effect.gen(function* () {
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* path
    .fromFileUrl(new URL("..", import.meta.url))
    .pipe(Effect.mapError(packError("failed to resolve the repository root")));
  yield* Effect.acquireUseRelease(
    annotateUpstream(root),
    () =>
      spawner
        .exitCode(
          ChildProcess.make("vp", ["pack"], {
            cwd: root,
            stdin: "inherit",
            stdout: "inherit",
            stderr: "inherit",
          }),
        )
        .pipe(
          Effect.mapError(packError("failed to run vp pack")),
          Effect.filterOrFail(
            (exitCode) => exitCode === 0,
            (exitCode) => new PackError({ message: `vp pack exited with code ${exitCode}` }),
          ),
        ),
    (originals) => restoreUpstream(originals).pipe(Effect.orDie),
  );
});

pack.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
