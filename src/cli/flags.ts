import { Flag } from "effect/unstable/cli";

import {
  humanJsonFormatChoices,
  humanJsonNdjsonFormatChoices,
  humanNdjsonFormatChoices,
} from "./format/output.ts";

export const projectFlag = Flag.String("project").pipe(
  Flag.withDescription(
    "Project id or path (default: cwd with local auth, or T3CODE_PROJECT_ROOT / T3CODE_PROJECT_ID)",
  ),
  Flag.optional,
);

export const threadFlag = Flag.String("thread").pipe(
  Flag.withDescription("Thread id (or T3CODE_THREAD_ID)"),
  Flag.optional,
);

export const worktreeFlag = Flag.String("worktree").pipe(
  Flag.withDescription(
    "Worktree path override (default: inferred from cwd, or T3CODE_WORKTREE_PATH)",
  ),
  Flag.optional,
);

export const projectPathFlag = Flag.String("path").pipe(
  Flag.withDescription("Project path (default: .)"),
  Flag.withDefault("."),
);

export const yesFlag = Flag.Boolean("yes").pipe(
  Flag.withDescription("Skip interactive confirmation"),
  Flag.withDefault(false),
);

export const replaceFlag = Flag.Boolean("replace").pipe(
  Flag.withDescription("Replace an existing environment with the same name"),
  Flag.withDefault(false),
);

export const envNameFlag = Flag.String("name").pipe(
  Flag.withDescription("Environment name"),
  Flag.optional,
);

export const forceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription("Delete non-empty project (cascade thread deletes)"),
  Flag.withDefault(false),
);

export const asUserFlag = Flag.Boolean("as-user").pipe(
  Flag.withDescription(
    "Attribute the message to the user instead of an agent (default: agent, linked to T3CODE_THREAD_ID when it exists in the target environment)",
  ),
  Flag.withDefault(false),
);

export const selfActionForceFlag = Flag.Boolean("force").pipe(
  Flag.withDescription("Confirm an action targeting the calling agent thread"),
  Flag.withAlias("f"),
  Flag.withDefault(false),
);

export const formatFlag = Flag.Literals("format", humanJsonFormatChoices).pipe(
  Flag.withDefault("auto"),
);

export const threadFormatFlag = Flag.Literals("format", humanJsonNdjsonFormatChoices).pipe(
  Flag.withDefault("auto"),
);

export const waitFormatFlag = Flag.Literals("format", humanNdjsonFormatChoices).pipe(
  Flag.withDefault("auto"),
);

export const modelFlags = {
  option: Flag.KeyValuePair("option").pipe(Flag.optional),
  reasoningEffort: Flag.String("reasoning-effort").pipe(Flag.optional),
  effort: Flag.String("effort").pipe(Flag.optional),
  fastMode: Flag.Boolean("fast-mode").pipe(Flag.optional),
  thinking: Flag.Boolean("thinking").pipe(Flag.optional),
} as const;
