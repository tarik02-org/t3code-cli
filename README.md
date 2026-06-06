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
t3cli auth local [--base-dir <path>] [--origin <url>] [--role owner|client] [--label <label>] [--subject <subject>]
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

## terminal

```sh
t3cli terminal list <thread> [--format auto|human|json]
t3cli terminal create <thread> [command] [--id <id>] [--attach] [--format auto|human|json]
t3cli terminal attach <thread> <terminal-id>
t3cli terminal read <thread> <terminal-id> [--history] [--format json|ndjson]
t3cli terminal read <thread> <terminal-id> --history --follow --format ndjson [--from-sequence <n>]
t3cli terminal stream <thread> <terminal-id> [--format ndjson] [--from-sequence <n>]
t3cli terminal wait <thread> <terminal-id> [--for exited|closed|ended] [--format auto|human|json]
t3cli terminal write <thread> <terminal-id> <data> [--format auto|human|json] [--quiet]
t3cli terminal write <thread> <terminal-id> --stdin [--format auto|human|json] [--quiet]
t3cli terminal write <thread> <terminal-id> --hex <hex> [--format auto|human|json] [--quiet]
t3cli terminal write <thread> <terminal-id> --base64 <base64> [--format auto|human|json] [--quiet]
t3cli terminal destroy <thread> <terminal-id> [--format auto|human|json] [--quiet]
```

`terminal list` shows a one-shot snapshot of terminals for a thread. `terminal create` opens a server-owned terminal in the thread workspace, using the active thread worktree when present and the project workspace root otherwise. When `[command]` is provided, the CLI opens the terminal first and then writes `${command}\r`.

`terminal attach` replays terminal history and then streams live output while forwarding local input to the remote PTY. Use `Ctrl-]` to detach locally without destroying the remote terminal. `Ctrl-C` is forwarded to the remote terminal.

`terminal read` returns the current terminal snapshot. Add `--history` to include snapshot history. Add `--follow --format ndjson` to continue streaming structured events after the snapshot. `terminal stream` is the lower-level attach event stream for agents and always emits ndjson attach events.

`terminal wait` blocks until the terminal emits the requested lifecycle event. `exited` waits for the process to end, `closed` waits for the server-owned terminal session to be removed, and `ended` accepts either.

`terminal write` accepts exactly one payload source: raw argument text, `--stdin`, `--hex`, or `--base64`. `terminal destroy` performs a destructive close with history deletion.

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
