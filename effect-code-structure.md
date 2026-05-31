# Effect Code Structure

## Effect usage

- All workflows are `Effect` programs, mostly via `Effect.fn` and `Effect.gen`.
- CLI commands use `effect/unstable/cli`.
- Async/platform work stays in Effect services: HTTP, WebSocket, filesystem, stdio, child process.
- Streams model long-running RPC subscriptions: shell snapshots, thread snapshots, thread events.
- Runtime validation uses `effect/Schema`; decoded schemas live in each domain `schema.ts`.

## Service, layer, live approach

Module shape:

- `service.ts`: public interface via `Context.Service`.
- `layer.ts`: live adapter via `Layer.effect`.
- `schema.ts`: wire/runtime schemas.
- `type.ts`: plain domain types not part of service interface.
- `error.ts`: domain tagged errors.
- `<concept>.ts`: plain functions for one domain concept.

### `service.ts`

Service file owns interface only. No implementation, no platform imports.

```ts
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { UserError } from "./error.ts";
import type { UserProfile, UserRef } from "./type.ts";

export class UserService extends Context.Service<
  UserService,
  {
    readonly getProfile: (ref: UserRef) => Effect.Effect<UserProfile, UserError>;
    readonly updateProfile: (profile: UserProfile) => Effect.Effect<void, UserError>;
  }
>()("app/UserService") {}
```

### `layer.ts`

Layer file owns live implementation. Prefer `make*` factory with `Effect.fn`, then expose `*Live` via `Layer.effect`.

```ts
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { ConfigService } from "../config/service.ts";
import { UserNotFoundError, UserStorageError } from "./error.ts";
import { decodeUserProfile } from "./schema.ts";
import { UserService } from "./service.ts";
import type { UserRef } from "./type.ts";

export const makeUserService = Effect.fn("makeUserService")(function* () {
  const config = yield* ConfigService;

  const getProfile = Effect.fn("UserService.getProfile")(function* (ref: UserRef) {
    const raw = yield* config.read(`users/${ref.id}`).pipe(
      Effect.catchTags({
        ConfigNotFoundError: (error) =>
          Effect.fail(
            new UserNotFoundError({
              message: `user not found: ${ref.id}`,
              userId: ref.id,
              cause: error,
            }),
          ),
        ConfigStorageError: (error) =>
          Effect.fail(
            new UserStorageError({
              message: "failed to read user profile",
              cause: error,
            }),
          ),
      }),
    );

    return yield* decodeUserProfile(raw).pipe(
      Effect.catchTags({
        SchemaError: (error) =>
          Effect.fail(
            new UserStorageError({
              message: "stored user profile has invalid shape",
              cause: error,
            }),
          ),
      }),
    );
  });

  const updateProfile = Effect.fn("UserService.updateProfile")(function* (profile) {
    yield* config.write(`users/${profile.id}`, profile).pipe(
      Effect.catchTags({
        ConfigStorageError: (error) =>
          Effect.fail(
            new UserStorageError({
              message: "failed to write user profile",
              cause: error,
            }),
          ),
      }),
    );
  });

  return {
    getProfile,
    updateProfile,
  };
});

export const UserServiceLive = Layer.effect(UserService, makeUserService());
```

### `schema.ts`

Schema file owns runtime/wire shape and decode helpers. Keep service types out unless shape is reused at runtime.

```ts
import * as Schema from "effect/Schema";

export const UserProfileSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  role: Schema.Literals(["admin", "member"]),
  createdAt: Schema.String,
});
export type UserProfile = typeof UserProfileSchema.Type;

export const UserProfileJsonSchema = Schema.fromJsonString(UserProfileSchema);

export const decodeUserProfile = Schema.decodeUnknownEffect(UserProfileSchema);
export const decodeUserProfileJson = Schema.decodeUnknownEffect(UserProfileJsonSchema);
```

### `type.ts`

Type file owns plain compile-time domain types. Use it for results, inputs, refs, branded/plain values that are not service interface and not runtime schema.

