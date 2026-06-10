import "vite-plus/test/config";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite-plus";
import packageJson from "./package.json" with { type: "json" };

const contractsEntry = fileURLToPath(
  new URL("./upstream-t3code/packages/contracts/src/index.ts", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "#t3tools/contracts": contractsEntry,
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
      orchestration: "src/orchestration/index.ts",
      rpc: "src/rpc/index.ts",
      scope: "src/scope/index.ts",
      runtime: "src/runtime/index.ts",
      t3tools: "src/t3tools/index.ts",
    },
    deps: {
      alwaysBundle: /^.+$/,
      onlyBundle: false,
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
