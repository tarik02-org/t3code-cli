import {
  ApprovalRequestId,
  type OrchestrationThreadActivity,
  type UserInputQuestion,
} from "#t3tools/contracts";

export type PendingApproval = {
  readonly requestId: ApprovalRequestId;
  readonly requestKind: "command" | "file-read" | "file-change";
  readonly createdAt: string;
  readonly detail?: string;
};

export type PendingUserInput = {
  readonly requestId: ApprovalRequestId;
  readonly createdAt: string;
  readonly questions: ReadonlyArray<UserInputQuestion>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function activityPayload(activity: OrchestrationThreadActivity): Record<string, unknown> | null {
  const payload = activity.payload;
  if (!isRecord(payload)) {
    return null;
  }
  return payload;
}

function compareActivitiesByOrder(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (left.sequence !== undefined && right.sequence !== undefined) {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }
  } else if (left.sequence !== undefined) {
    return 1;
  } else if (right.sequence !== undefined) {
    return -1;
  }
  const byCreated = left.createdAt.localeCompare(right.createdAt);
  if (byCreated !== 0) {
    return byCreated;
  }
  return left.id.localeCompare(right.id);
}

function requestKindFromRequestType(requestType: unknown): PendingApproval["requestKind"] | null {
  switch (requestType) {
    case "command_execution_approval":
    case "exec_command_approval":
    case "dynamic_tool_call":
      return "command";
    case "file_read_approval":
      return "file-read";
    case "file_change_approval":
    case "apply_patch_approval":
      return "file-change";
    default:
      return null;
  }
}

function isStalePendingRequestFailureDetail(detail: string | undefined): boolean {
  const normalized = detail?.toLowerCase();
  if (normalized === undefined || normalized.length === 0) {
    return false;
  }
  return (
    normalized.includes("stale pending approval request") ||
    normalized.includes("stale pending user-input request") ||
    normalized.includes("unknown pending approval request") ||
    normalized.includes("unknown pending permission request") ||
    normalized.includes("unknown pending user-input request")
  );
}

function requestKindFromPayload(
  payload: Record<string, unknown>,
): PendingApproval["requestKind"] | null {
  if (
    payload.requestKind === "command" ||
    payload.requestKind === "file-read" ||
    payload.requestKind === "file-change"
  ) {
    return payload.requestKind;
  }
  return requestKindFromRequestType(payload.requestType);
}

export function derivePendingApprovals(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<PendingApproval> {
  const openByRequestId = new Map<ApprovalRequestId, PendingApproval>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload = activityPayload(activity);
    const requestId =
      payload !== null && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const requestKind = payload !== null ? requestKindFromPayload(payload) : null;
    const detail =
      payload !== null && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "approval.requested" && requestId !== null && requestKind !== null) {
      openByRequestId.set(requestId, {
        requestId,
        requestKind,
        createdAt: activity.createdAt,
        ...(detail !== undefined ? { detail } : {}),
      });
      continue;
    }
    if (activity.kind === "approval.resolved" && requestId !== null) {
      openByRequestId.delete(requestId);
      continue;
    }
    if (
      activity.kind === "provider.approval.respond.failed" &&
      requestId !== null &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function parseUserInputQuestions(
  payload: Record<string, unknown> | null,
): ReadonlyArray<UserInputQuestion> | null {
  const questions = payload?.questions;
  if (!Array.isArray(questions)) {
    return null;
  }
  const parsed = questions
    .map((entry): UserInputQuestion | null => {
      if (!isRecord(entry)) {
        return null;
      }
      const question = entry;
      if (
        typeof question.id !== "string" ||
        typeof question.header !== "string" ||
        typeof question.question !== "string" ||
        !Array.isArray(question.options)
      ) {
        return null;
      }
      const options = question.options
        .map((option): UserInputQuestion["options"][number] | null => {
          if (!isRecord(option)) {
            return null;
          }
          const record = option;
          if (typeof record.label !== "string" || typeof record.description !== "string") {
            return null;
          }
          return { label: record.label, description: record.description };
        })
        .filter((option): option is UserInputQuestion["options"][number] => option !== null);
      if (options.length === 0) {
        return null;
      }
      return {
        id: question.id,
        header: question.header,
        question: question.question,
        options,
        multiSelect: question.multiSelect === true,
      };
    })
    .filter((question): question is UserInputQuestion => question !== null);
  return parsed.length > 0 ? parsed : null;
}

export function derivePendingUserInputs(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<PendingUserInput> {
  const openByRequestId = new Map<ApprovalRequestId, PendingUserInput>();
  const ordered = [...activities].toSorted(compareActivitiesByOrder);

  for (const activity of ordered) {
    const payload = activityPayload(activity);
    const requestId =
      payload !== null && typeof payload.requestId === "string"
        ? ApprovalRequestId.make(payload.requestId)
        : null;
    const detail =
      payload !== null && typeof payload.detail === "string" ? payload.detail : undefined;

    if (activity.kind === "user-input.requested" && requestId !== null) {
      const questions = parseUserInputQuestions(payload);
      if (questions === null) {
        continue;
      }
      openByRequestId.set(requestId, { requestId, createdAt: activity.createdAt, questions });
      continue;
    }
    if (activity.kind === "user-input.resolved" && requestId !== null) {
      openByRequestId.delete(requestId);
      continue;
    }
    if (
      activity.kind === "provider.user-input.respond.failed" &&
      requestId !== null &&
      isStalePendingRequestFailureDetail(detail)
    ) {
      openByRequestId.delete(requestId);
    }
  }

  return [...openByRequestId.values()].toSorted((a, b) => a.createdAt.localeCompare(b.createdAt));
}
