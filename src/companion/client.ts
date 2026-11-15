import * as Effect from "effect/Effect";
import * as Filter from "effect/Filter";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as RpcClient from "effect/rpc/RpcClient";
import type { RpcClientError } from "effect/rpc/RpcClientError";
import * as RpcSerialization from "effect/rpc/RpcSerialization";

import { CompanionNotRunningError } from "./error.ts";
import { resolveCompanionPaths } from "./paths.ts";
import { CompanionRpcs, companionRpcPath } from "./rpc.ts";
import { CompanionRuntimeFile } from "./schema.ts";

const decodeRuntimeFile = Schema.decodeUnknownEffect(Schema.fromJsonString(CompanionRuntimeFile));

export type CompanionClient = RpcClient.FromGroup<typeof CompanionRpcs, RpcClientError>;

export const readCompanionRuntime = Effect.fn("readCompanionRuntime")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const paths = yield* resolveCompanionPaths();
  const raw = yield* fs.readFileString(paths.runtimeFile).pipe(
    Effect.catchFilter(Filter.reason("PlatformError", "NotFound"), (cause) =>
      Effect.fail(
        new CompanionNotRunningError({
          message: "companion is not running. run: t3cli companion start",
          cause,
        }),
      ),
    ),
  );
  return yield* decodeRuntimeFile(raw);
});

/** Runs `f` with a typed RPC client for the daemon at `url`. */
export const withCompanionClient = <A, E, R>(
  url: string,
  f: (client: CompanionClient) => Effect.Effect<A, E, R>,
) =>
  RpcClient.make(CompanionRpcs).pipe(
    Effect.flatMap(f),
    Effect.scoped,
    Effect.provide(
      RpcClient.layerProtocolHttp({ url: `${url}${companionRpcPath}` }).pipe(
        Layer.provide(RpcSerialization.layerNdjson),
      ),
    ),
  );

/** Like {@link withCompanionClient}, for the daemon named in the runtime file. */
export const withRunningCompanion = <A, E, R>(
  f: (client: CompanionClient) => Effect.Effect<A, E, R>,
) => readCompanionRuntime().pipe(Effect.flatMap((runtime) => withCompanionClient(runtime.url, f)));
