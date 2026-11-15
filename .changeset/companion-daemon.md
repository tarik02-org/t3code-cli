---
"t3code-cli": minor
---

add the `t3cli companion` prototype: a daemon that lets an agent wait for threads and pull requests instead of polling them. One MCP tool, `wait`, takes a condition (a thread's state on any stored environment, a pull request's state on GitHub, a time, combined with any/all/not), an optional deadline and a wake policy; `wait_now`, `waits`, `wait_cancel` and `wait_result` go with it, and `t3cli waits` lists and cancels. It starts at login with `t3cli companion install`. Open subscription streams now end when their socket closes instead of hanging; `t3cli env remove` now needs `--name` or `--environment` instead of falling back to the default environment
