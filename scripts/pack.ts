#!/usr/bin/env node

// Upstream T3 Code never emits declarations, so a few of its exports infer types too large for
// declaration emit (TS7056). The ast-grep rules in `upstream-declarations/rules` annotate them;
// this applies them for the duration of `vp pack` and restores the upstream sources afterwards.
// Every rule must match exactly once, so an upstream change that moves one fails the build
// instead of shipping without types.

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

export class PackError extends Schema.TaggedError<PackError>()("PackError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {}

const packError = (message: string) => (cause: unknown) => new PackError({ message, cause });

const ScanMatches = Schema.fromJsonString(
  Schema.Array(Schema.Struct({ ruleId: Schema.String, file: Schema.String })),
);

const run = Effect.fn("run")(function* (
  command: string,
  args: ReadonlyArray<string>,
  options: { readonly cwd: string; readonly capture?: boolean },
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const child = yield* spawner.spawn(
    ChildProcess.make(command, args, {
      cwd: options.cwd,
      stdin: "inherit",
      stdout: options.capture === true ? "pipe" : "inherit",
      stderr: "inherit",
    }),
  );
  const [stdout, exitCode] = yield* Effect.all(
    [Stream.mkString(Stream.decodeText(child.stdout)), child.exitCode],
    { concurrency: "unbounded" },
  );
  if (exitCode !== 0) {
    return yield* new PackError({ message: `${command} ${args[0]} exited with code ${exitCode}` });
  }
  return stdout;
}, Effect.scoped);

const annotateUpstream = Effect.fn("annotateUpstream")(function* (root: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const rulesDir = path.join(root, "scripts/upstream-declarations/rules");
  const astGrep = [
    "scan",
    "--config",
    path.join(root, "scripts/upstream-declarations/sgconfig.yml"),
    "upstream-t3code/packages",
  ];

  const ruleIds = (yield* fs
    .readDirectory(rulesDir)
    .pipe(Effect.mapError(packError(`failed to read ${rulesDir}`))))
    .filter((file) => file.endsWith(".yml"))
    .map((file) => file.slice(0, -".yml".length));
  const matches = yield* run("ast-grep", [...astGrep, "--json=compact"], {
    cwd: root,
    capture: true,
  }).pipe(
    Effect.flatMap(Schema.decodeEffect(ScanMatches)),
    Effect.mapError(packError("failed to scan upstream declarations")),
  );
  for (const ruleId of ruleIds) {
    const count = matches.filter((match) => match.ruleId === ruleId).length;
    if (count !== 1) {
      return yield* new PackError({ message: `rule ${ruleId} matched ${count} times, expected 1` });
    }
  }

  const originals = new Map<string, string>();
  for (const file of new Set(matches.map((match) => path.join(root, match.file)))) {
    originals.set(
      file,
      yield* fs.readFileString(file).pipe(Effect.mapError(packError(`failed to read ${file}`))),
    );
  }
  yield* run("ast-grep", [...astGrep, "--update-all"], { cwd: root }).pipe(
    Effect.onError(() => restoreUpstream(originals).pipe(Effect.ignore)),
  );
  return originals;
});

const restoreUpstream = Effect.fn("restoreUpstream")(function* (
  originals: ReadonlyMap<string, string>,
) {
  const fs = yield* FileSystem.FileSystem;
  for (const [file, source] of originals) {
    yield* fs
      .writeFileString(file, source)
      .pipe(Effect.mapError(packError(`failed to restore ${file}`)));
  }
});

const pack = Effect.gen(function* () {
  const path = yield* Path.Path;
  const root = yield* path
    .fromFileUrl(new URL("..", import.meta.url))
    .pipe(Effect.mapError(packError("failed to resolve the repository root")));
  yield* Effect.acquireUseRelease(
    annotateUpstream(root),
    () => run("vp", ["pack"], { cwd: root }),
    (originals) => restoreUpstream(originals).pipe(Effect.orDie),
  );
});

pack.pipe(Effect.provide(NodeServices.layer), NodeRuntime.runMain);
