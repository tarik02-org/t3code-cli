import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";

import {
  baselinesFor,
  describe,
  evaluate,
  type Evaluation,
  leavesOf,
  parsePullRequest,
  referencesOf,
  summarize,
  type ThreadView,
  type World,
} from "./condition.ts";
import { CompanionEnvironments } from "./environments.ts";
import { CompanionInvalidRequestError, type CompanionStoreError } from "./error.ts";
import { CompanionPullRequests } from "./github.ts";
import {
  Condition,
  threadRefKey,
  type FiredWait,
  type PullRequestView,
  type ThreadPayload,
  type ThreadRef,
  type ThreadRefInput,
  type WaitCreated,
  type WaitNowRequest,
  type WaitRequest,
  type WaitResult,
  type WaitResultRequest,
  type WaitSelection,
  type WaitsListing,
  type WaitsRequest,
} from "./schema.ts";
import { inTurn, ownTaskLabels, threadState } from "./state.ts";
import { CompanionStore, type StoredFire, type StoredWait } from "./store.ts";
import { makeWaker } from "./wake.ts";

/** How often every pending wait is evaluated against the clock. */
export const tickInterval = Duration.seconds(2);
/** Pull requests named by a pending wait are read from GitHub every this many ticks. */
export const pullRequestTicks = 15;
/**
 * Environments with a pending thread wait have their whole snapshot re-read every this many
 * ticks, so a shell update the stream dropped cannot leave a wait hanging.
 */
export const snapshotTicks = 60;
const pruneTicks = 1800;
/** How long a finished wait and its payload stay readable. */
export const retention = Duration.hours(24);
export const maxWaitNowSeconds = 600;
/** The most of a thread's last message a payload carries. */
export const lastMessageLength = 10_000;
const maxLeaves = 24;

type RequestError = CompanionInvalidRequestError | CompanionStoreError;

export class CompanionWaits extends Context.Service<
  CompanionWaits,
  {
    /** Makes a wait; it fires on the spot when its condition already holds. */
    readonly create: (input: WaitRequest) => Effect.Effect<WaitCreated, RequestError>;
    /** Blocks until the condition holds or the timeout passes. */
    readonly now: (input: WaitNowRequest) => Effect.Effect<WaitResult, RequestError>;
    readonly list: (input: WaitsRequest) => Effect.Effect<WaitsListing, RequestError>;
    readonly cancel: (input: WaitSelection) => Effect.Effect<number, RequestError>;
    /** The last firing of a wait, with its whole payload. */
    readonly result: (input: WaitResultRequest) => Effect.Effect<FiredWait, RequestError>;
    /** Takes a thread's latest shell row from the watcher. */
    readonly ingest: (
      environment: string,
      shell: OrchestrationV2ThreadShell,
    ) => Effect.Effect<void, CompanionStoreError>;
    /** Drops what is remembered about a thread that no longer exists. */
    readonly forget: (environment: string, threadId: string) => Effect.Effect<void>;
    /** Evaluates on a clock, reads pull requests and re-reads snapshots; runs forever. */
    readonly run: Effect.Effect<never>;
  }
>()("t3cli/companion/CompanionWaits") {}

const decodeCondition = Schema.decodeUnknownEffect(Condition);

const toFired = (fire: StoredFire): FiredWait => ({
  id: fire.wait.id,
  label: fire.wait.label,
  condition: describe(fire.wait.condition),
  summary: fire.summary,
  result: fire.result,
});

const iso = (ms: number) => DateTime.formatIso(DateTime.makeUnsafe(ms));

