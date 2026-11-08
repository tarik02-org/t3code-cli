import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import { T3Application } from "../application/service.ts";
import { T3Config } from "../config/config.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { CompanionEnvironmentError, CompanionUnknownEnvironmentError } from "./error.ts";
import type { CompanionEnvironmentStatus } from "./schema.ts";

export interface CompanionEnvironment {
  /** Canonical name; every alias that points at the same server URL resolves to it. */
  readonly name: string;
  readonly aliases: ReadonlyArray<string>;
  readonly url: string;
  readonly orchestration: T3Orchestration["Service"];
  readonly application: T3Application["Service"];
  readonly status: Ref.Ref<Omit<CompanionEnvironmentStatus, "name" | "aliases" | "url">>;
}

/** Builds the t3cli service stack bound to one stored environment. */
export type ConnectEnvironment<E, R> = (
  environmentName: string,
) => Layer.Layer<T3Orchestration | T3Application, E, R>;

export class CompanionEnvironments extends Context.Service<
  CompanionEnvironments,
  {
    readonly all: ReadonlyArray<CompanionEnvironment>;
    readonly defaultName: string;
    readonly resolve: (
      name: string | undefined,
    ) => Effect.Effect<CompanionEnvironment, CompanionUnknownEnvironmentError>;
    readonly statuses: Effect.Effect<ReadonlyArray<CompanionEnvironmentStatus>>;
  }
>()("t3cli/companion/CompanionEnvironments") {}

export const makeCompanionEnvironments = Effect.fn("makeCompanionEnvironments")(function* <E, R>(
  connect: ConnectEnvironment<E, R>,
  only: ReadonlyArray<string>,
) {
  const config = yield* T3Config;
  const scope = yield* Scope.Scope;
  const stored = yield* config.listEnvironments();
  const selected = only.length === 0 ? stored : stored.filter((env) => only.includes(env.name));
  const missing = only.filter((name) => !stored.some((env) => env.name === name));
  if (missing.length > 0) {
    return yield* new CompanionUnknownEnvironmentError({
      message: `unknown environment: ${missing.join(", ")}`,
      environment: missing.join(","),
    });
  }

  // Several stored names often point at one server; one connection serves them all.
  const byUrl = new Map<string, Array<(typeof stored)[number]>>();
  for (const env of selected) {
    byUrl.set(env.url, [...(byUrl.get(env.url) ?? []), env]);
  }

  const all: Array<CompanionEnvironment> = [];
  for (const [url, group] of byUrl) {
    const preferred = group.find((env) => env.default) ?? group[0];
    if (preferred === undefined) {
      continue;
    }
    // A fresh memo map per environment: `buildWithScope` forks the caller's, which would reuse
    // the CLI's already built config and RPC layers, all bound to the default environment.
    const built = yield* Layer.buildWithMemoMap(
      connect(preferred.name),
      yield* Layer.makeMemoMap,
      scope,
    ).pipe(
      Effect.mapError(
        (cause) =>
          new CompanionEnvironmentError({
            message: `failed to prepare environment ${preferred.name}`,
            environment: preferred.name,
            cause,
          }),
      ),
      Effect.tapError((error) => Effect.logWarning(error.message, error.cause)),
      Effect.option,
    );
    if (Option.isNone(built)) {
      continue;
    }
    all.push({
      name: preferred.name,
      aliases: group.map((env) => env.name).filter((name) => name !== preferred.name),
      url,
      orchestration: Context.get(built.value, T3Orchestration),
      application: Context.get(built.value, T3Application),
      status: yield* Ref.make<Omit<CompanionEnvironmentStatus, "name" | "aliases" | "url">>({
        state: "connecting",
        lastError: null,
      }),
    });
  }

  const defaultName =
    all.find((env) =>
      stored.some((s) => s.default && (s.name === env.name || env.aliases.includes(s.name))),
    )?.name ??
    all[0]?.name ??
    "";

  const resolve = Effect.fn("CompanionEnvironments.resolve")(function* (name: string | undefined) {
    const wanted = name === undefined || name.length === 0 ? defaultName : name;
    const found = all.find((env) => env.name === wanted || env.aliases.includes(wanted));
    if (found === undefined) {
      return yield* new CompanionUnknownEnvironmentError({
        message: `companion is not connected to environment ${wanted}`,
        environment: wanted,
      });
    }
    return found;
  });

  const statuses = Effect.forEach(all, (env) =>
    Ref.get(env.status).pipe(
      Effect.map((status) => ({
        name: env.name,
        aliases: env.aliases,
        url: env.url,
        state: status.state,
        lastError: status.lastError,
      })),
    ),
  );

  return CompanionEnvironments.of({ all, defaultName, resolve, statuses });
});

export const CompanionEnvironmentsLive = <E, R>(
  connect: ConnectEnvironment<E, R>,
  only: ReadonlyArray<string>,
) => Layer.effect(CompanionEnvironments, makeCompanionEnvironments(connect, only));
