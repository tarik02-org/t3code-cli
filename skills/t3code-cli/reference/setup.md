# Setup and auth

## Checklist

```
- [ ] t3cli auth local   OR   t3cli auth pair --url <url> [--local]
- [ ] t3cli auth status --format json
- [ ] t3cli project add --path .   (if project not registered)
- [ ] t3cli model list --format json
```

## Multiple environments

One `t3cli` install can store credentials for multiple servers. Environment names must be non-empty slugs: `[A-Za-z0-9._-]`.

```sh
t3cli auth pair --url <url> --name work
t3cli auth local --name local
t3cli auth list --format json
t3cli auth use work
t3cli --environment local project list
```

Selection precedence for runtime commands:

1. `--environment <name>`
2. `T3CLI_ENV=<name>`
3. config `default`

`T3CODE_URL` and `T3CODE_TOKEN` override the selected environment only when both are set.

## auth pair

Pair with a remote t3code server using a pairing URL from the server UI.

```sh
t3cli auth pair --url <url> [--name <name>] [--replace] [--local] [--format json]
```

| Flag        | Required | Description                                                            |
| ----------- | -------- | ---------------------------------------------------------------------- |
| `--url`     | yes      | Pairing URL                                                            |
| `--name`    | no       | Environment name (default: hostname slug from URL)                     |
| `--replace` | no       | Replace an existing environment with the same name and make it default |
| `--local`   | no       | Mark config as local; enables cwd project resolution                   |

## auth local

Authenticate against a local t3code installation. Always writes `local: true` to config.

```sh
t3cli auth local [--name <name>] [--replace] [--format json]
t3cli auth local --base-dir <path> --origin <url> --role owner
```

| Flag         | Default       | Description                               |
| ------------ | ------------- | ----------------------------------------- |
| `--name`     | `local`       | Environment name                          |
| `--replace`  | no            | Replace existing name and make it default |
| `--base-dir` | auto          | t3code data directory                     |
| `--origin`   | auto          | Server origin URL                         |
| `--role`     | `owner`       | `owner` or `client`                       |
| `--label`    | `t3cli`       | Client label                              |
| `--subject`  | `t3cli-local` | Token subject                             |

## auth list

```sh
t3cli auth list [--format json]
```

Lists stored environments only. JSON fields: `name`, `url`, `local`, `default`, `active`. Tokens are never printed.

## auth use

```sh
t3cli auth use <name> [--format json]
```

Sets the default environment without contacting the server.

## auth unpair

```sh
t3cli auth unpair [--name <name>] [--yes] [--format json]
```

Removes local CLI credentials for the default environment or `--name`. Requires confirmation; non-interactive mode requires `--yes`. Remote tokens may remain valid until natural expiry.

## auth status

```sh
t3cli auth status [--format json]
```

Returns active environment name when config-backed, plus current URL, `local`, `source`, role, and expiry.

## Local vs remote auth

| Config                                      | `--project` omitted                                                 |
| ------------------------------------------- | ------------------------------------------------------------------- |
| Local (`auth local` or `auth pair --local`) | Resolves from cwd when it maps to a known project                   |
| Remote pairing                              | Requires `--project` or `T3CODE_PROJECT_ROOT` / `T3CODE_PROJECT_ID` |

Re-run `auth status --format json` after pairing to confirm `local` is set when cwd resolution is needed.
