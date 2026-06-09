# Setup and auth

## Checklist

```
- [ ] t3cli auth local   OR   t3cli auth pair --url <url> [--local]
- [ ] t3cli auth status --format json
- [ ] t3cli project add --path .   (if project not registered)
- [ ] t3cli model list --format json
```

## auth pair

Pair with a remote t3code server using a pairing URL from the server UI.

```sh
t3cli auth pair --url <url> [--local] [--format json]
```

| Flag      | Required | Description                                          |
| --------- | -------- | ---------------------------------------------------- |
| `--url`   | yes      | Pairing URL                                          |
| `--local` | no       | Mark config as local; enables cwd project resolution |

## auth local

Authenticate against a local t3code installation. Always writes `local: true` to config.

```sh
t3cli auth local [--format json]
t3cli auth local --base-dir <path> --origin <url> --role owner
```

| Flag         | Default       | Description           |
| ------------ | ------------- | --------------------- |
| `--base-dir` | auto          | t3code data directory |
| `--origin`   | auto          | Server origin URL     |
| `--role`     | `owner`       | `owner` or `client`   |
| `--label`    | `t3cli`       | Client label          |
| `--subject`  | `t3cli-local` | Token subject         |

## auth status

```sh
t3cli auth status [--format json]
```

Returns current URL, role, and whether config is local.

## Local vs remote auth

| Config                                      | `--project` omitted                                                 |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Local (`auth local` or `auth pair --local`) | Resolves from cwd when it maps to a known project                   |
| Remote pairing                              | Requires `--project` or `T3CODE_PROJECT_ROOT` / `T3CODE_PROJECT_ID` |

Re-run `auth status --format json` after pairing to confirm `local` is set when cwd resolution is needed.
