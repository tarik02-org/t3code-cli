import {
  environmentEventKinds,
  type CompanionEventKind,
  type DeliveryPriority,
  type Subscription,
  type ThreadEvent,
} from "./schema.ts";

const hasSource = (
  subscription: Subscription,
  environment: string,
  threadId: string | null,
  projectId: string | null,
) =>
  // A follow subscription only creates thread subscriptions; it takes no events itself.
  !subscription.follow &&
  subscription.source.environment === environment &&
  (subscription.source.threadId === null
    ? subscription.source.projectId === projectId
    : subscription.source.threadId === threadId);

const takesThreadEvent = (subscription: Subscription, event: ThreadEvent) =>
  hasSource(subscription, event.environment, event.threadId, event.projectId) &&
  subscription.events.includes(event.kind) &&
  // A thread never wakes itself.
  !(
    subscription.subscriber.environment === event.environment &&
    subscription.subscriber.threadId === event.threadId
  );

/** Whether a subscription gets an event; environment events reach every subscription there. */
export const subscriptionTakes = (subscription: Subscription, event: ThreadEvent) =>
  subscription.source.environment === event.environment &&
  (event.threadId === null
    ? environmentEventKinds.includes(event.kind)
    : takesThreadEvent(subscription, event));

const defaultPriorities: Record<CompanionEventKind, DeliveryPriority> = {
  failed: "urgent",
  "needs-input": "urgent",
  "needs-approval": "urgent",
  idle: "normal",
  "pr-checks": "normal",
  "env-down": "normal",
  settled: "low",
  "env-up": "low",
};

/**
 * The priority one subscription delivers an event at. A pause is always low: the thread is only
 * waiting on its own background work, which wakes it again.
 */
export function deliveryPriority(subscription: Subscription, event: ThreadEvent): DeliveryPriority {
  if (event.pause) {
    return "low";
  }
  return subscription.priorities[event.kind] ?? defaultPriorities[event.kind];
}

/**
 * Whether an item may start a digest. Failures and questions block work, so they always wake.
 * Environment drops wake no one, since they concern every subscription there, and neither does a
 * pause: the thread is still waiting on its own work, and the wake belongs to the idle that
 * follows. Anything else wakes only an armed subscription.
 */
export const itemWakes = (
  subscription: Subscription,
  event: ThreadEvent,
  priority: DeliveryPriority,
) =>
  subscription.wake &&
  (priority === "urgent" ||
    (subscription.armed && !event.pause && !environmentEventKinds.includes(event.kind)));

export interface Relevance {
  /** Some subscription wants this thread's events. */
  readonly source: boolean;
  /** The thread subscribes to something, so its turn ends release held digests. */
  readonly subscriber: boolean;
}

export const relevance = (
  subscriptions: ReadonlyArray<Subscription>,
  environment: string,
  threadId: string,
  projectId: string,
): Relevance => ({
  source: subscriptions.some((subscription) =>
    hasSource(subscription, environment, threadId, projectId),
  ),
  subscriber: subscriptions.some(
    (subscription) =>
      subscription.subscriber.environment === environment &&
      subscription.subscriber.threadId === threadId,
  ),
});
