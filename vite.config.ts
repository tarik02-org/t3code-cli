import { defineConfig } from "vite-plus";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  pack: {
    define: {
      T3CLI_VERSION: JSON.stringify(packageJson.version),
    },
    entry: {
      bin: "src/bin.ts",
      index: "src/index.ts",
      application: "src/exports/application.ts",
      auth: "src/exports/auth.ts",
      config: "src/exports/config.ts",
      connection: "src/exports/connection.ts",
      contracts: "src/exports/contracts.ts",
      layout: "src/exports/layout.ts",
      orchestration: "src/exports/orchestration.ts",
      rpc: "src/exports/rpc.ts",
      runtime: "src/exports/runtime.ts",
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
