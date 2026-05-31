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
