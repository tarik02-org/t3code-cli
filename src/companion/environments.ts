import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { T3Application } from "../application/service.ts";
import { T3Config } from "../config/config.ts";
import type { ConfigError } from "../config/error.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { CompanionEnvironmentError, CompanionUnknownEnvironmentError } from "./error.ts";
import type { CompanionEnvironmentStatus } from "./schema.ts";

export interface CompanionEnvironment {
  /** Canonical name; every stored name that points at the same server URL resolves to it. */
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly url: string;
  readonly orchestration: T3Orchestration["Service"];
  readonly application: T3Application["Service"];
  readonly status: Ref.Ref<Omit<CompanionEnvironmentStatus, "name" | "aliases" | "url">>;
  /** Owns the environment's connection; closed when the environment leaves the config. */
  readonly scope: Scope.Closeable;
}

/** Builds the t3cli service stack bound to one stored environment. */
export type ConnectEnvironment<E, R> = (
  environmentName: string,
) => Layer.Layer<T3Orchestration | T3Application, E, R>;

export const environmentKey = (environment: Pick<CompanionEnvironment, "name" | "url">) =>
  `${environment.name}|${environment.url}`;

interface EnvironmentSet {
  readonly all: ReadonlyArray<CompanionEnvironment>;
  readonly defaultName: string;
}

export class CompanionEnvironments extends Context.Service<
  CompanionEnvironments,
  {
    readonly all: Effect.Effect<ReadonlyArray<CompanionEnvironment>>;
    /** The current set, then every set a reload produces. */
    readonly changes: Stream.Stream<ReadonlyArray<CompanionEnvironment>>;
    readonly resolve: (
      name: string | undefined,
    ) => Effect.Effect<CompanionEnvironment, CompanionUnknownEnvironmentError>;
    readonly statuses: Effect.Effect<ReadonlyArray<CompanionEnvironmentStatus>>;
    /** Re-reads the stored environments, connecting new ones and closing removed ones. */
    readonly reload: Effect.Effect<void, ConfigError>;
  }
>()("t3cli/companion/CompanionEnvironments") {}

