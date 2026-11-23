import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Semaphore from "effect/Semaphore";

import { decideDelivery, digestTag, formatDigest } from "./digest.ts";
import { CompanionEnvironments } from "./environments.ts";
import { CompanionInvalidRequestError, type CompanionStoreError } from "./error.ts";
import {
  defaultStuckMinutes,
  derivePullRequestEvents,
  describePullRequest,
  deriveThreadEvents,
  isStale,
  lastMessageLength,
  seenThreadMemory,
  type ThreadFacts,
  threadPayload,
  type World,
} from "./events.ts";
import { CompanionPullRequests, parsePullRequest } from "./github.ts";
import { sentTargets } from "./scan.ts";
import {
  type CallerWatching,
  type CompanionEvent,
  type EventsRequest,
  type LinkedPullRequest,
  pullRequestSubject,
  type PullRequestView,
  type Reminder,
  type RemindRequest,
  reminderSubject,
  type ThreadRef,
  type ThreadRefInput,
  threadRefKey,
  threadSubject,
  type UnwatchRequest,
  type WatchingRequest,
  type WatchOrigin,
  type WatchRequest,
  type WatchResult,
  type WatchView,
} from "./schema.ts";
import {
  awaitedChildThreadIds,
  awaitedTasks,
  describeThread,
  inTurn,
  threadPhase,
} from "./state.ts";
import { CompanionStore, type StoredDigest, type StoredWatch } from "./store.ts";

/** How often every watch is judged against the clock and every pending digest reconsidered. */
export const tickInterval = Duration.seconds(2);
/** A caller's transcript is read for new sends at most this often while its turn runs. */
export const scanInterval = Duration.seconds(10);
/** How often the pull requests due for a read are read. */
export const pullRequestInterval = Duration.seconds(5);
/** A pull request with a pending check, or one that changed lately, is read this often. */
export const hotPullRequestMs = 30_000;
export const quietPullRequestMs = 120_000;
const recentChangeMs = 10 * 60_000;
/** Below this many GraphQL points left, every pull request is read four times less often. */
const lowRateLimit = 500;
const pullRequestConcurrency = 4;
/**
 * Environments with a caller or a watched thread have their whole snapshot re-read every this
 * many ticks, so a row the stream dropped cannot leave an event unseen.
 */
export const snapshotTicks = 60;
const pruneTicks = 1800;
/** How long settled events stay readable. */
export const retention = Duration.days(7);
/** How long a thread a caller wrote to may stay unknown before the send is given up on. */
const unresolvedMs = 2 * 60_000;
const retryMs = 10_000;
const longestRetryMs = 5 * 60_000;
/** A digest that did not arrive this many times is given up; its events go into the next one. */
const abandonAfter = 5;

type RequestError = CompanionInvalidRequestError | CompanionStoreError;

export interface WatchlistOptions {
  /** How long awaited work may show no progress before its thread is `stuck`. */
  readonly stuckMinutes?: number | undefined;
}

export class CompanionWatchlist extends Context.Service<
  CompanionWatchlist,
  {
    /** Makes the caller known and, when it names one, watches a thread or a pull request. */
    readonly watch: (input: WatchRequest) => Effect.Effect<WatchResult, RequestError>;
    /** The number of watches and reminders ended. */
    readonly unwatch: (input: UnwatchRequest) => Effect.Effect<number, RequestError>;
    readonly watching: (
      input: WatchingRequest,
    ) => Effect.Effect<ReadonlyArray<CallerWatching>, RequestError>;
    readonly remind: (input: RemindRequest) => Effect.Effect<Reminder, RequestError>;
    /** Hands the caller its pending events, or one event by id. */
    readonly events: (
      input: EventsRequest,
    ) => Effect.Effect<ReadonlyArray<CompanionEvent>, RequestError>;
    /** Takes a thread's latest shell row from the watcher. */
    readonly ingest: (
      environment: string,
      shell: OrchestrationV2ThreadShell,
    ) => Effect.Effect<void, CompanionStoreError>;
    /** Ends what concerns a thread that no longer exists. */
    readonly forget: (
      environment: string,
      threadId: string,
    ) => Effect.Effect<void, CompanionStoreError>;
    /** Judges watches on a clock, reads pull requests and sends digests; runs forever. */
    readonly run: Effect.Effect<never>;
  }
>()("t3cli/companion/CompanionWatchlist") {}

const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

const watchKey = (caller: ThreadRef, subject: string) => `${threadRefKey(caller)}|${subject}`;

/** Runs `body` again and again, `interval` apart; a failed round is logged and the next one runs. */
const every = (
  interval: Duration.Duration,
  name: string,
  body: (round: number) => Effect.Effect<void, unknown>,
) =>
  Effect.gen(function* () {
    let round = 0;
    while (true) {
      yield* body(round).pipe(
        Effect.catchCause((cause) => Effect.logWarning(`${name} failed`, cause)),
      );
      round += 1;
      yield* Effect.sleep(interval);
    }
  });

interface ThreadState extends ThreadFacts {
  /** The ids of the tasks the thread awaits; a change in them is progress. */
  readonly tasksKey: string;
}

interface CallerState {
  readonly ref: ThreadRef;
  readonly enrolledAtMs: number;
  cursor: number;
  /** The caller's item count when its transcript was last read; null before the first read. */
  scannedItems: number | null;
  lastScanMs: number;
  /** Threads the caller wrote to that no environment has shown yet, by when first missed. */
  readonly unresolved: Map<string, number>;
  /** Consecutive sends that did not arrive, and when the next may be tried. */
  failures: number;
  retryAtMs: number;
}

interface PullRequestState {
  view: PullRequestView | undefined;
  nextReadMs: number;
  changedMs: number;
  signature: string;
  failures: number;
}

const signatureOf = (view: PullRequestView) =>
  JSON.stringify([
    view.state,
    view.draft,
    view.head,
    view.failing.map((check) => check.name),
    view.pending,
    view.mergeable,
    view.remarks.length,
  ]);

