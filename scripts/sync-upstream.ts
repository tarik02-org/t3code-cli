#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { parseDocument } from "yaml";

const synchronizedDependencyPatterns = ["@effect/*", "@noble/*", "effect", "jose", "yaml"];

const WorkspaceConfig = Schema.Struct({
  catalog: Schema.Record(Schema.String, Schema.String),
  patchedDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

const Dependencies = Schema.Record(Schema.String, Schema.String);
const PackageJson = Schema.StructWithRest(
  Schema.Struct({
    dependencies: Dependencies,
    devDependencies: Dependencies,
  }),
  [Schema.Record(Schema.String, Schema.Json)],
);
const decodePackageJson = Schema.decodeEffect(Schema.fromJsonString(PackageJson), {
  propertyOrder: "original",
});
const decodeWorkspaceConfig = Schema.decodeUnknownEffect(WorkspaceConfig);

export class SyncUpstreamError extends Schema.TaggedErrorClass<SyncUpstreamError>()(
  "SyncUpstreamError",
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {}

const syncError = (message: string) => (cause: unknown) =>
  new SyncUpstreamError({ message, cause });

const repoRoot = Effect.service(Path.Path).pipe(
  Effect.flatMap((path) => path.fromFileUrl(new URL("..", import.meta.url))),
  Effect.mapError(syncError("failed to resolve the repository root")),
);

const collectStream = <E>(stream: Stream.Stream<Uint8Array, E>) =>
  stream.pipe(
    Stream.decodeText(),
    Stream.runFold(
      () => "",
      (output, chunk) => output + chunk,
    ),
  );

const readWorkspaceConfig = Effect.fn("readWorkspaceConfig")(function* (filePath: string) {
  const fs = yield* FileSystem.FileSystem;
  const source = yield* fs
    .readFileString(filePath)
    .pipe(Effect.mapError(syncError(`failed to read '${filePath}'`)));
  const document = yield* Effect.try({
    try: () => parseDocument(source),
    catch: syncError(`failed to parse '${filePath}'`),
  });
  if (document.errors.length > 0) {
    return yield* new SyncUpstreamError({ message: `failed to parse '${filePath}'` });
  }
  const value: unknown = document.toJS();
  const config = yield* decodeWorkspaceConfig(value).pipe(
    Effect.mapError(syncError(`invalid workspace config in '${filePath}'`)),
  );

  return { config, document, source };
});

const updateSubmodule = Effect.fn("updateSubmodule")(function* (
  root: string,
  submodulePath: string,
  target: string | undefined,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const initialized = yield* fs
    .exists(path.join(submodulePath, ".git"))
    .pipe(Effect.mapError(syncError("failed to inspect upstream-t3code")));
  if (!initialized) {
    yield* spawner
      .exitCode(
        ChildProcess.make("git", ["submodule", "update", "--init", "--", "upstream-t3code"], {
          cwd: root,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      )
      .pipe(
        Effect.filterOrFail(
          (exitCode) => exitCode === 0,
          (exitCode) =>
            new SyncUpstreamError({
              message: `'git submodule update --init -- upstream-t3code' exited with code ${exitCode}`,
            }),
        ),
      );
  }

  const statusProcess = yield* spawner.spawn(
    ChildProcess.make("git", ["status", "--porcelain"], {
      cwd: submodulePath,
      stderr: "inherit",
    }),
  );
  const [status] = yield* Effect.all(
    [collectStream(statusProcess.stdout), statusProcess.exitCode],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.filterOrFail(
      ([, exitCode]) => exitCode === 0,
      ([, exitCode]) =>
        new SyncUpstreamError({
          message: `'git status --porcelain' exited with code ${exitCode}`,
        }),
    ),
  );
  if (status.trim().length > 0) {
    return yield* new SyncUpstreamError({
      message: "upstream-t3code has uncommitted changes; clean it before updating",
    });
  }

  const currentCommitProcess = yield* spawner.spawn(
    ChildProcess.make("git", ["rev-parse", "HEAD"], {
      cwd: submodulePath,
      stderr: "inherit",
    }),
  );
  const [currentCommitOutput] = yield* Effect.all(
    [collectStream(currentCommitProcess.stdout), currentCommitProcess.exitCode],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.filterOrFail(
      ([, exitCode]) => exitCode === 0,
      ([, exitCode]) =>
        new SyncUpstreamError({
          message: `'git rev-parse HEAD' exited with code ${exitCode}`,
        }),
    ),
  );
  const currentCommit = currentCommitOutput.trim();

  if (target === undefined) {
    return currentCommit;
  }

  yield* Console.log(`Fetching upstream T3 Code for target '${target}'...`);
  yield* spawner
    .exitCode(
      ChildProcess.make("git", ["fetch", "origin", "--tags", "--force"], {
        cwd: submodulePath,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }),
    )
    .pipe(
      Effect.filterOrFail(
        (exitCode) => exitCode === 0,
        (exitCode) =>
          new SyncUpstreamError({
            message: `'git fetch origin --tags --force' exited with code ${exitCode}`,
          }),
      ),
    );

  let ref: string;
  if (target === "stable" || target === "nightly") {
    const tagsProcess = yield* spawner.spawn(
      ChildProcess.make(
        "git",
        [
          "tag",
          "--list",
          target === "stable" ? "v[0-9]*" : "v*-nightly.*",
          "--sort=-version:refname",
        ],
        { cwd: submodulePath, stderr: "inherit" },
      ),
    );
    const [tagsOutput] = yield* Effect.all(
      [collectStream(tagsProcess.stdout), tagsProcess.exitCode],
      { concurrency: "unbounded" },
    ).pipe(
      Effect.filterOrFail(
        ([, exitCode]) => exitCode === 0,
        ([, exitCode]) =>
          new SyncUpstreamError({
            message: `'git tag --list' exited with code ${exitCode}`,
          }),
      ),
    );
    const tag = tagsOutput
      .trim()
      .split("\n")
      .find((candidate) =>
        target === "stable"
          ? /^v\d+\.\d+\.\d+$/u.test(candidate)
          : /^v\d+\.\d+\.\d+-nightly\..+$/u.test(candidate),
      );
    if (tag === undefined) {
      return yield* new SyncUpstreamError({ message: `no ${target} T3 Code tag was found` });
    }
    ref = tag;
  } else if (target === "main") {
    ref = "origin/main";
  } else if (/^v?\d+\.\d+\.\d+(?:-.+)?$/u.test(target)) {
    ref = target.startsWith("v") ? target : `v${target}`;
  } else {
    yield* spawner
      .exitCode(
        ChildProcess.make("git", ["fetch", "origin", target], {
          cwd: submodulePath,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      )
      .pipe(
        Effect.filterOrFail(
          (exitCode) => exitCode === 0,
          (exitCode) =>
            new SyncUpstreamError({
              message: `'git fetch origin ${target}' exited with code ${exitCode}`,
            }),
        ),
      );
    ref = "FETCH_HEAD";
  }

  const commitProcess = yield* spawner.spawn(
    ChildProcess.make("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd: submodulePath,
      stderr: "inherit",
    }),
  );
  const [commitOutput] = yield* Effect.all(
    [collectStream(commitProcess.stdout), commitProcess.exitCode],
    { concurrency: "unbounded" },
  ).pipe(
    Effect.filterOrFail(
      ([, exitCode]) => exitCode === 0,
      ([, exitCode]) =>
        new SyncUpstreamError({
          message: `'git rev-parse --verify ${ref}^{commit}' exited with code ${exitCode}`,
        }),
    ),
  );
  const commit = commitOutput.trim();

  if (commit !== currentCommit) {
    yield* spawner
      .exitCode(
        ChildProcess.make("git", ["checkout", "--detach", commit], {
          cwd: submodulePath,
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
        }),
      )
      .pipe(
        Effect.filterOrFail(
          (exitCode) => exitCode === 0,
          (exitCode) =>
            new SyncUpstreamError({
              message: `'git checkout --detach ${commit}' exited with code ${exitCode}`,
            }),
        ),
      );
  }

  return commit;
});

const synchronizeConfig = Effect.fn("synchronizeConfig")(function* (
  root: string,
  submodulePath: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const packageJsonPath = path.join(root, "package.json");
  const workspacePath = path.join(root, "pnpm-workspace.yaml");
  const upstreamWorkspacePath = path.join(submodulePath, "pnpm-workspace.yaml");
  const packageJsonSource = yield* fs
    .readFileString(packageJsonPath)
    .pipe(Effect.mapError(syncError(`failed to read '${packageJsonPath}'`)));
  const packageJson = yield* decodePackageJson(packageJsonSource).pipe(
    Effect.mapError(syncError(`invalid package manifest in '${packageJsonPath}'`)),
  );
  const rootWorkspace = yield* readWorkspaceConfig(workspacePath);
  const upstreamWorkspace = yield* readWorkspaceConfig(upstreamWorkspacePath);
  const synchronizedDependencies = Object.keys(rootWorkspace.config.catalog).filter((dependency) =>
    synchronizedDependencyPatterns.some((pattern) =>
      pattern.endsWith("*") ? dependency.startsWith(pattern.slice(0, -1)) : dependency === pattern,
    ),
  );
  const versions: Record<string, string> = {};

  for (const dependency of synchronizedDependencies) {
    const version = upstreamWorkspace.config.catalog[dependency];
    if (version === undefined) {
      return yield* new SyncUpstreamError({
        message: `upstream catalog does not define '${dependency}'`,
      });
    }
    versions[dependency] = version;
    rootWorkspace.document.setIn(["catalog", dependency], version);
  }

  const patchedDependencies = Object.fromEntries(
    Object.entries(rootWorkspace.config.patchedDependencies ?? {}).filter(
      ([dependency]) => !synchronizedDependencies.some((name) => dependency.startsWith(`${name}@`)),
    ),
  );
  for (const [dependency, patchFile] of Object.entries(
    upstreamWorkspace.config.patchedDependencies ?? {},
  )) {
    if (!synchronizedDependencies.some((name) => dependency.startsWith(`${name}@`))) {
      continue;
    }
    const patchPath = path.join("upstream-t3code", patchFile);
    const patchExists = yield* fs
      .exists(path.join(root, patchPath))
      .pipe(Effect.mapError(syncError(`failed to inspect '${patchPath}'`)));
    if (!patchExists) {
      return yield* new SyncUpstreamError({ message: `upstream patch '${patchFile}' is missing` });
    }
    patchedDependencies[dependency] = patchPath;
  }
  rootWorkspace.document.set("patchedDependencies", patchedDependencies);

  const nextDependencies = { ...packageJson.dependencies };
  const nextDevDependencies = { ...packageJson.devDependencies };
  for (const [dependency, version] of Object.entries(versions)) {
    if (nextDependencies[dependency] !== undefined && nextDependencies[dependency] !== "catalog:") {
      nextDependencies[dependency] = version;
    }
    if (
      nextDevDependencies[dependency] !== undefined &&
      nextDevDependencies[dependency] !== "catalog:"
    ) {
      nextDevDependencies[dependency] = version;
    }
  }

  const nextPackageJsonSource = `${JSON.stringify(
    {
      ...packageJson,
      dependencies: nextDependencies,
      devDependencies: nextDevDependencies,
    },
    null,
    2,
  )}\n`;
  const nextWorkspaceSource = rootWorkspace.document.toString();

  if (nextPackageJsonSource !== packageJsonSource) {
    yield* fs
      .writeFileString(packageJsonPath, nextPackageJsonSource)
      .pipe(Effect.mapError(syncError(`failed to write '${packageJsonPath}'`)));
  }
  if (nextWorkspaceSource !== rootWorkspace.source) {
    yield* fs
      .writeFileString(workspacePath, nextWorkspaceSource)
      .pipe(Effect.mapError(syncError(`failed to write '${workspacePath}'`)));
  }

  return versions;
});

const syncUpstream = Effect.fn("syncUpstream")(function* (target: string | undefined) {
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const root = yield* repoRoot;
  const submodulePath = path.join(root, "upstream-t3code");
  const commit = yield* updateSubmodule(root, submodulePath, target).pipe(Effect.scoped);
  const versions = yield* synchronizeConfig(root, submodulePath);

  yield* Console.log("Installing synchronized dependencies...");
  yield* spawner
    .exitCode(
      ChildProcess.make("pnpm", ["install"], {
        cwd: root,
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      }),
    )
    .pipe(
      Effect.filterOrFail(
        (exitCode) => exitCode === 0,
        (exitCode) =>
          new SyncUpstreamError({
            message: `'pnpm install' exited with code ${exitCode}`,
          }),
      ),
    );
  yield* Console.log(`T3 Code: ${commit}`);
  for (const [dependency, version] of Object.entries(versions)) {
    yield* Console.log(`${dependency}: ${version}`);
  }
});

const syncUpstreamCommand = Command.make(
  "sync-upstream",
  {
    target: Flag.string("target").pipe(
      Flag.withDescription("T3 Code target: stable, nightly, main, a version, ref, or commit."),
      Flag.optional,
    ),
  },
  ({ target }) => syncUpstream(Option.getOrUndefined(target)),
).pipe(
  Command.withDescription(
    "Update the upstream T3 Code submodule and synchronize required dependencies and patches.",
  ),
);

if (import.meta.main) {
  Command.run(syncUpstreamCommand, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
