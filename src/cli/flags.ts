import { Flag } from "effect/unstable/cli";

import {
  humanJsonFormatChoices,
  humanJsonNdjsonFormatChoices,
  humanNdjsonFormatChoices,
} from "./format/output.ts";

export const projectFlag = Flag.string("project").pipe(
  Flag.withDescription(
    "Project id or path (default: cwd with local auth, or T3CODE_PROJECT_ROOT / T3CODE_PROJECT_ID)",
  ),
  Flag.optional,
);

export const threadFlag = Flag.string("thread").pipe(
  Flag.withDescription("Thread id (or T3CODE_THREAD_ID)"),
  Flag.optional,
);

export const worktreeFlag = Flag.string("worktree").pipe(
  Flag.withDescription(
    "Worktree path override (default: inferred from cwd, or T3CODE_WORKTREE_PATH)",
  ),
  Flag.optional,
);

export const projectPathFlag = Flag.string("path").pipe(
  Flag.withDescription("Project path (default: .)"),
  Flag.withDefault("."),
);

export const yesFlag = Flag.boolean("yes").pipe(
  Flag.withDescription("Skip interactive confirmation"),
  Flag.withDefault(false),
);

export const replaceFlag = Flag.boolean("replace").pipe(
  Flag.withDescription("Replace an existing environment with the same name"),
  Flag.withDefault(false),
);

export const envNameFlag = Flag.string("name").pipe(
  Flag.withDescription("Environment name"),
  Flag.optional,
);

export const forceFlag = Flag.boolean("force").pipe(
  Flag.withDescription("Delete non-empty project (cascade thread deletes)"),
  Flag.withDefault(false),
);

export const selfActionForceFlag = Flag.boolean("force").pipe(
  Flag.withDescription("Confirm an action targeting the calling agent thread"),
  Flag.withAlias("f"),
);

export const formatFlag = Flag.choice("format", humanJsonFormatChoices).pipe(
  Flag.withDefault("auto"),
);

export const threadFormatFlag = Flag.choice("format", humanJsonNdjsonFormatChoices).pipe(
  Flag.withDefault("auto"),
);

export const waitFormatFlag = Flag.choice("format", humanNdjsonFormatChoices).pipe(
  Flag.withDefault("auto"),
);

export const modelFlags = {
  option: Flag.keyValuePair("option").pipe(Flag.optional),
  reasoningEffort: Flag.string("reasoning-effort").pipe(Flag.optional),
  effort: Flag.string("effort").pipe(Flag.optional),
  fastMode: Flag.boolean("fast-mode").pipe(Flag.optional),
  thinking: Flag.boolean("thinking").pipe(Flag.optional),
} as const;
