import { WS_METHODS } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";

import type {
  PreviewAutomationHost,
  PreviewAutomationHostFocus,
  PreviewAutomationResponse,
  PreviewAutomationStreamEvent,
} from "../contracts/index.ts";
import type { RpcError } from "../rpc/error.ts";
import { T3RpcOperations } from "../rpc/operation.ts";

export class T3PreviewAutomation extends Context.Service<
  T3PreviewAutomation,
  {
    readonly connect: (
      host: PreviewAutomationHost,
    ) => Stream.Stream<PreviewAutomationStreamEvent, RpcError>;
    readonly respond: (response: PreviewAutomationResponse) => Effect.Effect<void, RpcError>;
    readonly focusHost: (input: PreviewAutomationHostFocus) => Effect.Effect<void, RpcError>;
  }
>()("t3cli/T3PreviewAutomation") {}

export const makeT3PreviewAutomation = Effect.fn("makeT3PreviewAutomation")(function* () {
  const rpc = yield* T3RpcOperations;

  const connect: T3PreviewAutomation["Service"]["connect"] = (host) =>
    rpc.subscribe(WS_METHODS.previewAutomationConnect, (client) =>
      client[WS_METHODS.previewAutomationConnect](host),
    );
  const respond = Effect.fn("T3PreviewAutomation.respond")(function* (
    response: PreviewAutomationResponse,
  ) {
    return yield* rpc.run(WS_METHODS.previewAutomationRespond, (client) =>
      client[WS_METHODS.previewAutomationRespond](response),
    );
  });
  const focusHost = Effect.fn("T3PreviewAutomation.focusHost")(function* (
    input: PreviewAutomationHostFocus,
  ) {
    return yield* rpc.run(WS_METHODS.previewAutomationFocusHost, (client) =>
      client[WS_METHODS.previewAutomationFocusHost](input),
    );
  });

  return T3PreviewAutomation.of({ connect, respond, focusHost });
});

export const T3PreviewAutomationLive = Layer.effect(T3PreviewAutomation, makeT3PreviewAutomation());
