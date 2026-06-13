import {
  OrchestrationMessage,
  type OrchestrationEvent,
  type OrchestrationMessage as OrchestrationMessageType,
  type OrchestrationThread,
  type OrchestrationThreadShell,
} from "#t3tools/contracts";
import * as Schema from "effect/Schema";

export function isThreadActive(thread: OrchestrationThreadShell | OrchestrationThread) {
  if (thread.session?.status === "starting" || thread.session?.status === "running") {
    return true;
  }
  if (thread.latestTurn?.state === "running") {
    return !("messages" in thread && hasTerminalSession(thread) && isThreadCompleteEnough(thread));
  }
  return isPendingStart(thread);
}

export type ThreadLifecycleStatus = ReturnType<typeof threadStatus>;

export function threadStatus(thread: OrchestrationThreadShell | OrchestrationThread) {
  if (isPendingStart(thread)) {
    return "pending";
  }
  return thread.session?.status ?? thread.latestTurn?.state ?? "unknown";
}

export function latestAssistantMessage(thread: OrchestrationThread) {
  return thread.messages.toReversed().find((message) => message.role === "assistant");
}

export function isThreadCompleteEnough(thread: OrchestrationThread) {
  if (thread.session?.status === "error" || thread.session?.status === "interrupted") {
    return true;
  }
  const lastUserIndex = thread.messages.findLastIndex((message) => message.role === "user");
  if (lastUserIndex === -1) {
    return true;
  }
  return thread.messages.slice(lastUserIndex + 1).some((message) => message.role === "assistant");
}

export function applyThreadEvent(
  current: OrchestrationThread,
  event: OrchestrationEvent,
  messages: Map<string, OrchestrationMessageType>,
) {
  const message = messageFromEvent(event, messages);
  if (message !== null) {
    messages.set(messageKey(message), message);
    return { ...current, messages: [...messages.values()] };
  }
  if (event.type === "thread.session-set") {
    return {
      ...current,
      session: event.payload.session,
    };
  }
  return current;
}

export function messageFromEvent(
  event: OrchestrationEvent,
  existingMessages: Map<string, OrchestrationMessageType> = new Map(),
): OrchestrationMessageType | null {
  if (event.type !== "thread.message-sent") {
    return null;
  }
  const payload = event.payload;
  const id = payload.messageId;
  const previous = existingMessages.get(id);
  const text = payload.text;
  return Schema.decodeUnknownSync(OrchestrationMessage)({
    id,
    role: payload.role,
    text: text.length > 0 || previous === undefined ? text : previous.text,
    turnId: payload.turnId,
    streaming: payload.streaming,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  });
}

export function messageKey(message: OrchestrationMessageType) {
  return message.id;
}

function isPendingStart(thread: OrchestrationThreadShell | OrchestrationThread) {
  if (thread.session !== null || thread.latestTurn !== null || !("messages" in thread)) {
    return false;
  }
  return thread.messages.at(-1)?.role === "user";
}

function hasTerminalSession(thread: OrchestrationThreadShell | OrchestrationThread) {
  return (
    thread.session !== null &&
    thread.session?.status !== "starting" &&
    thread.session?.status !== "running"
  );
}
