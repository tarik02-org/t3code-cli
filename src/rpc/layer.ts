import type { ConnectionAttemptError } from "@t3tools/client-runtime/connection";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as SynchronizedRef from "effect/SynchronizedRef";

import { T3CodeConnectionError } from "../connection/error.ts";
import { T3PreparedConnectionProvider } from "../connection/prepared.ts";
import { RpcError } from "./error.ts";
import { T3RpcSessionFactory } from "./session.ts";
import { T3Rpc, type WsClient } from "./service.ts";

const connectionRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.setInputType<ConnectionAttemptError | T3CodeConnectionError>(),
  Schedule.upTo({ times: 4 }),
  Schedule.while((metadata) => Predicate.isTagged(metadata.input, "ConnectionTransientError")),
);

type Connection = {
  readonly scope: Scope.Closeable;
  readonly client: WsClient;
};

export const makeT3RpcLayer = Effect.fn("makeT3RpcLayer")(function* () {
  const preparedConnectionProvider = yield* T3PreparedConnectionProvider;
  const sessions = yield* T3RpcSessionFactory;
  const parentScope = yield* Scope.Scope;
  const connection = yield* SynchronizedRef.make(Option.none<Connection>());
  const openConnection = Effect.fn("T3RpcLive.openConnection")(function* () {
    const scope = yield* Scope.fork(parentScope);
    return yield* Effect.gen(function* () {
      const prepared = yield* preparedConnectionProvider.get;
      const session = yield* sessions
        .connect(prepared)
        .pipe(Effect.provideService(Scope.Scope, scope));
      yield* session.ready;
      const client: WsClient = session.client;
      return { scope, client } satisfies Connection;
    }).pipe(
      Effect.retry(connectionRetrySchedule),
      Effect.onError(() => Scope.close(scope, Exit.void)),
      Effect.mapError((error) => new RpcError({ message: error.message, cause: error })),
    );
  });

  const disconnect = Effect.fn("T3RpcLive.disconnect")(function* () {
    const current = yield* SynchronizedRef.getAndSet(connection, Option.none<Connection>());
    if (Option.isSome(current)) {
      yield* Scope.close(current.value.scope, Exit.void);
    }
  });

  const getClient = Effect.fn("T3RpcLive.getClient")(function* () {
    return yield* SynchronizedRef.modifyEffect(connection, (current) => {
      if (Option.isSome(current)) {
        return Effect.succeed([current.value.client, current] as const);
      }
      return openConnection().pipe(Effect.map((next) => [next.client, Option.some(next)] as const));
    });
  });

  return {
    getClient: getClient(),
    disconnect: disconnect(),
    reconnect: disconnect().pipe(Effect.andThen(getClient())),
  };
});

export const T3RpcLive = Layer.effectContext(
  makeT3RpcLayer().pipe(Effect.map((rpc) => Context.make(T3Rpc, rpc))),
);
