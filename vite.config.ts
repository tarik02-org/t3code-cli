// @effect-diagnostics nodeBuiltinImport:off - Vite config resolves local paths with node:path.
import path from "node:path";
import { fileURLToPath } from "node:url";

import "vite-plus/test/config";
import { defineConfig } from "vite-plus";
import packageJson from "./package.json" with { type: "json" };

const rootDir = path.dirname(fileURLToPath(import.meta.url));

function shouldBundlePackDependency(id: string): boolean {
  if (id === "@napi-rs/keyring" || id.startsWith("@napi-rs/keyring-")) {
    return false;
  }
  return true;
}

export default defineConfig({
  resolve: {
    alias: {
      "#t3tools/contracts": path.resolve(
        rootDir,
        "upstream-t3code/packages/contracts/src/index.ts",
      ),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "upstream-t3code/**"],
  },
  pack: {
    define: {
      T3CLI_VERSION: JSON.stringify(packageJson.version),
    },
    entry: {
      bin: "src/bin.ts",
      index: "src/index.ts",
      application: "src/application/index.ts",
      auth: "src/auth/index.ts",
      config: "src/config/index.ts",
      cli: "src/cli/index.ts",
      connection: "src/connection/index.ts",
      contracts: "src/contracts/index.ts",
      layout: "src/layout/index.ts",
      node: "src/node/index.ts",
      orchestration: "src/orchestration/index.ts",
      rpc: "src/rpc/index.ts",
      scope: "src/scope/index.ts",
      runtime: "src/runtime/index.ts",
      t3tools: "src/t3tools/index.ts",
    },
    deps: {
      alwaysBundle: shouldBundlePackDependency,
      onlyBundle: false,
    },
    dts: false,
    fixedExtension: false,
    format: "esm",
    hash: false,
    nodeProtocol: true,
    outputOptions: {
      codeSplitting: {
        groups: [
          {
            name: "shared",
            minShareCount: 2,
          },
        ],
      },
    },
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
      curly: "error",
      "no-console": ["error", { allow: ["error"] }],
      "typescript/prefer-nullish-coalescing": "error",
      "typescript/strict-boolean-expressions": [
        "error",
        {
          allowAny: false,
          allowNullableBoolean: false,
          allowNullableEnum: false,
          allowNullableNumber: false,
          allowNullableObject: false,
          allowNullableString: false,
          allowNumber: false,
          allowString: false,
        },
      ],
    },
  },
});
