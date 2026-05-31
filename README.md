# t3cli

Non-interactive CLI for a t3code server.

## install

```sh
pnpm add -g t3cli
```

## usage

Pair with a server:

```sh
t3cli auth pair <pairing-url>
```

Use a local t3code installation:

```sh
t3cli auth local
```

List projects:

```sh
t3cli projects list
```

Start a thread:

```sh
t3cli threads start <project> "message"
```

Wait for a thread:

```sh
t3cli threads wait <thread-id>
```

Use `--format json` for structured output and `--format ndjson --wait` for streaming thread events.
