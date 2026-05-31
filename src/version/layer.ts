import { readFileSync } from "node:fs";
import * as Layer from "effect/Layer";

import { T3Version } from "./service.ts";

declare const T3CLI_VERSION: string;

export const T3VersionBundledLive = Layer.sync(T3Version, () => ({ version: T3CLI_VERSION }));

export const T3VersionPackageJsonLive = Layer.sync(T3Version, () => {
  const packageJson: unknown = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  );
  if (
    typeof packageJson !== "object" ||
    packageJson === null ||
    !("version" in packageJson) ||
    typeof packageJson.version !== "string"
  ) {
    throw new Error("package version missing");
  }
  return { version: packageJson.version };
});
