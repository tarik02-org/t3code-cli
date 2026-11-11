---
"t3code-cli": minor
---

add the `t3cli companion` prototype: a daemon that watches threads across stored environments, keeps an inbox of idle/failed/needs-input/needs-approval/settled/env-down/env-up events (with the last message and PR state, resolved or snoozed by the subscriber, and woken by priority), serves it over MCP, starts at login with `t3cli companion install`, and adds `t3cli subscribe` and `t3cli inbox`; open subscription streams now end when their socket closes instead of hanging; `t3cli env remove` now needs `--name` or `--environment` instead of falling back to the default environment
