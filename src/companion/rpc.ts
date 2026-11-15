import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { CompanionInvalidRequestError, CompanionStoreError } from "./error.ts";
import { CompanionHealth, WaitSelection, WaitsListing, WaitsRequest } from "./schema.ts";

const RequestError = Schema.Union([CompanionInvalidRequestError, CompanionStoreError]);

export const companionRpcPath = "/rpc";

/** The CLI's typed channel to the daemon; agents use the MCP tools over the same waits. */
export class CompanionRpcs extends RpcGroup.make(
  Rpc.make("health", { success: CompanionHealth }),
  Rpc.make("shutdown"),
  Rpc.make("waits", { payload: WaitsRequest, success: WaitsListing, error: RequestError }),
  Rpc.make("cancel", { payload: WaitSelection, success: Schema.Int, error: RequestError }),
) {}
