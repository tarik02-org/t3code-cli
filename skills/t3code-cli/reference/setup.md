# Setup

## Pair once

```sh
t3cli auth local                     # T3 Code on this machine
t3cli auth pair --url <pairing-url>  # remote server; the URL comes from the server UI
t3cli auth status --format json
t3cli project add --path .           # when the project is not registered yet
```

Setup is done when `auth status` reports the expected `url` and `local`, and `model list` shows a
ready provider.

`local` decides how commands find the project when `--project` is omitted: local environments
(`auth local`, or `auth pair --local`) resolve it from the cwd; remote ones need `--project`,
`T3CODE_PROJECT_ROOT`, or `T3CODE_PROJECT_ID`.

`auth local` finds the server's data directory and origin on its own; pass `--base-dir` and
`--origin` for a non-default installation.

## Environments

One install stores credentials for several servers under slug names (`[A-Za-z0-9._-]`); `auth pair`
names an environment after the URL's host unless `--name` says otherwise.

A command uses `--environment`, then `T3CLI_ENV`, then the default set by `env use`. Setting both
`T3CODE_URL` and `T3CODE_TOKEN` bypasses stored environments entirely.

`env remove` deletes only local credentials; the server keeps the token valid until it expires.
