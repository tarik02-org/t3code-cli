---
"t3code-cli": minor
---

Restructure the CLI command surface for agent and human ergonomics.

- Rename command groups: `projects` → `project`, `models` → `model`, `threads` → `thread`
- Replace positional project/thread refs with `--project` and `--thread` flags
- Make `--project` optional with cwd-based resolution (id, workspace root, or nested worktree path)
- Infer worktree path from cwd when starting a thread inside a project subdirectory
- Add `project add --path` (defaults to `.`) and `auth pair --url`
- Add env fallbacks: `T3CODE_PROJECT_ROOT`, `T3CODE_PROJECT_ID`, `T3CODE_WORKTREE_PATH`, `T3CODE_THREAD_ID`

**BREAKING:** All previous CLI command names and positional arguments are removed. Update scripts and integrations to the new surface.