export const makeCompanionWaits = Effect.fn("makeCompanionWaits")(function* () {
  const store = yield* CompanionStore;
  const environments = yield* CompanionEnvironments;
  const github = yield* CompanionPullRequests;

  // The latest state of everything a wait can name. Only read and written between yields.
  const threads = new Map<string, ThreadView>();
  const pullRequests = new Map<string, PullRequestView>();
  const pending = new Map<number, StoredWait>();
  // Owners with a firing their wake message has not carried yet.
  const owing = new Map<string, ThreadRef>();
  const fired = yield* PubSub.unbounded<StoredFire>();

  const world = (nowMs: number): World => ({
    nowMs,
    thread: (ref) => threads.get(threadRefKey(ref)),
    pullRequest: (pr) => pullRequests.get(pr),
  });

  const waker = yield* makeWaker({
    latestShell: (ref) => threads.get(threadRefKey(ref))?.shell,
    pendingCount: (owner) =>
      [...pending.values()].filter(
        (wait) => !wait.ephemeral && threadRefKey(wait.owner) === threadRefKey(owner),
      ).length,
    settled: (owner) => {
      owing.delete(threadRefKey(owner));
    },
  });

  for (const wait of yield* store.pendingWaits()) {
    // A blocking call's wait does not outlive the daemon that served the call.
    if (wait.ephemeral) {
      yield* store.removeWait(wait.id);
    } else {
      pending.set(wait.id, wait);
    }
  }
  for (const fire of yield* store.undelivered(null, "woken")) {
    owing.set(threadRefKey(fire.wait.owner), fire.wait.owner);
  }
  for (const owner of owing.values()) {
    yield* waker.schedule(owner);
  }

  const observe = (environment: string, shell: OrchestrationV2ThreadShell, nowMs: number) => {
    const key = threadRefKey({ environment, threadId: shell.id });
    const state = threadState(shell, nowMs);
    const known = threads.get(key);
    threads.set(key, {
      shell,
      state,
      sinceMs: known !== undefined && known.state === state ? known.sinceMs : nowMs,
    });
  };

  const named = () => {
    const threadRefs = new Map<string, ThreadRef>();
    const prs = new Set<string>();
    for (const wait of pending.values()) {
      const references = referencesOf(wait.condition);
      for (const ref of references.threads) {
        threadRefs.set(threadRefKey(ref), ref);
      }
      for (const pr of references.pullRequests) {
        prs.add(pr);
      }
    }
    return { threads: threadRefs, pullRequests: prs };
  };

  const lastMessageOf = Effect.fn("CompanionWaits.lastMessageOf")(function* (ref: ThreadRef) {
    const visible = threads.get(threadRefKey(ref))?.shell.latestVisibleMessage ?? null;
    const fallback = visible !== null && visible.role === "assistant" ? visible.text : null;
    return yield* environments.resolve(ref.environment).pipe(
      Effect.flatMap((environment) =>
        environment.orchestration.getThreadBoundedSnapshot(ref.threadId),
      ),
      Effect.map((snapshot) => {
        const message = snapshot.projection.turnItems.findLast(
          (item) => item.type === "assistant_message",
        );
        return message !== undefined && "text" in message ? message.text : fallback;
      }),
      Effect.catchCause((cause) =>
        Effect.logWarning(`could not read the last message of ${threadRefKey(ref)}`, cause).pipe(
          Effect.as(fallback),
        ),
      ),
      Effect.map((text) => (text === null ? null : text.slice(0, lastMessageLength))),
    );
  });

  const payloadOf = Effect.fn("CompanionWaits.payloadOf")(function* (
    wait: StoredWait,
    outcome: WaitResult["outcome"],
    evaluation: Evaluation,
    nowMs: number,
  ) {
    const references = referencesOf(wait.condition);
    const threadPayloads: Array<ThreadPayload> = [];
    for (const ref of references.threads) {
      const view = threads.get(threadRefKey(ref));
      if (view !== undefined) {
        threadPayloads.push({
          environment: ref.environment,
          threadId: ref.threadId,
          title: view.shell.title,
          state: view.state,
          pendingTasks: ownTaskLabels(view.shell),
          lastMessage: yield* lastMessageOf(ref),
        });
      }
    }
    return {
      outcome,
      at: iso(nowMs),
      leaves: evaluation.leaves,
      threads: threadPayloads,
      pullRequests: references.pullRequests.flatMap((pr) => {
        const view = pullRequests.get(pr);
        return view === undefined ? [] : [view];
      }),
    } satisfies WaitResult;
  });

  /**
   * Fires a wait. The wait leaves `pending`, or is disarmed, before the first yield, so a second
   * evaluation running meanwhile cannot fire it again. `inline` is a firing its caller hands
   * over itself, which needs no wake.
   */
  const fireWait = Effect.fn("CompanionWaits.fireWait")(function* (
    wait: StoredWait,
    outcome: WaitResult["outcome"],
    evaluation: Evaluation,
    nowMs: number,
    inline: boolean,
  ) {
    const again =
      wait.repeat && outcome === "matched"
        ? { ...wait, armed: false, baselines: baselinesFor(wait.condition, world(nowMs)) }
        : null;
    if (again === null) {
      pending.delete(wait.id);
    } else {
      pending.set(wait.id, again);
    }
    const result = yield* payloadOf(wait, outcome, evaluation, nowMs);
    const summary = summarize(outcome, evaluation.leaves);
    yield* store.updateWait(
      wait.id,
      again === null
        ? { status: outcome === "matched" ? "fired" : "timeout" }
        : { armed: false, baselines: again.baselines },
    );
    const fireId = yield* store.recordFire({ waitId: wait.id, at: result.at, summary, result });
    const stored: StoredFire = { fireId, wait, summary, result };
    yield* Effect.logInfo(
      `wait ${wait.id} of ${threadRefKey(wait.owner)} ${outcome === "matched" ? "matched" : "timed out"}: ${summary}`,
    );
    yield* PubSub.publish(fired, stored);
    if (inline || wait.ephemeral) {
      yield* store.markDelivered([fireId], result.at);
    } else if (wait.wake !== "none") {
      owing.set(threadRefKey(wait.owner), wait.owner);
      yield* waker.schedule(wait.owner);
    }
    return stored;
  });

  /** Evaluates one wait now, firing or re-arming it as its condition and deadline say. */
  const consider = Effect.fn("CompanionWaits.consider")(function* (
    wait: StoredWait,
    nowMs: number,
    inline: boolean,
  ) {
    const evaluation = evaluate(wait.condition, world(nowMs), wait.baselines);
    if (evaluation.truth === "true" && wait.armed) {
      return { evaluation, fire: yield* fireWait(wait, "matched", evaluation, nowMs, inline) };
    }
    if (wait.deadlineAt !== null && nowMs >= Date.parse(wait.deadlineAt)) {
      return { evaluation, fire: yield* fireWait(wait, "timeout", evaluation, nowMs, inline) };
    }
    if (!wait.armed && evaluation.truth === "false") {
      pending.set(wait.id, { ...wait, armed: true });
      yield* store.updateWait(wait.id, { armed: true });
    }
    return { evaluation, fire: null };
  });

  const sweep = Effect.fn("CompanionWaits.sweep")(function* () {
    const nowMs = yield* Clock.currentTimeMillis;
    // A queued message stops counting as a turn after a while, with no new row to say so.
    for (const key of named().threads.keys()) {
      const view = threads.get(key);
      const state = view === undefined ? undefined : threadState(view.shell, nowMs);
      if (view !== undefined && state !== undefined && state !== view.state) {
        threads.set(key, { shell: view.shell, state, sinceMs: nowMs });
      }
    }
    for (const wait of pending.values()) {
      // Another evaluation may have fired or re-armed it while this one yielded.
      if (pending.get(wait.id) === wait) {
        yield* consider(wait, nowMs, false);
      }
    }
  });

  /** Resolves env aliases to the canonical name everything is keyed on. */
  const normalizeRef = Effect.fn("CompanionWaits.normalizeRef")(function* (ref: ThreadRefInput) {
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

  const canonical: (
    condition: Condition,
  ) => Effect.Effect<Condition, CompanionInvalidRequestError> = Effect.fn(
    "CompanionWaits.canonical",
  )(function* (condition: Condition) {
    if ("any" in condition) {
      return { any: yield* Effect.forEach(condition.any, canonical) };
    }
    if ("all" in condition) {
      return { all: yield* Effect.forEach(condition.all, canonical) };
    }
    if ("not" in condition) {
      return { not: yield* canonical(condition.not) };
    }
    if ("thread" in condition) {
      const ref = yield* normalizeRef({
        environment: condition.environment,
        threadId: condition.thread,
      });
      return { ...condition, environment: ref.environment };
    }
    if ("pr" in condition) {
      const parsed = parsePullRequest(condition.pr);
      if (parsed === null) {
        return yield* new CompanionInvalidRequestError({
          message: `"${condition.pr}" is not a pull request; write owner/repo#123`,
        });
      }
      return { ...condition, pr: `${parsed.owner}/${parsed.name}#${parsed.number}` };
    }
    if (!(condition.after >= 0)) {
      return yield* new CompanionInvalidRequestError({ message: "after must be 0 or more" });
    }
    return condition;
  });

  const loadSnapshot = Effect.fn("CompanionWaits.loadSnapshot")(function* (environment: string) {
    const snapshot = yield* environments
      .resolve(environment)
      .pipe(Effect.flatMap((resolved) => resolved.orchestration.getShellSnapshot()));
    const nowMs = yield* Clock.currentTimeMillis;
    for (const shell of snapshot.threads) {
      observe(environment, shell, nowMs);
    }
  });

  /** Checks a condition and makes sure the state it reads is here, so it can be judged at once. */
  const prepare = Effect.fn("CompanionWaits.prepare")(function* (raw: unknown) {
    const decoded = yield* decodeCondition(raw).pipe(
      Effect.mapError(
        (error) =>
          new CompanionInvalidRequestError({
            message: `the condition is not valid: ${error.message}`,
          }),
      ),
    );
    const leaves = leavesOf(decoded).length;
    if (leaves === 0 || leaves > maxLeaves) {
      return yield* new CompanionInvalidRequestError({
        message: `a condition names between 1 and ${maxLeaves} things to wait for, not ${leaves}`,
      });
    }
    const condition = yield* canonical(decoded);
    const references = referencesOf(condition);
    for (const ref of references.threads) {
      if (!threads.has(threadRefKey(ref))) {
        yield* loadSnapshot(ref.environment).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning(`could not read the threads of ${ref.environment}`, cause),
          ),
        );
      }
      if (!threads.has(threadRefKey(ref))) {
        return yield* new CompanionInvalidRequestError({
          message: `thread ${ref.threadId} is not known on ${ref.environment}`,
        });
      }
    }
    for (const pr of references.pullRequests) {
      const view = yield* github
        .read(pr)
        .pipe(
          Effect.mapError((error) => new CompanionInvalidRequestError({ message: error.message })),
        );
      pullRequests.set(pr, view);
    }
    return condition;
  });

  const create = Effect.fn("CompanionWaits.create")(function* (input: WaitRequest) {
    const owner = yield* normalizeRef(input.owner);
    const condition = yield* prepare(input.condition);
    if (input.deadline !== undefined && !(input.deadline > 0)) {
      return yield* new CompanionInvalidRequestError({ message: "deadline must be above 0" });
    }
    const nowMs = yield* Clock.currentTimeMillis;
    const label = input.label?.trim() ?? "";
    const wait = yield* store.createWait({
      owner,
      label: label.length === 0 ? null : label,
      condition,
      wake: input.wake ?? "turn-end",
      repeat: input.repeat ?? false,
      ephemeral: false,
      deadlineAt: input.deadline === undefined ? null : iso(nowMs + input.deadline * 1000),
      createdAt: iso(nowMs),
      baselines: baselinesFor(condition, world(nowMs)),
    });
    pending.set(wait.id, wait);
    yield* Effect.logInfo(
      `wait ${wait.id} of ${threadRefKey(owner)}: ${describe(condition)} (wake ${wait.wake})`,
    );
    // What already holds is answered in this call, not by a wake.
    const considered = yield* consider(wait, nowMs, true);
    return {
      id: wait.id,
      fired: considered.fire === null ? null : toFired(considered.fire),
      leaves: considered.evaluation.leaves,
    } satisfies WaitCreated;
  });

  const now = Effect.fn("CompanionWaits.now")(function* (input: WaitNowRequest) {
    const owner = yield* normalizeRef(input.owner);
    const condition = yield* prepare(input.condition);
    const seconds = Math.min(Math.max(input.timeout, 0), maxWaitNowSeconds);
    // Subscribe before the wait exists, so its firing cannot slip past.
    const live = yield* PubSub.subscribe(fired);
    const nowMs = yield* Clock.currentTimeMillis;
    const wait = yield* store.createWait({
      owner,
      label: null,
      condition,
      wake: "none",
      repeat: false,
      ephemeral: true,
      deadlineAt: iso(nowMs + seconds * 1000),
      createdAt: iso(nowMs),
      baselines: baselinesFor(condition, world(nowMs)),
    });
    pending.set(wait.id, wait);
    return yield* Effect.gen(function* () {
      const considered = yield* consider(wait, nowMs, true);
      if (considered.fire !== null) {
        return considered.fire.result;
      }
      while (true) {
        const next = yield* PubSub.take(live);
        if (next.wait.id === wait.id) {
          return next.result;
        }
      }
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => pending.delete(wait.id)).pipe(
          Effect.andThen(store.removeWait(wait.id)),
          Effect.catchCause((cause) =>
            Effect.logWarning(`could not remove the blocking wait ${wait.id}`, cause),
          ),
        ),
      ),
    );
  }, Effect.scoped);

  const list = Effect.fn("CompanionWaits.list")(function* (input: WaitsRequest) {
    const owner = input.owner === undefined ? null : yield* normalizeRef(input.owner);
    const nowMs = yield* Clock.currentTimeMillis;
    const silent = yield* store.undelivered(owner, "silent");
    if (input.collect) {
      yield* store.markDelivered(
        silent.map((fire) => fire.fireId),
        iso(nowMs),
      );
    }
    return {
      pending: [...pending.values()]
        .filter(
          (wait) =>
            !wait.ephemeral && (owner === null || threadRefKey(wait.owner) === threadRefKey(owner)),
        )
        .map((wait) => ({
          owner: wait.owner,
          id: wait.id,
          label: wait.label,
          condition: describe(wait.condition),
          wake: wait.wake,
          repeat: wait.repeat,
          deadlineAt: wait.deadlineAt,
          createdAt: wait.createdAt,
          leaves: evaluate(wait.condition, world(nowMs), wait.baselines).leaves,
        })),
      fired: silent.map(toFired),
    } satisfies WaitsListing;
  });

  const cancel = Effect.fn("CompanionWaits.cancel")(function* (input: WaitSelection) {
    const owner = yield* normalizeRef(input.owner);
    let cancelled = 0;
    for (const id of input.ids) {
      const wait = pending.get(id);
      if (wait !== undefined && threadRefKey(wait.owner) === threadRefKey(owner)) {
        pending.delete(id);
        yield* store.updateWait(id, { status: "cancelled" });
        cancelled += 1;
      }
    }
    return cancelled;
  });

  const result = Effect.fn("CompanionWaits.result")(function* (input: WaitResultRequest) {
    const owner = yield* normalizeRef(input.owner);
    const fire = yield* store.latestFire(owner, input.id);
    if (fire === null) {
      return yield* new CompanionInvalidRequestError({
        message: `wait ${input.id} has not fired, is not yours, or fired more than ${Duration.toHours(retention)} hours ago`,
      });
    }
    return toFired(fire);
  });

  const ingest = Effect.fn("CompanionWaits.ingest")(function* (
    environment: string,
    shell: OrchestrationV2ThreadShell,
  ) {
    const nowMs = yield* Clock.currentTimeMillis;
    const ref = { environment, threadId: shell.id };
    const key = threadRefKey(ref);
    const before = threads.get(key);
    observe(environment, shell, nowMs);
    // A turn that ended releases what was held back for it.
    if (
      owing.has(key) &&
      before !== undefined &&
      inTurn(before.shell, nowMs) &&
      !inTurn(shell, nowMs)
    ) {
      yield* waker.schedule(ref);
    }
    if (named().threads.has(key)) {
      yield* sweep();
    }
  });

  const forget = (environment: string, threadId: string) =>
    Effect.sync(() => {
      threads.delete(threadRefKey({ environment, threadId }));
    });

  const readPullRequests = Effect.fn("CompanionWaits.readPullRequests")(function* () {
    for (const pr of named().pullRequests) {
      yield* github.read(pr).pipe(
        Effect.map((view) => {
          pullRequests.set(pr, view);
        }),
        Effect.catchCause((cause) => Effect.logWarning(`could not read PR ${pr}`, cause)),
      );
    }
  });

  const rereadSnapshots = Effect.fn("CompanionWaits.rereadSnapshots")(function* () {
    const referenced = new Set([...named().threads.values()].map((ref) => ref.environment));
    for (const environment of referenced) {
      yield* loadSnapshot(environment).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning(`could not re-read the threads of ${environment}`, cause),
        ),
      );
    }
  });

  const run = Effect.gen(function* () {
    let tick = 0;
    while (true) {
      const current = tick;
      yield* Effect.gen(function* () {
        if (current % pullRequestTicks === 0) {
          yield* readPullRequests();
        }
        if (current > 0 && current % snapshotTicks === 0) {
          yield* rereadSnapshots();
        }
        if (current % pruneTicks === 0) {
          const nowMs = yield* Clock.currentTimeMillis;
          yield* store.prune(iso(nowMs - Duration.toMillis(retention)));
        }
        yield* sweep();
      }).pipe(Effect.catchCause((cause) => Effect.logWarning("wait check failed", cause)));
      tick += 1;
      yield* Effect.sleep(tickInterval);
    }
  });

  return CompanionWaits.of({ create, now, list, cancel, result, ingest, forget, run });
});

export const CompanionWaitsLive = Layer.effect(CompanionWaits, makeCompanionWaits());
