---
"t3code-cli": minor
---

add the `t3cli companion` prototype: a daemon that tells a coordinating agent what needs it in its threads and pull requests. The agent calls `watch` once; after that the threads it launches or writes to, and the pull requests linked to them or to it, are watched by themselves. Each event (`asks`, `done`, `failed`, `stuck` for a thread; `red`, `conflict`, `comment`, `merged`, `closed` and opt-in `green` for a pull request; `reminder`) is sent once per transition, dropped if it stopped being true first, and delivered in one digest that waits for the agent's turn to end unless it is urgent. MCP tools: `watch`, `unwatch`, `watching`, `remind`, `events`; `t3cli companion watching` lists what is watched. It starts at login with `t3cli companion install`. Open subscription streams now end when their socket closes instead of hanging; `t3cli env remove` now needs `--name` or `--environment` instead of falling back to the default environment
