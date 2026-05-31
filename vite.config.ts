import { readFileSync } from "node:fs";
import { defineConfig } from "vite-plus";

const packageJson: unknown = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

if (
  typeof packageJson !== "object" ||
  packageJson === null ||
  !("version" in packageJson) ||
  typeof packageJson.version !== "string"
) {
  throw new Error("package version missing");
}

export default defineConfig({
  pack: {
    define: {
      T3CLI_VERSION: JSON.stringify(packageJson.version),
    },
    entry: {
      bin: "src/bin.ts",
    },
    deps: {
      onlyBundle: [
        "@effect/platform-node",
        "@effect/platform-node-shared",
        "detect-libc",
        "effect",
        "ini",
        "msgpackr",
        "msgpackr-extract",
        "node-gyp-build-optional-packages",
        "toml",
        "undici",
        "ws",
        "yaml",
      ],
    },
    dts: false,
    fixedExtension: false,
    format: "esm",
    nodeProtocol: true,
    sourcemap: false,
  },
  fmt: {
    ignorePatterns: ["node_modules/**", "dist/**", "upstream-t3code/**"],
    semi: true,
    singleQuote: false,
    sortPackageJson: true,
    trailingComma: "all",
  },
  lint: {
    categories: {
      correctness: "error",
      perf: "error",
      suspicious: "error",
    },
    ignorePatterns: ["node_modules/**", "dist/**", "upstream-t3code/**"],
    options: {
      denyWarnings: true,
      reportUnusedDisableDirectives: "error",
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-console": ["error", { allow: ["error"] }],
    },
  },
});
