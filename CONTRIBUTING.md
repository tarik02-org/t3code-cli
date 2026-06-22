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
- Put shared test layers and shims in `src/test/layers/`; use `Environment.layerTest()` for home-dir fixtures.
- Split tests by module/concern; keep integration files under ~120 lines when possible.
- Reserve full app-layer smoke tests for CLI routing and end-to-end wiring only.

## pull requests

Keep changes scoped and small. Include user-facing README updates when command behavior changes.

Use short, lowercase commit and pull request titles.
