import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { T3Version } from "./service.ts";

declare const T3CLI_VERSION: string;

const PackageJsonSchema = Schema.fromJsonString(Schema.Struct({ version: Schema.String }));

export const T3VersionBundledLive = Layer.sync(T3Version, () => ({ version: T3CLI_VERSION }));

export const T3VersionPackageJsonLive = Layer.effect(
  T3Version,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const packageJson = yield* fs.readFileString(
      fileURLToPath(new URL("../../package.json", import.meta.url)),
    );
    const decoded = yield* Schema.decodeUnknownEffect(PackageJsonSchema)(packageJson);
    return { version: decoded.version };
  }),
);
