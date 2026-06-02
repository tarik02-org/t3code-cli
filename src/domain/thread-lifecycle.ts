import * as Schema from "effect/Schema";

import {
  type ThreadDetail,
  type ThreadEvent,
  type ThreadMessage,
  type ThreadShell,
  ThreadMessageSchema,
  ThreadMessageSentEventSchema,
  ThreadSessionSetEventSchema,
} from "./schema.ts";

const isThreadMessageSentEvent = Schema.is(ThreadMessageSentEventSchema);
const isThreadSessionSetEvent = Schema.is(ThreadSessionSetEventSchema);

export function isThreadActive(thread: ThreadShell | ThreadDetail) {
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.latestTurn?.state === "running" ||
    isPendingStart(thread)
  );
}

export function threadStatus(thread: ThreadShell | ThreadDetail) {
  if (isPendingStart(thread)) {
    return "pending";
  }
  return thread.session?.status ?? thread.latestTurn?.state ?? "unknown";
}

export function latestAssistantMessage(thread: ThreadDetail) {
  return thread.messages.toReversed().find((message) => message.role === "assistant");
}

export function isThreadCompleteEnough(thread: ThreadDetail) {
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
  current: ThreadDetail,
  event: ThreadEvent,
  messages: Map<string, ThreadMessage>,
) {
  const message = messageFromEvent(event, messages);
  if (message !== null) {
    messages.set(messageKey(message), message);
    return { ...current, messages: [...messages.values()] };
  }
  if (isThreadSessionSetEvent(event)) {
    return {
      ...current,
      session: event.payload.session,
    };
  }
  return current;
}

export function messageFromEvent(
  event: ThreadEvent,
  existingMessages: Map<string, ThreadMessage> = new Map(),
): ThreadMessage | null {
  if (!isThreadMessageSentEvent(event)) {
    return null;
  }
  const payload = event.payload;
  const id = payload.messageId;
  const previous = existingMessages.get(id);
  const text = payload.text;
  return Schema.decodeUnknownSync(ThreadMessageSchema)({
    id,
    role: payload.role,
    text: text.length > 0 || previous === undefined ? text : previous.text,
    turnId: payload.turnId,
    ...(payload.streaming !== undefined ? { streaming: payload.streaming } : {}),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
  });
}

export function messageKey(message: ThreadMessage) {
  return message.id ?? message.messageId ?? `${message.role}:${message.createdAt}`;
}

function isPendingStart(thread: ThreadShell | ThreadDetail) {
  if (thread.session !== null || thread.latestTurn !== null || !("messages" in thread)) {
    return false;
  }
  return thread.messages.at(-1)?.role === "user";
}