export const makeCompanionEnvironments = Effect.fn("makeCompanionEnvironments")(function* <E, R>(
  connect: ConnectEnvironment<E, R>,
  only: ReadonlyArray<string>,
) {
  const config = yield* T3Config;
  const parentScope = yield* Scope.Scope;
  const context = yield* Effect.context<R>();
  const state = yield* SubscriptionRef.make<EnvironmentSet>({ all: [], defaultName: "" });
  const reloading = yield* Semaphore.make(1);

  const build = Effect.fn("CompanionEnvironments.build")(function* (
    name: string,
    url: string,
    aliases: ReadonlyArray<string>,
  ) {
    const scope = yield* Scope.fork(parentScope);
    // A fresh memo map per environment: `buildWithScope` forks the caller's, which would reuse
    // the CLI's already built config and RPC layers, all bound to the default environment.
    const built = yield* Layer.buildWithMemoMap(
      connect(name),
      yield* Layer.makeMemoMap,
      scope,
    ).pipe(
      Effect.provide(context),
      Effect.mapError(
        (cause) =>
          new CompanionEnvironmentError({
            message: `failed to prepare environment ${name}`,
            environment: name,
            cause,
          }),
      ),
      Effect.tapError((error) =>
        Effect.logWarning(error.message, error.cause).pipe(
          Effect.andThen(Scope.close(scope, Exit.void)),
        ),
      ),
      Effect.option,
    );
    if (Option.isNone(built)) {
      return Option.none<CompanionEnvironment>();
    }
    return Option.some<CompanionEnvironment>({
      name,
      aliases,
      url,
      orchestration: Context.get(built.value, T3Orchestration),
      application: Context.get(built.value, T3Application),
      status: yield* Ref.make<Omit<CompanionEnvironmentStatus, "name" | "aliases" | "url">>({
        state: "connecting",
        lastError: null,
      }),
      scope,
    });
  });

  const reload = Effect.gen(function* () {
    const stored = yield* config.listEnvironments();
    const missing = only.filter((name) => !stored.some((env) => env.name === name));
    if (missing.length > 0) {
      yield* Effect.logWarning(`stored environments no longer include: ${missing.join(", ")}`);
    }
    const selected = only.length === 0 ? stored : stored.filter((env) => only.includes(env.name));

    // Several stored names can point at one server; one connection serves them all.
    const byUrl = new Map<string, Array<(typeof stored)[number]>>();
    for (const env of selected) {
      byUrl.set(env.url, [...(byUrl.get(env.url) ?? []), env]);
    }

    const previous = (yield* SubscriptionRef.get(state)).all;
    const next: Array<CompanionEnvironment> = [];
    for (const [url, group] of byUrl) {
      const preferred = group.find((env) => env.default) ?? group[0];
      if (preferred === undefined) {
        continue;
      }
      const aliases = group.map((env) => env.name).filter((name) => name !== preferred.name);
      const kept = previous.find((env) => env.name === preferred.name && env.url === url);
      if (kept !== undefined) {
        next.push({ ...kept, aliases });
        continue;
      }
      const built = yield* build(preferred.name, url, aliases);
      if (Option.isSome(built)) {
        yield* Effect.logInfo(`environment ${preferred.name} added (${url})`);
        next.push(built.value);
      }
    }

    const defaultName =
      next.find((env) =>
        stored.some((s) => s.default && (s.name === env.name || env.aliases.includes(s.name))),
      )?.name ??
      next[0]?.name ??
      "";
    yield* SubscriptionRef.set(state, { all: next, defaultName });

    // Publish first so the watcher stops following a removed environment before it closes.
    for (const env of previous) {
      if (!next.some((candidate) => candidate.scope === env.scope)) {
        yield* Effect.logInfo(`environment ${env.name} removed (${env.url})`);
        yield* Scope.close(env.scope, Exit.void);
      }
    }
  }).pipe(Semaphore.withPermits(reloading, 1));

  yield* reload;
  const initial = yield* SubscriptionRef.get(state);
  const unknown = only.filter((name) => !initial.all.some((env) => env.name === name));
  if (only.length > 0 && unknown.length === only.length) {
    return yield* new CompanionUnknownEnvironmentError({
      message: `unknown environment: ${unknown.join(", ")}`,
      environment: unknown.join(","),
    });
  }

  const resolve = Effect.fn("CompanionEnvironments.resolve")(function* (name: string | undefined) {
    const current = yield* SubscriptionRef.get(state);
    const wanted = name === undefined || name.length === 0 ? current.defaultName : name;
    const found = current.all.find((env) => env.name === wanted || env.aliases.includes(wanted));
    if (found === undefined) {
      return yield* new CompanionUnknownEnvironmentError({
        message: `companion is not connected to environment ${wanted}`,
        environment: wanted,
      });
    }
    return found;
  });

  const all = SubscriptionRef.get(state).pipe(Effect.map((current) => current.all));

  const statuses = all.pipe(
    Effect.flatMap((current) =>
      Effect.forEach(current, (env) =>
        Ref.get(env.status).pipe(
          Effect.map((status) => ({
            name: env.name,
            aliases: env.aliases,
            url: env.url,
            state: status.state,
            lastError: status.lastError,
          })),
        ),
      ),
    ),
  );

  return CompanionEnvironments.of({
    all,
    changes: SubscriptionRef.changes(state).pipe(Stream.map((current) => current.all)),
    resolve,
    statuses,
    reload,
  });
});

export const CompanionEnvironmentsLive = <E, R>(
  connect: ConnectEnvironment<E, R>,
  only: ReadonlyArray<string>,
) => Layer.effect(CompanionEnvironments, makeCompanionEnvironments(connect, only));
