import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { fromPartial } from "@total-typescript/shoehorn";

type Shell = OrchestrationV2ThreadShell;

/** An idle thread whose run `run-1` completed at `completedAtMs`. */
export function makeShell(
  overrides: Partial<Shell> & { readonly completedAtMs?: number } = {},
): Shell {
  const { completedAtMs = 0, ...rest } = overrides;
  const completedAt = DateTime.makeUnsafe(completedAtMs);
  return fromPartial<Shell>({
    id: "thread-a",
    projectId: "project-1",
    title: "Thread A",
    status: "completed",
    latestRunId: "run-1",
    latestRunRequestedAt: completedAt,
    latestRunStartedAt: completedAt,
    latestRunCompletedAt: completedAt,
    activeRunId: null,
    activityRunStatus: null,
    blockedOnThreadWait: false,
    pendingRuntimeRequest: null,
    pendingGuestMessageCount: 0,
    pendingBackgroundTasks: [],
    latestUserMessageAt: null,
    lastError: null,
    pullRequests: [],
    settledOverride: null,
    settledAt: null,
    archivedAt: null,
    deletedAt: null,
    createdAt: completedAt,
    updatedAt: completedAt,
    ...rest,
  });
}

export const monitorTask = {
  kind: "monitor" as const,
  taskId: "task-1",
  description: "Watching CI",
};

export function makePullRequest(input: {
  readonly number: number;
  readonly isDraft: boolean;
  readonly checksState: "passing" | "failing" | "pending" | null;
  readonly state?: "open" | "closed" | "merged";
  readonly headSha?: string;
  readonly failedChecks?: ReadonlyArray<string>;
}): NonNullable<Shell["pullRequests"]>[number] {
  return fromPartial({
    ...(input.headSha === undefined
      ? {}
      : { watch: { headSha: input.headSha, failedChecks: input.failedChecks ?? [] } }),
    host: "github.com",
    repository: "acme/repo",
    number: input.number,
    url: `https://github.com/acme/repo/pull/${input.number}`,
    source: "agent",
    snapshot: {
      state: input.state ?? "open",
      headBranch: "feature",
      isDraft: input.isDraft,
      checksState: input.checksState,
      mergeability: "mergeable",
    },
  });
}
