import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { CompanionInvalidRequestError, CompanionStoreError } from "./error.ts";
import {
  CompanionHealth,
  InboxEvent,
  InboxListRequest,
  ResolveRequest,
  SnoozeRequest,
  SubscribeRequest,
  SubscribeResult,
  WaitRequest,
} from "./schema.ts";

const RequestError = Schema.Union([CompanionInvalidRequestError, CompanionStoreError]);

export const companionRpcPath = "/rpc";

/** The CLI's typed channel to the daemon; agents use the MCP tools over the same hub. */
export class CompanionRpcs extends RpcGroup.make(
  Rpc.make("health", { success: CompanionHealth }),
  Rpc.make("shutdown"),
  Rpc.make("subscribe", {
    payload: SubscribeRequest,
    success: SubscribeResult,
    error: RequestError,
  }),
  Rpc.make("inbox", {
    payload: InboxListRequest,
    success: Schema.Array(InboxEvent),
    error: RequestError,
  }),
  Rpc.make("resolve", { payload: ResolveRequest, success: Schema.Int, error: RequestError }),
  Rpc.make("snooze", { payload: SnoozeRequest, success: Schema.Int, error: RequestError }),
  Rpc.make("wait", {
    payload: WaitRequest,
    success: Schema.Array(InboxEvent),
    error: RequestError,
  }),
) {}
