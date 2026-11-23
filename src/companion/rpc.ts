import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { CompanionInvalidRequestError, CompanionStoreError } from "./error.ts";
import { CallerWatching, CompanionHealth, WatchingRequest } from "./schema.ts";

const RequestError = Schema.Union([CompanionInvalidRequestError, CompanionStoreError]);

export const companionRpcPath = "/rpc";

/** The CLI's typed channel to the daemon; agents use the MCP tools over the same watchlist. */
export class CompanionRpcs extends RpcGroup.make(
  Rpc.make("health", { success: CompanionHealth }),
  Rpc.make("shutdown"),
  Rpc.make("watching", {
    payload: WatchingRequest,
    success: Schema.Array(CallerWatching),
    error: RequestError,
  }),
) {}
