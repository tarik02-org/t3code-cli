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
import { T3Rpc, type T3RpcConnection, type T3RpcService } from "./service.ts";

const connectionRetrySchedule = Schedule.exponential("100 millis").pipe(
  Schedule.setInputType<ConnectionAttemptError | T3CodeConnectionError>(),
  Schedule.upTo({ times: 4 }),
  Schedule.while((metadata) => Predicate.isTagged(metadata.input, "ConnectionTransientError")),
);

interface Connection extends T3RpcConnection {
  readonly scope: Scope.Closeable;
}

export const makeT3RpcLayer: () => Effect.Effect<
  T3RpcService,
  never,
  T3PreparedConnectionProvider | T3RpcSessionFactory | Scope.Scope
> = Effect.fn("makeT3RpcLayer")(function* () {
  const preparedConnectionProvider = yield* T3PreparedConnectionProvider;
  const sessions = yield* T3RpcSessionFactory;
  const parentScope = yield* Scope.Scope;
  const connection = yield* SynchronizedRef.make(Option.none<Connection>());

  // A closed socket leaves the client unusable; forget it so the next call reconnects.
  const forgetOnClose = (current: Connection) =>
    current.closed.pipe(
      Effect.ignore,
      Effect.andThen(
        SynchronizedRef.modify(connection, (stored) =>
          Option.isSome(stored) && stored.value === current
            ? [true, Option.none<Connection>()]
            : [false, stored],
        ),
      ),
      Effect.flatMap((forgotten) =>
        forgotten ? Scope.close(current.scope, Exit.void) : Effect.void,
      ),
    );

  const openConnection = Effect.fn("T3RpcLive.openConnection")(function* () {
    const scope = yield* Scope.fork(parentScope);
    const opened = yield* Effect.gen(function* () {
      const prepared = yield* preparedConnectionProvider.get;
      const session = yield* sessions
        .connect(prepared)
        .pipe(Effect.provideService(Scope.Scope, scope));
      yield* session.ready;
      const closed = session.closed.pipe(
        Effect.mapError((cause) => new RpcError({ message: cause.message, cause })),
      );
      return { scope, client: session.client, closed } satisfies Connection;
    }).pipe(
      Effect.retry(connectionRetrySchedule),
      Effect.onError(() => Scope.close(scope, Exit.void)),
      Effect.mapError((error) => new RpcError({ message: error.message, cause: error })),
    );
    yield* Effect.forkIn(forgetOnClose(opened), parentScope);
    return opened;
  });

  const disconnect = Effect.fn("T3RpcLive.disconnect")(function* () {
    const current = yield* SynchronizedRef.getAndSet(connection, Option.none<Connection>());
    if (Option.isSome(current)) {
      yield* Scope.close(current.value.scope, Exit.void);
    }
  });

  const getConnection = Effect.fn("T3RpcLive.getConnection")(function* () {
    return yield* SynchronizedRef.modifyEffect(connection, (current) => {
      if (Option.isSome(current)) {
        return Effect.succeed([current.value, current] as const);
      }
      return openConnection().pipe(Effect.map((next) => [next, Option.some(next)] as const));
    });
  });

  const getClient = getConnection().pipe(Effect.map((current) => current.client));

  return T3Rpc.of({
    getClient,
    getConnection: getConnection(),
    disconnect: disconnect(),
    reconnect: disconnect().pipe(Effect.andThen(getClient)),
  });
});

export const T3RpcLive = Layer.effectContext(
  makeT3RpcLayer().pipe(Effect.map((rpc) => Context.make(T3Rpc, rpc))),
);
