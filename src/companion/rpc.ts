import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { CompanionInvalidRequestError, CompanionStoreError } from "./error.ts";
import { CompanionEventKind, CompanionHealth, InboxEvent, Subscription } from "./schema.ts";

/** A thread as the CLI names it; the daemon resolves environment aliases and the default. */
export const ThreadRefInput = Schema.Struct({
  environment: Schema.optional(Schema.String),
  threadId: Schema.String,
});

const RequestError = Schema.Union([CompanionInvalidRequestError, CompanionStoreError]);

export const companionRpcPath = "/rpc";

/** The CLI's typed channel to the daemon; agents use the MCP tools over the same services. */
export class CompanionRpcs extends RpcGroup.make(
  Rpc.make("health", { success: CompanionHealth }),
  Rpc.make("shutdown"),
  Rpc.make("subscribe", {
    payload: {
      subscriber: ThreadRefInput,
      source: Schema.Struct({
        environment: Schema.optional(Schema.String),
        threadId: Schema.optional(Schema.String),
        projectId: Schema.optional(Schema.String),
      }),
      events: Schema.Array(CompanionEventKind),
      wake: Schema.Boolean,
    },
    success: Subscription,
    error: RequestError,
  }),
  Rpc.make("unsubscribe", {
    payload: { subscriber: ThreadRefInput, ids: Schema.Array(Schema.Int) },
    success: Schema.Int,
    error: RequestError,
  }),
  Rpc.make("subscriptions", {
    payload: { subscriber: ThreadRefInput },
    success: Schema.Array(Subscription),
    error: RequestError,
  }),
  Rpc.make("inbox", {
    payload: {
      subscriber: ThreadRefInput,
      includeAcked: Schema.Boolean,
      afterId: Schema.Int,
      limit: Schema.Int,
    },
    success: Schema.Array(InboxEvent),
    error: RequestError,
  }),
  Rpc.make("ack", {
    payload: { subscriber: ThreadRefInput, ids: Schema.Array(Schema.Int) },
    success: Schema.Int,
    error: RequestError,
  }),
  Rpc.make("wait", {
    payload: {
      subscriber: ThreadRefInput,
      afterId: Schema.Int,
      events: Schema.Array(CompanionEventKind),
      timeoutSeconds: Schema.Int,
    },
    success: Schema.Array(InboxEvent),
    error: RequestError,
  }),
) {}
