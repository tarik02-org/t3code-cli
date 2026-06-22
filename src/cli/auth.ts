import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/unstable/cli";

import {
  formatAuthLocalHuman,
  formatAuthLocalJson,
  formatAuthPaired,
  formatAuthStatusHuman,
  formatAuthStatusJson,
} from "./format/auth.ts";
import { T3Auth } from "../auth/service.ts";
import { CliRuntime } from "../cli/runtime/service.ts";
import { loadT3CliEnv } from "../config/env/env.ts";
import { requireEnvironmentReplaceConfirmation } from "./interaction/confirm.ts";
import { envNameFlag, formatFlag, replaceFlag } from "./flags.ts";
import { resolveOutputFormat } from "./format/output.ts";
import { T3Output } from "./output/service.ts";

const persistAuthEnvironment = Effect.fn("persistAuthEnvironment")(function* (input: {
  readonly explicitName: Option.Option<string>;
  readonly fallbackName: string;
  readonly url: string;
  readonly token: string;
  readonly local: boolean;
  readonly replace: boolean;
}) {
  const auth = yield* T3Auth;
  const cliRuntime = yield* CliRuntime;
  const t3CliEnv = yield* loadT3CliEnv;
  const environmentName = Option.isSome(input.explicitName)
    ? input.explicitName.value
    : input.fallbackName;
  const exists = yield* auth.environmentExists(environmentName);
  if (exists) {
    yield* requireEnvironmentReplaceConfirmation({
      name: environmentName,
      replace: input.replace,
      cliRuntime,
      t3CliEnv,
    });
  }
  return yield* auth.persistEnvironment({
    name: environmentName,
    url: input.url,
    token: input.token,
    local: input.local,
    replace: input.replace,
    allowReplace: true,
  });
});

export function createAuthCommand() {
  return Command.make("auth").pipe(
    Command.withDescription("auth commands"),
    Command.withSubcommands([pairCommand, localCommand, statusCommand]),
  );
}

const pairCommand = Command.make(
  "pair",
  {
    url: Flag.string("url"),
    local: Flag.boolean("local"),
    name: envNameFlag,
    replace: replaceFlag,
    format: formatFlag,
  },
  ({ url, local, name, replace, format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const result = yield* auth.pair(url);
      const fallbackName = yield* auth.defaultNameFromUrl(result.url);
      const environmentName = yield* persistAuthEnvironment({
        explicitName: name,
        fallbackName,
        url: result.url,
        token: result.token,
        local,
        replace,
      });
      const payload = { ...result, name: environmentName };
      if (resolvedFormat === "json") {
        yield* output.printJson(payload);
      } else {
        yield* output.printInfo(formatAuthPaired(payload));
      }
    }),
).pipe(Command.withDescription("pair with t3code server"));

const localCommand = Command.make(
  "local",
  {
    baseDir: Flag.string("base-dir").pipe(Flag.optional),
    origin: Flag.string("origin").pipe(Flag.optional),
    role: Flag.choice("role", ["owner", "client"] as const).pipe(Flag.withDefault("owner")),
    label: Flag.string("label").pipe(Flag.withDefault("t3cli")),
    subject: Flag.string("subject").pipe(Flag.withDefault("t3cli-local")),
    name: envNameFlag,
    replace: replaceFlag,
    format: formatFlag,
  },
  ({ baseDir, origin, role, label, subject, name, replace, format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const result = yield* auth.local({
        role,
        label,
        subject,
        ...(Option.isSome(baseDir) ? { baseDir: baseDir.value } : {}),
        ...(Option.isSome(origin) ? { origin: origin.value } : {}),
      });
      const fallbackName = yield* auth.defaultNameForLocal();
      const environmentName = yield* persistAuthEnvironment({
        explicitName: name,
        fallbackName,
        url: result.url,
        token: result.token,
        local: true,
        replace,
      });
      const payload = { ...result, name: environmentName };
      if (resolvedFormat === "json") {
        yield* output.printJson(formatAuthLocalJson(payload));
      } else {
        yield* output.printInfo(formatAuthLocalHuman(payload));
      }
    }),
).pipe(Command.withDescription("authenticate with local t3code installation"));

const statusCommand = Command.make(
  "status",
  {
    format: formatFlag,
  },
  ({ format }) =>
    Effect.gen(function* () {
      const auth = yield* T3Auth;
      const cliRuntime = yield* CliRuntime;
      const t3CliEnv = yield* loadT3CliEnv;
      const output = yield* T3Output;
      const resolvedFormat = resolveOutputFormat(format, cliRuntime, t3CliEnv, "json");
      const result = yield* auth.status();
      if (resolvedFormat === "json") {
        yield* output.printJson(formatAuthStatusJson(result));
      } else {
        yield* output.printInfo(formatAuthStatusHuman(result));
      }
    }),
).pipe(Command.withDescription("show auth status"));
