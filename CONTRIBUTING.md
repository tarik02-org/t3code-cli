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

## pull requests

Keep changes scoped and small. Include user-facing README updates when command behavior changes.

Use short, lowercase commit and pull request titles.