export const makeCompanionWatchlist = Effect.fn("makeCompanionWatchlist")(function* (
  options: WatchlistOptions = {},
) {
  const store = yield* CompanionStore;
  const environments = yield* CompanionEnvironments;
  const github = yield* CompanionPullRequests;
  const stuckMinutes = options.stuckMinutes ?? defaultStuckMinutes;

  // Everything below is read and written only while `lock` is held, except by the code that
  // sends a digest, which touches a caller's retry fields alone.
  const lock = yield* Semaphore.make(1);
  const locked = Semaphore.withPermits(lock, 1);
  const threads = new Map<string, ThreadState>();
  const pulls = new Map<string, PullRequestState>();
  const callers = new Map<string, CallerState>();
  /** Running watches, by `watchKey`. */
  const active = new Map<string, StoredWatch>();
  /** Ended watches, by `watchKey`: why a subject is not picked up again by itself. */
  const ended = new Map<string, StoredWatch>();
  /** The running watches of each subject. */
  let bySubject = new Map<string, ReadonlyArray<StoredWatch>>();
  const lastMessages = new Map<
    string,
    { readonly updatedAtMs: number; readonly text: string | null }
  >();
  const environmentIds = new Map<string, string | null>();
  const sending = yield* FiberMap.make<string>();

  const reindex = () => {
    const next = new Map<string, Array<StoredWatch>>();
    for (const watch of active.values()) {
      next.set(watch.subject, [...(next.get(watch.subject) ?? []), watch]);
    }
    bySubject = next;
    for (const pr of pulls.keys()) {
      if (!next.has(pullRequestSubject(pr))) {
        pulls.delete(pr);
      }
    }
    for (const subject of next.keys()) {
      const pr = subject.startsWith("pr:") ? subject.slice("pr:".length) : undefined;
      if (pr !== undefined && !pulls.has(pr)) {
        pulls.set(pr, { view: undefined, nextReadMs: 0, changedMs: 0, signature: "", failures: 0 });
      }
    }
  };

  for (const caller of yield* store.callers()) {
    callers.set(threadRefKey(caller.ref), {
      ref: caller.ref,
      enrolledAtMs: Date.parse(caller.enrolledAt),
      cursor: caller.cursor,
      scannedItems: null,
      lastScanMs: 0,
      unresolved: new Map(),
      failures: 0,
      retryAtMs: 0,
    });
  }
  for (const watch of yield* store.watches()) {
    (watch.endedAt === null ? active : ended).set(watchKey(watch.caller, watch.subject), watch);
  }
  reindex();

  const world: World = {
    thread: (subject) => threads.get(subject.slice("thread:".length)),
    pullRequest: (subject) => pulls.get(subject.slice("pr:".length))?.view,
  };

  const observe = (environment: string, shell: OrchestrationV2ThreadShell, nowMs: number) => {
    const key = threadRefKey({ environment, threadId: shell.id });
    const known = threads.get(key);
    const phase = threadPhase(shell, nowMs);
    const tasksKey = awaitedTasks(shell)
      .map((task) => task.taskId)
      .toSorted()
      .join(",");
    threads.set(key, {
      shell,
      phase,
      phaseSinceMs:
        known !== undefined &&
        known.phase === phase &&
        known.shell.latestRunId === shell.latestRunId
          ? known.phaseSinceMs
          : nowMs,
      progressMs: known === undefined ? 0 : known.tasksKey === tasksKey ? known.progressMs : nowMs,
      tasksKey,
    });
  };

  /** A queued message stops counting as a turn, and a child thread works, with no new row. */
  const refresh = (key: string, nowMs: number) => {
    const state = threads.get(key);
    if (state === undefined) {
      return;
    }
    const phase = threadPhase(state.shell, nowMs);
    const environment = key.slice(0, key.length - state.shell.id.length - 1);
    const childWorks =
      phase === "waiting" &&
      awaitedChildThreadIds(state.shell).some(
        (threadId) => threads.get(threadRefKey({ environment, threadId }))?.phase === "busy",
      );
    if (phase !== state.phase || childWorks) {
      threads.set(key, {
        ...state,
        phase,
        phaseSinceMs: phase === state.phase ? state.phaseSinceMs : nowMs,
        progressMs: childWorks ? nowMs : state.progressMs,
      });
    }
  };

  const environmentId = Effect.fn("CompanionWatchlist.environmentId")(function* (name: string) {
    const known = environmentIds.get(name);
    if (known !== undefined) {
      return known;
    }
    const id = yield* environments.resolve(name).pipe(
      Effect.flatMap((environment) => environment.orchestration.getServerConfig()),
      Effect.map((config): string | null => config.environment.environmentId),
      Effect.catchCause((cause) =>
        Effect.logWarning(`could not read the id of environment ${name}`, cause).pipe(
          Effect.as(null),
        ),
      ),
    );
    if (id !== null) {
      environmentIds.set(name, id);
    }
    return id;
  });

  /** A link T3 Code shows as a thread chip; null when the environment did not give its id. */
  const threadLink = (ref: ThreadRef) =>
    environmentId(ref.environment).pipe(
      Effect.map((id) => (id === null ? null : `<t3-thread://v2/${id}/${ref.threadId}>`)),
    );

  /** Reads a thread's last assistant message, which its shell row does not carry. */
  const lastMessage = Effect.fn("CompanionWatchlist.lastMessage")(function* (ref: ThreadRef) {
    const key = threadRefKey(ref);
    const state = threads.get(key);
    const updatedAtMs = state === undefined ? 0 : DateTime.toEpochMillis(state.shell.updatedAt);
    const cached = lastMessages.get(key);
    if (cached !== undefined && cached.updatedAtMs === updatedAtMs) {
      return cached.text;
    }
    const text = yield* environments.resolve(ref.environment).pipe(
      Effect.flatMap((environment) =>
        environment.orchestration.getThreadBoundedSnapshot(ref.threadId),
      ),
      Effect.map((snapshot) => {
        const item = snapshot.projection.turnItems.findLast(
          (candidate) => candidate.type === "assistant_message",
        );
        return item !== undefined && "text" in item ? item.text.slice(0, lastMessageLength) : null;
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning(`could not read the last message of ${key}`, cause).pipe(Effect.as(null)),
      ),
    );
    lastMessages.set(key, { updatedAtMs, text });
    return text;
  });

  const linkedPullRequests = (shell: OrchestrationV2ThreadShell): Array<LinkedPullRequest> =>
    (shell.pullRequests ?? []).flatMap((link) => {
      const parsed = link.source === "stack-dismissed" ? null : parsePullRequest(link.url);
      if (parsed === null) {
        return [];
      }
      const pr = `${parsed.owner}/${parsed.name}#${parsed.number}`;
      const view = pulls.get(pr)?.view;
      return [
        {
          pr,
          url: link.url,
          state: view?.state ?? link.snapshot?.state ?? null,
          head: view?.head ?? null,
        },
      ];
    });

  const startWatch = Effect.fn("CompanionWatchlist.startWatch")(function* (
    input: Parameters<CompanionStore["Service"]["startWatch"]>[0],
  ) {
    const watch = yield* store.startWatch(input);
    const key = watchKey(watch.caller, watch.subject);
    active.set(key, watch);
    ended.delete(key);
    reindex();
    yield* Effect.logInfo(
      `${threadRefKey(watch.caller)} watches ${watch.subject} (${watch.origin}) since ${watch.since}`,
    );
    return watch;
  });

  const endWatch = Effect.fn("CompanionWatchlist.endWatch")(function* (
    watch: StoredWatch,
    reason: string,
    nowMs: number,
  ) {
    const key = watchKey(watch.caller, watch.subject);
    yield* store.endWatch(watch.id, reason, iso(nowMs));
    active.delete(key);
    ended.set(key, { ...watch, endedAt: iso(nowMs), endedReason: reason });
    reindex();
    yield* Effect.logInfo(
      `${threadRefKey(watch.caller)} no longer watches ${watch.subject}: ${reason}`,
    );
  });

  const remember = (watch: StoredWatch) => {
    active.set(watchKey(watch.caller, watch.subject), watch);
    reindex();
  };

  const removeCaller = Effect.fn("CompanionWatchlist.removeCaller")(function* (ref: ThreadRef) {
    const key = threadRefKey(ref);
    yield* store.removeCaller(ref);
    callers.delete(key);
    for (const map of [active, ended]) {
      for (const [watchId, watch] of map) {
        if (threadRefKey(watch.caller) === key) {
          map.delete(watchId);
        }
      }
    }
    reindex();
    yield* Effect.logInfo(`${key} is no longer a caller`);
  });

  /**
   * Watches the pull requests a thread links, for each caller given. A pull request the caller
   * stopped watching, or that merged or closed, is not picked up again from its link.
   */
  const syncLinks = Effect.fn("CompanionWatchlist.syncLinks")(function* (
    watchers: ReadonlyArray<ThreadRef>,
    shell: OrchestrationV2ThreadShell,
    nowMs: number,
  ) {
    for (const link of shell.pullRequests ?? []) {
      const parsed = link.source === "stack-dismissed" ? null : parsePullRequest(link.url);
      if (parsed === null || (link.snapshot !== null && link.snapshot.state !== "open")) {
        continue;
      }
      const subject = pullRequestSubject(`${parsed.owner}/${parsed.name}#${parsed.number}`);
      for (const caller of watchers) {
        const key = watchKey(caller, subject);
        const enrolledAtMs = callers.get(threadRefKey(caller))?.enrolledAtMs;
        if (enrolledAtMs === undefined || active.has(key) || ended.has(key)) {
          continue;
        }
        yield* startWatch({
          caller,
          subject,
          origin: "linked",
          since: iso(nowMs),
          green: false,
          // A link older than the caller is one it already knows the state of.
          memory: Date.parse(link.linkedAt) < enrolledAtMs ? { baseline: true } : {},
        });
      }
    }
  });

  /** Emits what a thread's watches owe, and ends them when the thread is gone. */
  const evaluateThread = Effect.fn("CompanionWatchlist.evaluateThread")(function* (
    ref: ThreadRef,
    nowMs: number,
  ) {
    const key = threadRefKey(ref);
    const subject = threadSubject(ref);
    for (const watch of bySubject.get(subject) ?? []) {
      const facts = threads.get(key);
      if (facts === undefined) {
        return;
      }
      if (facts.phase === "gone") {
        yield* store.dropSubject(watch.caller, subject, iso(nowMs));
        yield* endWatch(watch, "gone", nowMs);
        continue;
      }
      const [candidate] = deriveThreadEvents(
        facts,
        { sinceMs: Date.parse(watch.since), memory: watch.memory },
        nowMs,
        stuckMinutes,
      );
      if (candidate === undefined) {
        continue;
      }
      const text =
        candidate.kind === "done" || candidate.kind === "failed" ? yield* lastMessage(ref) : null;
      const link = yield* threadLink(ref);
      const { payload, urgent } = threadPayload(candidate, facts, {
        link,
        lastMessage: text,
        pullRequests: linkedPullRequests(facts.shell),
        stuckMinutes,
      });
      const memory = { ...watch.memory, [candidate.kind]: candidate.key };
      yield* store.emit({ id: watch.id, memory }, [
        {
          caller: watch.caller,
          subject,
          kind: candidate.kind,
          key: candidate.key,
          urgent,
          at: iso(nowMs),
          payload,
        },
      ]);
      remember({ ...watch, memory });
      yield* Effect.logInfo(
        `${candidate.kind} for ${threadRefKey(watch.caller)}: ${subject} ${payload.summary}`,
      );
    }
  });

  /** Takes a row in: the thread's state, the links it shows, and what its watches now owe. */
  const absorb = Effect.fn("CompanionWatchlist.absorb")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
    nowMs: number,
  ) {
    const ref = { environment, threadId: shell.id };
    const key = threadRefKey(ref);
    observe(environment, shell, nowMs);
    const gone = threads.get(key)?.phase === "gone";
    if (callers.has(key)) {
      if (gone) {
        yield* removeCaller(ref);
      } else {
        yield* syncLinks([ref], shell, nowMs);
      }
    }
    const watchers = bySubject.get(threadSubject(ref)) ?? [];
    if (watchers.length > 0) {
      if (!gone) {
        yield* syncLinks(
          watchers.map((watch) => watch.caller),
          shell,
          nowMs,
        );
      }
      yield* evaluateThread(ref, nowMs);
    }
  });

  /** Applies a read of a pull request to its watches. */
  const applyPullRequest = Effect.fn("CompanionWatchlist.applyPullRequest")(function* (
    pr: string,
    view: PullRequestView,
    nowMs: number,
  ) {
    const state = pulls.get(pr);
    if (state === undefined) {
      return;
    }
    const signature = signatureOf(view);
    if (signature !== state.signature) {
      state.signature = signature;
      state.changedMs = nowMs;
    }
    state.view = view;
    state.failures = 0;
    const hot = view.pending.length > 0 || nowMs - state.changedMs < recentChangeMs;
    const scarce = view.rateLimitRemaining !== null && view.rateLimitRemaining < lowRateLimit;
    state.nextReadMs = nowMs + (hot ? hotPullRequestMs : quietPullRequestMs) * (scarce ? 4 : 1);
    const subject = pullRequestSubject(pr);
    for (const watch of bySubject.get(subject) ?? []) {
      const derived = derivePullRequestEvents(view, {
        sinceMs: Date.parse(watch.since),
        memory: watch.memory,
        green: watch.green,
      });
      yield* store.emit(
        { id: watch.id, memory: derived.memory },
        derived.events.map((event) => ({
          caller: watch.caller,
          subject,
          kind: event.kind,
          key: event.key,
          urgent: event.urgent,
          at: iso(nowMs),
          payload: event.payload,
        })),
      );
      const updated = { ...watch, memory: derived.memory };
      remember(updated);
      for (const event of derived.events) {
        yield* Effect.logInfo(
          `${event.kind} for ${threadRefKey(watch.caller)}: ${subject} ${event.payload.summary}`,
        );
      }
      if (derived.ended) {
        yield* endWatch(updated, view.state, nowMs);
      }
    }
  });

  const loadSnapshot = Effect.fn("CompanionWatchlist.loadSnapshot")(function* (
    environment: string,
  ) {
    const snapshot = yield* environments
      .resolve(environment)
      .pipe(Effect.flatMap((resolved) => resolved.orchestration.getShellSnapshot()));
    yield* locked(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        for (const shell of snapshot.threads) {
          yield* absorb(environment, shell, nowMs);
        }
      }),
    );
  });

  /** Resolves env aliases to the canonical name everything is keyed on. */
  const normalizeRef = Effect.fn("CompanionWatchlist.normalizeRef")(function* (
    ref: ThreadRefInput,
  ) {
    const environment = yield* environments
      .resolve(ref.environment)
      .pipe(
        Effect.mapError((error) => new CompanionInvalidRequestError({ message: error.message })),
      );
    if (ref.threadId.length === 0) {
      return yield* new CompanionInvalidRequestError({ message: "thread id must not be empty" });
    }
    return { environment: environment.name, threadId: ref.threadId };
  });

  /** A thread by id in the preferred environment, or in the one other that has it. */
  const findThread = (threadId: string, preferred: string): ThreadRef | undefined => {
    if (threads.has(threadRefKey({ environment: preferred, threadId }))) {
      return { environment: preferred, threadId };
    }
    const suffix = `/${threadId}`;
    const found = [...threads.keys()].filter((key) => key.endsWith(suffix));
    const [only] = found;
    return found.length === 1 && only !== undefined
      ? { environment: only.slice(0, only.length - suffix.length), threadId }
      : undefined;
  };

  /** The caller of a tool call, made one if it is not yet. Its thread must exist. */
  const enroll = Effect.fn("CompanionWatchlist.enroll")(function* (input: ThreadRefInput) {
    const ref = yield* normalizeRef(input);
    const key = threadRefKey(ref);
    if (!threads.has(key)) {
      yield* loadSnapshot(ref.environment).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`could not read the threads of ${ref.environment}`, cause),
        ),
      );
    }
    return yield* locked(
      Effect.gen(function* () {
        const known = callers.get(key);
        if (known !== undefined) {
          return known;
        }
        const state = threads.get(key);
        if (state === undefined || state.phase === "gone") {
          return yield* new CompanionInvalidRequestError({
            message: `thread ${ref.threadId} is not known on ${ref.environment}; pass your own T3CODE_THREAD_ID as callerThreadId`,
          });
        }
        const nowMs = yield* Clock.currentTimeMillis;
        yield* store.enroll(ref, iso(nowMs));
        const caller: CallerState = {
          ref,
          enrolledAtMs: nowMs,
          cursor: 0,
          scannedItems: null,
          lastScanMs: 0,
          unresolved: new Map(),
          failures: 0,
          retryAtMs: 0,
        };
        callers.set(key, caller);
        yield* Effect.logInfo(`${key} is a caller`);
        yield* syncLinks([ref], state.shell, nowMs);
        return caller;
      }),
    );
  });

  const threadView = Effect.fn("CompanionWatchlist.threadView")(function* (
    watch: StoredWatch,
    nowMs: number,
  ) {
    const key = watch.subject.slice("thread:".length);
    const state = threads.get(key);
    const environment =
      state === undefined ? "" : key.slice(0, key.length - state.shell.id.length - 1);
    return {
      subject: watch.subject,
      title: state?.shell.title ?? key,
      link:
        state === undefined ? null : yield* threadLink({ environment, threadId: state.shell.id }),
      origin: watch.origin,
      since: watch.since,
      state: state === undefined ? "not seen yet" : describeThread(state.shell, nowMs),
    } satisfies WatchView;
  });

  const pullRequestView = (watch: StoredWatch): WatchView => {
    const pr = watch.subject.slice("pr:".length);
    const view = pulls.get(pr)?.view;
    return {
      subject: watch.subject,
      title: view?.title ?? pr,
      link: view?.url ?? null,
      origin: watch.origin,
      since: watch.since,
      state: `${view === undefined ? "not read yet" : describePullRequest(view)}${watch.green ? "; green is reported" : ""}`,
    };
  };

  const watchesOf = (caller: ThreadRef, prefix: "thread:" | "pr:") =>
    [...active.values()].filter(
      (watch) =>
        threadRefKey(watch.caller) === threadRefKey(caller) && watch.subject.startsWith(prefix),
    );

  const watch = Effect.fn("CompanionWatchlist.watch")(function* (input: WatchRequest) {
    const caller = (yield* enroll(input.caller)).ref;
    if (input.thread !== undefined && input.pr !== undefined) {
      return yield* new CompanionInvalidRequestError({
        message: "name a thread or a pull request, not both; call watch once for each",
      });
    }
    const counts = () => ({
      threads: watchesOf(caller, "thread:").length,
      pullRequests: watchesOf(caller, "pr:").length,
    });
    if (input.thread !== undefined) {
      const named = input.thread;
      const given =
        named.environment === undefined ? undefined : (yield* normalizeRef(named)).environment;
      if (given !== undefined && !threads.has(threadRefKey({ ...named, environment: given }))) {
        yield* loadSnapshot(given).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`could not read the threads of ${given}`, cause),
          ),
        );
      }
      return yield* locked(
        Effect.gen(function* () {
          const ref =
            given === undefined
              ? findThread(named.threadId, caller.environment)
              : { environment: given, threadId: named.threadId };
          const facts = ref === undefined ? undefined : threads.get(threadRefKey(ref));
          if (ref === undefined || facts === undefined || facts.phase === "gone") {
            return yield* new CompanionInvalidRequestError({
              message: `thread ${named.threadId} is not known${given === undefined ? "; name its environment" : ` on ${given}`}`,
            });
          }
          if (threadRefKey(ref) === threadRefKey(caller)) {
            return yield* new CompanionInvalidRequestError({
              message: "a caller does not watch itself",
            });
          }
          const nowMs = yield* Clock.currentTimeMillis;
          const subject = threadSubject(ref);
          const watching =
            active.get(watchKey(caller, subject)) ??
            (yield* startWatch({
              caller,
              subject,
              origin: "explicit",
              since: iso(nowMs),
              green: false,
              memory: seenThreadMemory(facts),
            }));
          yield* syncLinks([caller], facts.shell, nowMs);
          return { watch: yield* threadView(watching, nowMs), ...counts() };
        }),
      );
    }
    if (input.pr !== undefined) {
      const parsed = parsePullRequest(input.pr);
      if (parsed === null) {
        return yield* new CompanionInvalidRequestError({
          message: `"${input.pr}" is not a pull request; write owner/repo#123 or its URL`,
        });
      }
      const pr = `${parsed.owner}/${parsed.name}#${parsed.number}`;
      const view = yield* github
        .read(pr)
        .pipe(
          Effect.mapError((error) => new CompanionInvalidRequestError({ message: error.message })),
        );
      return yield* locked(
        Effect.gen(function* () {
          const nowMs = yield* Clock.currentTimeMillis;
          const subject = pullRequestSubject(pr);
          const green = input.green ?? false;
          const existing = active.get(watchKey(caller, subject));
          if (existing !== undefined && existing.green !== green && input.green !== undefined) {
            yield* store.setGreen(existing.id, green);
            remember({ ...existing, green });
          }
          const seen = derivePullRequestEvents(view, {
            sinceMs: nowMs,
            memory: { baseline: true },
            green,
          });
          if (existing === undefined && seen.ended) {
            return {
              watch: {
                subject,
                title: view.title,
                link: view.url,
                origin: "explicit" as const,
                since: iso(nowMs),
                state: `${view.state}, so there is nothing to watch`,
              },
              ...counts(),
            };
          }
          const watching =
            active.get(watchKey(caller, subject)) ??
            (yield* startWatch({
              caller,
              subject,
              origin: "explicit",
              since: iso(nowMs),
              green,
              memory: seen.memory,
            }));
          yield* applyPullRequest(pr, view, nowMs);
          return {
            watch: pullRequestView(active.get(watchKey(caller, subject)) ?? watching),
            ...counts(),
          };
        }),
      );
    }
    return { watch: null, ...counts() };
  });

  const unwatch = Effect.fn("CompanionWatchlist.unwatch")(function* (input: UnwatchRequest) {
    const caller = yield* normalizeRef(input.caller);
    const named = input.thread;
    const given =
      named === undefined || named.environment === undefined
        ? undefined
        : (yield* normalizeRef(named)).environment;
    return yield* locked(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        if (input.all === true) {
          const count = watchesOf(caller, "thread:").length + watchesOf(caller, "pr:").length;
          if (callers.has(threadRefKey(caller))) {
            yield* removeCaller(caller);
          }
          return count;
        }
        const subjects: Array<string> = [];
        if (named !== undefined) {
          const ref =
            given === undefined
              ? findThread(named.threadId, caller.environment)
              : { environment: given, threadId: named.threadId };
          subjects.push(
            threadSubject(ref ?? { environment: caller.environment, threadId: named.threadId }),
          );
        }
        if (input.pr !== undefined) {
          const parsed = parsePullRequest(input.pr);
          if (parsed === null) {
            return yield* new CompanionInvalidRequestError({
              message: `"${input.pr}" is not a pull request; write owner/repo#123 or its URL`,
            });
          }
          subjects.push(pullRequestSubject(`${parsed.owner}/${parsed.name}#${parsed.number}`));
        }
        let count = 0;
        for (const subject of subjects) {
          const watching = active.get(watchKey(caller, subject));
          if (watching !== undefined) {
            yield* store.dropSubject(caller, subject, iso(nowMs));
            yield* endWatch(watching, "unwatched", nowMs);
            count += 1;
          }
        }
        if (input.reminder !== undefined && (yield* store.cancelReminder(caller, input.reminder))) {
          count += 1;
        }
        return count;
      }),
    );
  });

  const watching = Effect.fn("CompanionWatchlist.watching")(function* (input: WatchingRequest) {
    const only = input.caller === undefined ? null : yield* normalizeRef(input.caller);
    if (input.caller !== undefined) {
      yield* enroll(input.caller);
    }
    return yield* locked(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        const reminders = yield* store.reminders();
        const pending = yield* store.pendingEvents(only);
        const listed = only === null ? [...callers.values()].map((caller) => caller.ref) : [only];
        return yield* Effect.forEach(listed, (caller) =>
          Effect.gen(function* () {
            const mine = (ref: ThreadRef) => threadRefKey(ref) === threadRefKey(caller);
            return {
              caller,
              threads: yield* Effect.forEach(watchesOf(caller, "thread:"), (watched) =>
                threadView(watched, nowMs),
              ),
              pullRequests: watchesOf(caller, "pr:").map(pullRequestView),
              reminders: reminders
                .filter((reminder) => mine(reminder.caller))
                .map(({ id, dueAt, text }) => ({ id, dueAt, text })),
              pending: pending.filter((event) => mine(event.caller)),
            } satisfies CallerWatching;
          }),
        );
      }),
    );
  });

  const remind = Effect.fn("CompanionWatchlist.remind")(function* (input: RemindRequest) {
    const caller = (yield* enroll(input.caller)).ref;
    const nowMs = yield* Clock.currentTimeMillis;
    const dueMs =
      input.at !== undefined
        ? Date.parse(input.at)
        : input.in !== undefined
          ? nowMs + input.in * 1000
          : Number.NaN;
    if (Number.isNaN(dueMs) || (input.in !== undefined && !(input.in >= 0))) {
      return yield* new CompanionInvalidRequestError({
        message: "say when: `in` as seconds from now (0 or more), or `at` as an ISO 8601 time",
      });
    }
    const text = input.text.trim();
    if (text.length === 0) {
      return yield* new CompanionInvalidRequestError({ message: "a reminder needs a text" });
    }
    const reminder = yield* store.addReminder({
      caller,
      dueAt: iso(dueMs),
      text,
      at: iso(nowMs),
    });
    return { id: reminder.id, dueAt: reminder.dueAt, text: reminder.text };
  });

  const events = Effect.fn("CompanionWatchlist.events")(function* (input: EventsRequest) {
    const caller = (yield* enroll(input.caller)).ref;
    if (input.id !== undefined) {
      const found = yield* store.event(caller, input.id);
      if (found === null) {
        return yield* new CompanionInvalidRequestError({
          message: `event ${input.id} is not yours, or is older than ${Duration.toDays(retention)} days`,
        });
      }
      return [found];
    }
    return yield* locked(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        const pending = yield* store.pendingEvents(caller);
        const live = pending.filter((event) => !isStale(event, world));
        yield* store.settle(
          pending.filter((event) => isStale(event, world)).map((event) => event.id),
          "dropped",
          iso(nowMs),
        );
        yield* store.settle(
          live.map((event) => event.id),
          "taken",
          iso(nowMs),
        );
        return live.map((event): CompanionEvent => Object.assign({}, event, { state: "taken" }));
      }),
    );
  });

  /** Whether a digest whose send had no known outcome is in its caller's thread. */
  const landed = Effect.fn("CompanionWatchlist.landed")(function* (digest: StoredDigest) {
    const environment = yield* environments.resolve(digest.caller.environment);
    const snapshot = yield* environment.orchestration.getThreadBoundedSnapshot(
      digest.caller.threadId,
    );
    const tag = digestTag(digest.id);
    // Another database counts its digests from one too; only a message of this send's time is it.
    const earliest = Date.parse(digest.createdAt) - 60_000;
    return snapshot.projection.messages.some(
      (message) =>
        message.role === "user" &&
        message.text.startsWith(tag) &&
        DateTime.toEpochMillis(message.createdAt) >= earliest,
    );
  });

  /** Sends a stored digest. `unknown` is a send that may or may not have arrived. */
  const send = Effect.fn("CompanionWatchlist.send")(function* (digest: StoredDigest) {
    const environment = yield* environments.resolve(digest.caller.environment);
    const message = {
      threadId: digest.caller.threadId,
      message: digest.text,
      mode: digest.mode,
    };
    // Through T3 Code's MCP the message shows as from an agent; a websocket send shows as the user's.
    const viaAgent = yield* Option.match(environment.agentSender, {
      onNone: () => Effect.succeed("refused" as const),
      onSome: (sender) =>
        sender
          .send({ ...message, requestId: `t3cli-companion-${digest.createdAt}-${digest.id}` })
          .pipe(
            Effect.as("sent" as const),
            Effect.catch((error) =>
              Effect.logWarning(
                `agent-marked digest ${digest.id} to ${threadRefKey(digest.caller)} failed`,
                error,
              ).pipe(Effect.as(error.refused ? ("refused" as const) : ("unknown" as const))),
            ),
          ),
    });
    if (viaAgent !== "refused") {
      return viaAgent;
    }
    return yield* environment.application
      .sendThread({ ...message, author: { kind: "agent" } })
      .pipe(Effect.as("sent" as const));
  });

  /**
   * Settles what was left open, then sends the caller its pending events if now is the time.
   * One runs per caller at a time.
   */
  const deliver = Effect.fn("CompanionWatchlist.deliver")(function* (caller: CallerState) {
    const key = threadRefKey(caller.ref);
    const failed = (nowMs: number) => {
      caller.failures += 1;
      caller.retryAtMs = nowMs + Math.min(retryMs * 2 ** (caller.failures - 1), longestRetryMs);
    };
    if ((yield* Clock.currentTimeMillis) < caller.retryAtMs) {
      return;
    }
    const settle = Effect.fn("CompanionWatchlist.settle")(function* (digest: StoredDigest) {
      const outcome = yield* send(digest).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`digest ${digest.id} to ${key} failed`, cause).pipe(
            Effect.as("unknown" as const),
          ),
        ),
      );
      const nowMs = yield* Clock.currentTimeMillis;
      if (outcome === "sent") {
        yield* store.closeDigest(digest.id, iso(nowMs));
        caller.failures = 0;
        yield* Effect.logInfo(`sent digest ${digest.id} to ${key} (${digest.mode})`);
      } else {
        // The digest stays stored; the next look reads the thread to learn whether it arrived.
        failed(nowMs);
      }
    });
    const open = (yield* store.openDigests()).find((digest) => threadRefKey(digest.caller) === key);
    if (open !== undefined) {
      const arrived = yield* landed(open).pipe(Effect.option);
      const nowMs = yield* Clock.currentTimeMillis;
      if (Option.isNone(arrived)) {
        yield* Effect.logWarning(`could not tell whether digest ${open.id} reached ${key}`);
        failed(nowMs);
      } else if (arrived.value) {
        yield* store.closeDigest(open.id, iso(nowMs));
        caller.failures = 0;
        yield* Effect.logInfo(`digest ${open.id} had reached ${key}`);
      } else if (caller.failures >= abandonAfter) {
        // Its events are pending again, and the next digest says what holds by then.
        yield* store.abandonDigest(open.id);
        caller.failures = 0;
      } else {
        // The same digest under the same request id: T3 Code cannot add it twice.
        yield* settle(open);
      }
      return;
    }
    const digest = yield* locked(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        const pending = yield* store.pendingEvents(caller.ref);
        const stale = pending.filter((event) => isStale(event, world));
        if (stale.length > 0) {
          yield* store.settle(
            stale.map((event) => event.id),
            "dropped",
            iso(nowMs),
          );
          yield* Effect.logInfo(
            `dropped for ${key}, no longer true: ${stale.map((event) => `${event.kind} ${event.subject}`).join(", ")}`,
          );
        }
        const live = pending.filter((event) => !stale.includes(event));
        const state = threads.get(key);
        if (state === undefined) {
          return null;
        }
        const decision = decideDelivery({
          events: live,
          callerInTurn: inTurn(state.shell, nowMs),
          nowMs,
        });
        if (decision.action === "wait") {
          return null;
        }
        return yield* store.openDigest({
          caller: caller.ref,
          text: (id) => formatDigest(id, caller.ref, live),
          mode: decision.mode,
          at: iso(nowMs),
          eventIds: live.map((event) => event.id),
        });
      }),
    );
    if (digest !== null) {
      yield* settle(digest);
    }
  });

  const schedule = (caller: CallerState) =>
    FiberMap.run(
      sending,
      threadRefKey(caller.ref),
      deliver(caller).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`delivery to ${threadRefKey(caller.ref)} failed`, cause),
        ),
      ),
      { onlyIfMissing: true },
    ).pipe(Effect.asVoid);

  /** Reads a caller's transcript for the threads it launched or wrote to since the last read. */
  const scan = Effect.fn("CompanionWatchlist.scan")(function* (caller: CallerState) {
    const environment = yield* environments.resolve(caller.ref.environment);
    const snapshot = yield* environment.orchestration.getThreadBoundedSnapshot(caller.ref.threadId);
    yield* locked(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        if (!callers.has(threadRefKey(caller.ref))) {
          return;
        }
        const found = sentTargets(snapshot.projection.turnItems, caller.cursor);
        let cursor = found.cursor;
        for (const target of found.targets) {
          const ref = findThread(target.threadId, caller.ref.environment);
          if (ref === undefined) {
            const missedAt = caller.unresolved.get(target.threadId) ?? nowMs;
            caller.unresolved.set(target.threadId, missedAt);
            if (nowMs - missedAt < unresolvedMs) {
              // Its row may be on its way: come back to this tool call.
              cursor = Math.min(cursor, target.ordinal - 1);
            } else {
              yield* Effect.logWarning(
                `${threadRefKey(caller.ref)} wrote to thread ${target.threadId}, which no environment shows`,
              );
            }
            continue;
          }
          caller.unresolved.delete(target.threadId);
          if (target.ordinal > cursor) {
            continue;
          }
          const facts = threads.get(threadRefKey(ref));
          const key = watchKey(caller.ref, threadSubject(ref));
          const tombstone = ended.get(key);
          if (
            facts === undefined ||
            facts.phase === "gone" ||
            threadRefKey(ref) === threadRefKey(caller.ref) ||
            // T3 Code reports a delegated child to its parent itself.
            facts.shell.lineage.relationshipToParent === "subagent" ||
            active.has(key) ||
            (tombstone?.endedAt !== null &&
              tombstone?.endedAt !== undefined &&
              Date.parse(tombstone.endedAt) >= target.atMs)
          ) {
            continue;
          }
          const origin: WatchOrigin = target.origin;
          yield* startWatch({
            caller: caller.ref,
            subject: threadSubject(ref),
            origin,
            since: iso(Math.max(target.atMs, caller.enrolledAtMs)),
            green: false,
            memory: {},
          });
          yield* syncLinks([caller.ref], facts.shell, nowMs);
        }
        if (cursor !== caller.cursor) {
          caller.cursor = cursor;
          yield* store.setCursor(caller.ref, cursor);
        }
      }),
    );
  });

  const scanDue = Effect.fn("CompanionWatchlist.scanDue")(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    for (const caller of Array.from(callers.values())) {
      const state = threads.get(threadRefKey(caller.ref));
      if (state === undefined) {
        continue;
      }
      const behind =
        caller.scannedItems !== state.shell.itemCount ||
        [...caller.unresolved.values()].some((missedAt) => nowMs - missedAt < unresolvedMs);
      const turnOver = !inTurn(state.shell, nowMs);
      if (!behind || nowMs - caller.lastScanMs < (turnOver ? 0 : Duration.toMillis(scanInterval))) {
        continue;
      }
      caller.lastScanMs = nowMs;
      const items = state.shell.itemCount;
      yield* scan(caller).pipe(
        Effect.andThen(
          Effect.sync(() => {
            caller.scannedItems = items;
          }),
        ),
        Effect.catchCause((cause) =>
          Effect.logWarning(`could not read the transcript of ${threadRefKey(caller.ref)}`, cause),
        ),
      );
    }
  });

  const tick = Effect.fn("CompanionWatchlist.tick")(function* () {
    yield* locked(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        for (const key of callers.keys()) {
          refresh(key, nowMs);
        }
        for (const subject of Array.from(bySubject.keys())) {
          if (!subject.startsWith("thread:")) {
            continue;
          }
          const key = subject.slice("thread:".length);
          refresh(key, nowMs);
          const state = threads.get(key);
          if (state !== undefined) {
            yield* evaluateThread(
              {
                environment: key.slice(0, key.length - state.shell.id.length - 1),
                threadId: state.shell.id,
              },
              nowMs,
            );
          }
        }
        for (const reminder of yield* store.reminders()) {
          if (Date.parse(reminder.dueAt) <= nowMs) {
            yield* store.fireReminder(reminder.id, {
              caller: reminder.caller,
              subject: reminderSubject(reminder.id),
              kind: "reminder",
              key: String(reminder.id),
              urgent: false,
              at: iso(nowMs),
              payload: {
                title: reminder.text,
                link: null,
                summary: "is due",
                dueAt: reminder.dueAt,
              },
            });
          }
        }
      }),
    );
    yield* scanDue();
    const owed = new Set<string>();
    for (const event of yield* store.pendingEvents(null)) {
      owed.add(threadRefKey(event.caller));
    }
    for (const digest of yield* store.openDigests()) {
      owed.add(threadRefKey(digest.caller));
    }
    for (const key of owed) {
      const caller = callers.get(key);
      if (caller !== undefined) {
        yield* schedule(caller);
      }
    }
  });

  const readPullRequests = Effect.fn("CompanionWatchlist.readPullRequests")(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    const due = [...pulls].filter(([, state]) => state.nextReadMs <= nowMs).map(([pr]) => pr);
    yield* Effect.forEach(
      due,
      (pr) =>
        github.read(pr).pipe(
          Effect.flatMap((view) =>
            locked(
              Effect.gen(function* () {
                yield* applyPullRequest(pr, view, yield* Clock.currentTimeMillis);
              }),
            ),
          ),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const state = pulls.get(pr);
              if (state !== undefined) {
                state.failures += 1;
                state.nextReadMs =
                  (yield* Clock.currentTimeMillis) +
                  Math.min(hotPullRequestMs * 2 ** (state.failures - 1), 10 * 60_000);
              }
              yield* Effect.logWarning(`could not read PR ${pr}`, cause);
            }),
          ),
        ),
      { concurrency: pullRequestConcurrency, discard: true },
    );
  });

  const rereadSnapshots = Effect.fn("CompanionWatchlist.rereadSnapshots")(function* () {
    const watched = new Set<string>([...callers.values()].map((caller) => caller.ref.environment));
    for (const [subject, [first]] of bySubject) {
      const state = subject.startsWith("thread:")
        ? threads.get(subject.slice("thread:".length))
        : undefined;
      if (state !== undefined && first !== undefined) {
        const key = subject.slice("thread:".length);
        watched.add(key.slice(0, key.length - state.shell.id.length - 1));
      }
    }
    for (const environment of watched) {
      yield* loadSnapshot(environment).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`could not re-read the threads of ${environment}`, cause),
        ),
      );
    }
  });

  const ingest = Effect.fn("CompanionWatchlist.ingest")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
  ) {
    yield* locked(
      Effect.gen(function* () {
        yield* absorb(environment, shell, yield* Clock.currentTimeMillis);
      }),
    );
    // A turn that ended releases what was held back for it, without waiting for the clock.
    const caller = callers.get(threadRefKey({ environment, threadId: shell.id }));
    if (caller !== undefined) {
      yield* schedule(caller);
    }
  });

  const forget = Effect.fn("CompanionWatchlist.forget")(function* (
    environment: string,
    threadId: string,
  ) {
    yield* locked(
      Effect.gen(function* () {
        const ref = { environment, threadId };
        const nowMs = yield* Clock.currentTimeMillis;
        threads.delete(threadRefKey(ref));
        lastMessages.delete(threadRefKey(ref));
        if (callers.has(threadRefKey(ref))) {
          yield* removeCaller(ref);
        }
        for (const watched of bySubject.get(threadSubject(ref)) ?? []) {
          yield* store.dropSubject(watched.caller, watched.subject, iso(nowMs));
          yield* endWatch(watched, "gone", nowMs);
        }
      }),
    );
  });

  const run = Effect.all(
    [
      every(tickInterval, "watch check", (round) =>
        Effect.gen(function* () {
          if (round > 0 && round % snapshotTicks === 0) {
            yield* rereadSnapshots();
          }
          if (round % pruneTicks === 0) {
            const nowMs = yield* Clock.currentTimeMillis;
            yield* store.prune(iso(nowMs - Duration.toMillis(retention)));
          }
          yield* tick();
        }),
      ),
      every(pullRequestInterval, "pull request read", () => readPullRequests()),
    ],
    { concurrency: "unbounded", discard: true },
  ).pipe(Effect.andThen(Effect.never));

  return CompanionWatchlist.of({ watch, unwatch, watching, remind, events, ingest, forget, run });
});

export const CompanionWatchlistLive = (options: WatchlistOptions = {}) =>
  Layer.effect(CompanionWatchlist, makeCompanionWatchlist(options));
