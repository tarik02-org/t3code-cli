#!/usr/bin/env node

// Upstream T3 Code never emits declarations, so a few of its exports infer types too large
// for declaration emit (TS7056). This annotates them for the duration of `vp pack` and
// restores the upstream sources afterwards. Every annotation must match exactly one
// declaration, so an upstream change that moves one fails the build instead of shipping
// without types.

import { Lang, parse, type Edit, type SgNode } from "@ast-grep/napi";
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

interface Annotation {
  readonly file: string;
  /** The exported name; `pattern` must bind it to `$NAME`. */
  readonly name: string;
  readonly pattern: string;
  readonly edit: (match: SgNode, name: SgNode) => Edit | PackError;
}

/** Adds `: type` after the declared name. */
const withType = (type: (match: SgNode) => string | PackError) => (match: SgNode, name: SgNode) => {
  const annotation = type(match);
  return typeof annotation === "string"
    ? name.replace(`${name.text()}: ${annotation}`)
    : annotation;
};

const schemaType = (expression: SgNode) => {
  if (expression.kind() === "identifier") {
    return `typeof ${expression.text()}`;
  }
  if (expression.text() === "Schema.Struct({})") {
    return "Schema.Struct<{}>";
  }
  return undefined;
};

const annotations: ReadonlyArray<Annotation> = [
  {
    // Names the group's RPCs so the declaration references them instead of inlining schemas.
    file: "upstream-t3code/packages/contracts/src/rpc.ts",
    name: "WsRpcGroup",
    pattern: "export const $NAME = RpcGroup.make($$$RPCS)",
    edit: withType((match) => {
      const rpcs = match
        .getMultipleMatches("RPCS")
        .filter((node) => node.kind() === "identifier")
        .map((node) => `typeof ${node.text()}`);
      return `RpcGroup.RpcGroup<${rpcs.join(" | ")}>`;
    }),
  },
  {
    file: "upstream-t3code/packages/contracts/src/orchestrationV2.ts",
    name: "OrchestrationV2RpcSchemas",
    pattern: "export const $NAME = { $$$ } as const",
    edit: withType((match) => {
      const fields: Array<string> = [];
      for (const entry of match.findAll("$METHOD: { input: $INPUT, output: $OUTPUT }")) {
        const input = schemaType(entry.getMatch("INPUT")!);
        const output = schemaType(entry.getMatch("OUTPUT")!);
        if (input === undefined || output === undefined) {
          return new PackError({
            message: `OrchestrationV2RpcSchemas: unsupported schema in ${entry.text()}`,
          });
        }
        fields.push(
          `readonly ${entry.getMatch("METHOD")!.text()}: { readonly input: ${input}; readonly output: ${output} }`,
        );
      }
      return `{ ${fields.join("; ")} }`;
    }),
  },
  {
    file: "upstream-t3code/packages/client-runtime/src/rpc/protocol.ts",
    name: "makeWsRpcProtocolClient",
    pattern: "export const $NAME = RpcClient.make(WsRpcGroup)",
    edit: withType(
      () =>
        `Effect.Effect<RpcClient.RpcClient<import("effect/unstable/rpc").RpcGroup.Rpcs<typeof WsRpcGroup>, import("effect/unstable/rpc").RpcClientError.RpcClientError>, never, RpcClient.Protocol | import("effect/Scope").Scope>`,
    ),
  },
  {
    file: "upstream-t3code/packages/client-runtime/src/rpc/http.ts",
    name: "makeEnvironmentHttpApiGroupClient",
    pattern: "export const $NAME = <$$$TYPES>($$$PARAMS) => $BODY",
    // Adds the return type after the parameter list.
    edit: (match) => {
      const parameters = match.find("<$$$TYPES>($$$PARAMS) => $BODY")?.field("parameters");
      if (parameters === undefined || parameters === null) {
        return new PackError({ message: "makeEnvironmentHttpApiGroupClient: no parameter list" });
      }
      const groups = `(typeof EnvironmentHttpApi extends import("effect/unstable/httpapi/HttpApi").HttpApi<string, infer Groups> ? Groups : never)`;
      const group = `import("effect/unstable/httpapi/HttpApiGroup").WithIdentifier<${groups}, Group>`;
      const end = parameters.range().end.index;
      return {
        startPos: end,
        endPos: end,
        insertedText: `: Effect.Effect<HttpApiClient.Client.Group<${group}, HttpClientError.HttpClientError, never>, never, HttpClient.HttpClient | import("effect/unstable/httpapi/HttpApiGroup").MiddlewareClient<${group}>>`,
      };
    },
  },
  {
    // Mirrors the generator's input; an upstream change to it surfaces as a type error.
    file: "upstream-t3code/packages/client-runtime/src/state/environmentHttpAuth.ts",
    name: "executeAuthenticatedEnvironmentHttpRequest",
    pattern: "export const $NAME = Effect.fn($LABEL)($GENERATOR)",
    edit: withType(
      () => `<
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
>`,
    ),
  },
];

const packError = (message: string) => (cause: unknown) => new PackError({ message, cause });

const annotate = (annotation: Annotation, source: string) => {
  const root = parse(Lang.TypeScript, source).root();
  const matches = root
    .findAll(annotation.pattern)
    .filter((match) => match.getMatch("NAME")?.text() === annotation.name);
  const match = matches[0];
  if (match === undefined || matches.length > 1) {
    return new PackError({
      message: `${annotation.file}: expected one declaration of ${annotation.name}, found ${matches.length}`,
    });
  }
  const edit = annotation.edit(match, match.getMatch("NAME")!);
  return edit instanceof PackError ? edit : root.commitEdits([edit]);
};

const annotateUpstream = Effect.fn("annotateUpstream")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const originals = new Map<string, string>();
  yield* Effect.gen(function* () {
    for (const annotation of annotations) {
      const file = path.join(root, annotation.file);
      const source = yield* fs
        .readFileString(file)
        .pipe(Effect.mapError(packError(`failed to read ${file}`)));
      const next = annotate(annotation, source);
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
