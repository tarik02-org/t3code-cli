# contributing

## setup

```sh
pnpm install
```

Requires Node.js 24 and pnpm 10.

## checks

Run the checks before opening a pull request:

```sh
pnpm check
pnpm typecheck
pnpm build
```

Useful focused commands:

```sh
pnpm format:check
pnpm lint
pnpm release:check
```

Use `pnpm format` and `pnpm lint:fix` for mechanical fixes.

## testing

- Prefer pure `it()` tests for logic with no service dependencies.
- Use `it.layer(ConfigPlatformLayer)` for config/auth tests that need filesystem, path, and crypto only — not full `NodeServices.layer`.
- Colocate tests as `{module}.test.ts` next to `{module}.ts`; shared fixtures use `{module}.test-utils.ts` in the same directory.
- Keep feature code grouped under its module (e.g. `config/credential/cipher.ts`, `config/url/error.ts`) with sibling-only `index.ts` barrels — no standalone `error/` directories, but each feature owns an `error.ts` when needed.
- Top-level module files use the module name (e.g. `config/config.ts` for `T3Config`, `config/error.ts` for shared config errors).
- Use `it.layer(ConfigPlatformLayer)` for config/auth tests that need filesystem, path, and crypto only — not full `NodeServices.layer`.
- Use `CliRuntime.layerTest()` for cwd fixtures and `config/env/env.test-utils.ts` for `HOME`.
- Split tests by module/concern; keep integration files under ~120 lines when possible.
- Reserve full app-layer smoke tests for CLI routing and end-to-end wiring only.

## pull requests

Keep changes scoped and small. Include user-facing README updates when command behavior changes.

Use short, lowercase commit and pull request titles.
