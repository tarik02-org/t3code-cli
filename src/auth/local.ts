import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/unstable/process/ChildProcess";
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner";

import { normalizeHttpBaseUrl } from "../config/url.ts";
import { Environment, type EnvironmentShape } from "../environment/service.ts";
import { AuthLocalError } from "./error.ts";
import {
  decodeAuthLocalRuntimeStateFromJson,
  decodeAuthLocalSessionIssueResultFromJson,
  type AuthLocalSessionIssueResult,
} from "./schema.ts";
import type { LocalAuthInput } from "./type.ts";

export const issueLocalSession = Effect.fn("issueLocalSession")(function* (
  input: Pick<LocalAuthInput, "baseDir" | "t3Bin" | "role" | "label" | "subject">,
) {
  const environment = yield* Environment;
  const baseDir = yield* resolveLocalBaseDir(input.baseDir, environment);
  if (input.label.length === 0) {
    return yield* Effect.fail(new AuthLocalError({ message: "local auth label cannot be empty" }));
  }
  if (input.subject.length === 0) {
    return yield* Effect.fail(
      new AuthLocalError({ message: "local auth subject cannot be empty" }),
    );
  }

  const args = [
    "auth",
    "session",
    "issue",
    "--base-dir",
    baseDir,
    "--json",
    "--role",
    input.role,
    "--label",
    input.label,
    "--subject",
    input.subject,
  ];
  const output = yield* runLocalT3Command(input.t3Bin, args);
  const parsed = yield* parseSessionIssueOutput(output.stdout);
  return { baseDir, session: parsed } as const;
});

export const resolveLocalOrigin = Effect.fn("resolveLocalOrigin")(function* (input: {
  readonly baseDir: string;
  readonly origin?: string;
}) {
  if (input.origin !== undefined) {
    return yield* normalizeLocalOrigin(input.origin);
  }

  const path = yield* Path.Path;
  const runtimeStatePath = path.join(input.baseDir, "userdata", "server-runtime.json");
  const fs = yield* FileSystem.FileSystem;
  const raw = yield* fs.readFileString(runtimeStatePath).pipe(
    Effect.mapError(
      (error) =>
        new AuthLocalError({
          message: `local runtime state not found: ${runtimeStatePath}`,
          cause: error,
        }),
    ),
  );
  const state = yield* decodeAuthLocalRuntimeStateFromJson(raw).pipe(
    Effect.mapError(
      (error) =>
        new AuthLocalError({ message: "local runtime state has invalid shape", cause: error }),
    ),
  );
  return yield* normalizeLocalOrigin(state.origin);
});

function parseSessionIssueOutput(
  stdout: string,
): Effect.Effect<AuthLocalSessionIssueResult, AuthLocalError> {
  return decodeAuthLocalSessionIssueResultFromJson(stdout).pipe(
    Effect.mapError(
      (error) => new AuthLocalError({ message: "local auth returned invalid shape", cause: error }),
    ),
  );
}

function normalizeLocalOrigin(origin: string) {
  return normalizeHttpBaseUrl(origin).pipe(
    Effect.mapError((error) => new AuthLocalError({ message: error.message, cause: error })),
  );
}

const runLocalT3Command = Effect.fn("runLocalT3Command")(function* (
  t3Bin: string,
  args: ReadonlyArray<string>,
) {
  const spawner = yield* ChildProcessSpawner;
  const child = yield* spawner.spawn(ChildProcess.make(t3Bin, args)).pipe(
    Effect.mapError(
      (error) =>
        new AuthLocalError({
          message: `local auth failed: ${error instanceof Error ? error.message : "failed to spawn t3"}`,
          cause: error,
        }),
    ),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectProcessOutput(child.stdout),
      collectProcessOutput(child.stderr),
      child.exitCode.pipe(Effect.map(Number)),
    ],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.mapError(
      (error) =>
        new AuthLocalError({
          message: `local auth failed: ${error instanceof Error ? error.message : "failed to read t3 output"}`,
          cause: error,
        }),
    ),
  );

  if (exitCode !== 0) {
    return yield* Effect.fail(
      new AuthLocalError({
        message: `local auth failed: ${formatCommandFailure(stderr, stdout, exitCode)}`,
      }),
    );
  }

  return { stdout, stderr };
});

const collectProcessOutput = <E>(stream: Stream.Stream<Uint8Array, E>): Effect.Effect<string, E> =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (acc, chunk) => acc + chunk,
    ),
  );

const resolveLocalBaseDir = Effect.fn("resolveLocalBaseDir")(function* (
  input: string | undefined,
  environment: EnvironmentShape,
) {
  const path = yield* Path.Path;
  const envBaseDir = environment.env.T3CODE_HOME;
  const raw = input ?? envBaseDir;
  if (raw === undefined || raw.length === 0) {
    return path.join(environment.homeDir, ".t3");
  }
  if (raw === "~") {
    return environment.homeDir;
  }
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.join(environment.homeDir, raw.slice(2));
  }
  return path.resolve(environment.cwd, raw);
});

function formatCommandFailure(stderr: string, stdout: string, exitCode: number) {
  const stderrDetail = stderr.trim();
  if (stderrDetail.length > 0) {
    return stderrDetail;
  }
  const stdoutDetail = stdout.trim();
  if (stdoutDetail.length > 0) {
    return stdoutDetail;
  }
  return `t3 exited with code ${exitCode}`;
}
