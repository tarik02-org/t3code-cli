# t3code-cli

Non-interactive CLI for a t3code server.

## install

```sh
npm install --global t3code-cli
```

This installs the `t3cli` command.

## authenticate

```sh
t3cli auth pair <url>
t3cli auth local [--base-dir <path>] [--t3-command <command>] [--origin <url>] [--role owner|client] [--label <label>] [--subject <subject>]
t3cli auth status
```

Use `auth pair` with a pairing URL from a running t3code server, or `auth local` to authenticate against a local t3code installation.

## projects

```sh
t3cli projects list
t3cli projects add <path> [--title <title>]
```

`projects list` shows known projects. `projects add` registers a project path with the server.

## models

```sh
t3cli models list [--all] [--provider <provider>]
```

Lists available provider models. Use `--all` to include hidden or unavailable entries when the server exposes them.

## threads

```sh
t3cli threads list <project>
t3cli threads start <project> [message] [--stdin] [--title <title>] [--worktree <path>] [--provider <provider>] [--model <model>] [--option <key=value>] [--reasoning-effort <value>] [--effort <value>] [--fast-mode] [--thinking] [--wait]
t3cli threads send <thread> [message] [--stdin] [--option <key=value>] [--reasoning-effort <value>] [--effort <value>] [--fast-mode] [--thinking] [--wait]
t3cli threads messages <thread> [--limit <count>] [--full]
t3cli threads wait <thread>
t3cli threads archive <thread>
```

Use `--stdin` when the message should be read from standard input instead of an argument. Use `--wait` to stream until the thread pauses.

## output

Most commands support:

```sh
--format auto|human|json
```

Thread start/send commands also support `--format ndjson`; `threads wait` supports `--format human|ndjson`.

Global flags:

```sh
--help
--version
--completions bash|zsh|fish|sh
--log-level all|trace|debug|info|warn|warning|error|fatal|none
```