```ts
import type { UserProfile } from "./schema.ts";

export type UserRef = {
  readonly id: string;
};

export type UserSummary = {
  readonly id: string;
  readonly label: string;
  readonly role: UserProfile["role"];
};

export type UpdateUserInput = {
  readonly ref: UserRef;
  readonly displayName: string;
};
```

### `<concept>.ts`

Plain function files own one small domain concept. Use them for pure functions or focused `Effect` functions that do not need their own service interface.

Good names are concrete domain names, not vague buckets:

- `selection.ts`
- `format.ts`
- `command.ts`
- `lookup.ts`
- `lifecycle.ts`

Avoid `utils.ts` unless no domain name exists.

```ts
import * as Effect from "effect/Effect";

import { UserNotFoundError } from "./error.ts";
import type { UserProfile } from "./schema.ts";
import type { UserRef } from "./type.ts";

export function formatUserLabel(profile: UserProfile) {
  return `${profile.displayName} (${profile.role})`;
}

export function findUserByRef(users: ReadonlyArray<UserProfile>, ref: UserRef) {
  const user = users.find((candidate) => candidate.id === ref.id);
  if (!user) {
    return Effect.fail(
      new UserNotFoundError({
        message: `user not found: ${ref.id}`,
        userId: ref.id,
      }),
    );
  }
  return Effect.succeed(user);
}
```

Rules:

- No `Context.Service`.
- No `Layer.effect`.
- No platform dependencies unless file is clearly an adapter.
- Keep functions close to domain language.
- Do not split tiny expressions into files just to make code look abstract.
- Promote to `service.ts` + `layer.ts` only when callers need dependency injection or multiple adapters.

### `error.ts`

Error file owns tagged domain errors. Causes are explicit schemas, never `Schema.Unknown`.

```ts
import * as Schema from "effect/Schema";

import { ConfigNotFoundError, ConfigStorageError } from "../config/error.ts";

const SchemaErrorCauseSchema = Schema.Struct({
  _tag: Schema.Literal("SchemaError"),
  message: Schema.String,
});

export class UserNotFoundError extends Schema.TaggedErrorClass<UserNotFoundError>()(
  "UserNotFoundError",
  {
    message: Schema.String,
    userId: Schema.String,
    cause: Schema.optionalKey(ConfigNotFoundError),
  },
) {}

export class UserStorageError extends Schema.TaggedErrorClass<UserStorageError>()(
  "UserStorageError",
  {
    message: Schema.String,
    cause: Schema.optionalKey(Schema.Union([ConfigStorageError, SchemaErrorCauseSchema])),
  },
) {}

export type UserError = UserNotFoundError | UserStorageError;
```

Typical services:

- `Config`: stored/env config resolution.
- `Auth`: authentication/session workflow.
- `Rpc`: cached RPC/WebSocket/HTTP client.
- `Orchestration`: adapter over remote orchestration methods.
- `Domain`: app workflows and business operations.
- `Input`: stdin or user input abstraction.
- `Output`: raw stdout/stderr, JSON, NDJSON, info printing.
- `Environment`: cwd/home/env snapshot.

## Dependency injection

- Dependencies are pulled with `yield* ServiceName`, not imported singletons.
- `runtime.ts` composes app services.
- entrypoint supplies platform adapters: `NodeServices.layer`, HTTP client, WebSocket constructor, `EnvironmentLive`.
- Domain modules depend on service interfaces, not live implementations.
- CLI depends on high-level services only: auth, domain, input, output.

Layer direction:

```txt
CLI
 -> Domain / Auth / Input / Output
 -> Orchestration
 -> Rpc
 -> Config / platform / websocket / http
```

## Error handling

Rules:

- No `new Error`.
- No `instanceof Error`.
- No `CliError`.
- No generic `toCliError`, `make*Error`, `unknownErrorMessage`.
- Errors are domain-specific `Schema.TaggedErrorClass`.
- Translate foreign/platform errors at domain boundary with `Effect.catchTags`.
- Handle each `_tag` explicitly.
- `cause` must be typed explicitly, not `Schema.Unknown`.
- CLI prints `error.message`; domains own error meaning.

Typical tagged error files:

- `src/<domain>/error.ts`
- `src/<adapter>/error.ts`
- `src/<workflow>/error.ts`
