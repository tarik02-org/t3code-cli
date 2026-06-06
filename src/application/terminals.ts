import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import {
  WS_METHODS,
  type TerminalAttachStreamEvent,
  type TerminalEvent,
  type TerminalSummary,
} from "#t3tools/contracts";

import { ProjectLookupError, TerminalLookupError, ThreadLookupError } from "../domain/error.ts";
import { findProjectById } from "../domain/helpers.ts";
import { T3Orchestration } from "../orchestration/service.ts";
import { RpcError } from "../rpc/error.ts";
import { runRpc, subscribeRpc } from "../rpc/operation.ts";
import { T3Rpc } from "../rpc/service.ts";
import type { T3Application, TerminalAttachTarget, TerminalRef } from "./service.ts";

export type CreateTerminalInput = {
  readonly threadId: string;
  readonly terminalId?: string;
  readonly command?: string;
};

type TerminalApplicationService = Pick<
  T3Application["Service"],
  | "attachTerminal"
  | "createTerminal"
  | "destroyTerminal"
  | "getTerminal"
  | "listTerminals"
  | "resizeTerminal"
  | "watchTerminalEvents"
  | "writeTerminal"
>;

export const makeTerminalApplication = Effect.fn("makeTerminalApplication")(function* () {
  const crypto = yield* Crypto.Crypto;
  const rpc = yield* T3Rpc;
  const orchestration = yield* T3Orchestration;

  const listTerminals: TerminalApplicationService["listTerminals"] = Effect.fn(
    "T3ApplicationLive.listTerminals",
  )(function* (threadId: string) {
    yield* getThreadShell(orchestration, threadId);
    const terminals = yield* getTerminalMetadataSnapshot(rpc);
    return terminals.filter((terminal) => terminal.threadId === threadId);
  });

  const getTerminal: TerminalApplicationService["getTerminal"] = Effect.fn(
    "T3ApplicationLive.getTerminal",
  )(function* (terminal: TerminalRef) {
    yield* getThreadShell(orchestration, terminal.threadId);
    const terminals = yield* getTerminalMetadataSnapshot(rpc);
    const match = terminals.find(
      (candidate) =>
        candidate.threadId === terminal.threadId && candidate.terminalId === terminal.terminalId,
    );
    if (match !== undefined) {
      return match;
    }
    return yield* Effect.fail(
      new TerminalLookupError({
        message: `terminal not found: ${terminal.terminalId} in thread ${terminal.threadId}`,
        threadId: terminal.threadId,
        terminalId: terminal.terminalId,
      }),
    );
  });

  const createTerminal: TerminalApplicationService["createTerminal"] = Effect.fn(
    "T3ApplicationLive.createTerminal",
  )(function* (input: CreateTerminalInput) {
    const snapshot = yield* orchestration.getShellSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === input.threadId);
    if (thread === undefined) {
      return yield* Effect.fail(
        new ThreadLookupError({
          message: `thread not found: ${input.threadId}`,
          threadId: input.threadId,
        }),
      );
    }
    const project = findProjectById(snapshot, thread.projectId);
    if (project === null) {
      return yield* Effect.fail(
        new ProjectLookupError({
          message: `project not found for thread: ${input.threadId}`,
          ref: thread.projectId,
        }),
      );
    }

    const terminalId = input.terminalId ?? `t3cli-${yield* crypto.randomUUIDv4.pipe(Effect.orDie)}`;
    const cwd = thread.worktreePath ?? project.workspaceRoot;
    const opened = yield* runRpc(
      rpc,
      WS_METHODS.terminalOpen,
      rpc.getClient.pipe(
        Effect.flatMap((client) =>
          client[WS_METHODS.terminalOpen]({
            threadId: thread.id,
            terminalId,
            cwd,
            worktreePath: thread.worktreePath ?? null,
          }),
        ),
      ),
    );

    if (input.command !== undefined) {
      yield* runRpc(
        rpc,
        WS_METHODS.terminalWrite,
        rpc.getClient.pipe(
          Effect.flatMap((client) =>
            client[WS_METHODS.terminalWrite]({
              threadId: thread.id,
              terminalId,
              data: `${input.command}\r`,
            }),
          ),
        ),
      );
    }

    return opened;
  });

  const attachTerminal: TerminalApplicationService["attachTerminal"] = (input: {
    readonly terminal: TerminalAttachTarget;
    readonly cols?: number;
    readonly rows?: number;
  }): Stream.Stream<TerminalAttachStreamEvent, RpcError> =>
    subscribeRpc(
      rpc,
      WS_METHODS.terminalAttach,
      Stream.unwrap(
        rpc.getClient.pipe(
          Effect.map((client) =>
            client[WS_METHODS.terminalAttach]({
              threadId: input.terminal.threadId,
              terminalId: input.terminal.terminalId,
              cwd: input.terminal.cwd,
              worktreePath: input.terminal.worktreePath,
              ...(input.cols !== undefined ? { cols: input.cols } : {}),
              ...(input.rows !== undefined ? { rows: input.rows } : {}),
            }),
          ),
        ),
      ),
    );

  const watchTerminalEvents: TerminalApplicationService["watchTerminalEvents"] = (
    terminal: TerminalRef,
  ): Stream.Stream<TerminalEvent, RpcError> =>
    subscribeRpc(
      rpc,
      WS_METHODS.subscribeTerminalEvents,
      Stream.unwrap(
        rpc.getClient.pipe(Effect.map((client) => client[WS_METHODS.subscribeTerminalEvents]({}))),
      ),
    ).pipe(
      Stream.filter(
        (event) => event.threadId === terminal.threadId && event.terminalId === terminal.terminalId,
      ),
    );

  const writeTerminal: TerminalApplicationService["writeTerminal"] = Effect.fn(
    "T3ApplicationLive.writeTerminal",
  )(function* (input: { readonly terminal: TerminalRef; readonly data: string }) {
    yield* runRpc(
      rpc,
      WS_METHODS.terminalWrite,
      rpc.getClient.pipe(
        Effect.flatMap((client) =>
          client[WS_METHODS.terminalWrite]({
            threadId: input.terminal.threadId,
            terminalId: input.terminal.terminalId,
            data: input.data,
          }),
        ),
      ),
    );
  });

  const resizeTerminal: TerminalApplicationService["resizeTerminal"] = Effect.fn(
    "T3ApplicationLive.resizeTerminal",
  )(function* (input: {
    readonly terminal: TerminalRef;
    readonly cols: number;
    readonly rows: number;
  }) {
    yield* runRpc(
      rpc,
      WS_METHODS.terminalResize,
      rpc.getClient.pipe(
        Effect.flatMap((client) =>
          client[WS_METHODS.terminalResize]({
            threadId: input.terminal.threadId,
            terminalId: input.terminal.terminalId,
            cols: input.cols,
            rows: input.rows,
          }),
        ),
      ),
    );
  });

  const destroyTerminal: TerminalApplicationService["destroyTerminal"] = Effect.fn(
    "T3ApplicationLive.destroyTerminal",
  )(function* (terminal: TerminalRef) {
    yield* runRpc(
      rpc,
      WS_METHODS.terminalClose,
      rpc.getClient.pipe(
        Effect.flatMap((client) =>
          client[WS_METHODS.terminalClose]({
            threadId: terminal.threadId,
            terminalId: terminal.terminalId,
            deleteHistory: true,
          }),
        ),
      ),
    );
  });

  return {
    attachTerminal,
    createTerminal,
    destroyTerminal,
    getTerminal,
    listTerminals,
    resizeTerminal,
    watchTerminalEvents,
    writeTerminal,
  } satisfies TerminalApplicationService;
});

function getThreadShell(
  orchestration: T3Orchestration["Service"],
  threadId: string,
): Effect.Effect<
  { readonly id: string; readonly projectId: string; readonly worktreePath: string | null },
  ThreadLookupError | RpcError
> {
  return Effect.gen(function* () {
    const snapshot = yield* orchestration.getShellSnapshot();
    const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
    if (thread !== undefined) {
      return thread;
    }
    return yield* Effect.fail(
      new ThreadLookupError({
        message: `thread not found: ${threadId}`,
        threadId,
      }),
    );
  });
}

function getTerminalMetadataSnapshot(
  rpc: T3Rpc["Service"],
): Effect.Effect<ReadonlyArray<TerminalSummary>, RpcError> {
  return Effect.gen(function* () {
    const item = yield* Stream.runHead(
      subscribeRpc(
        rpc,
        WS_METHODS.subscribeTerminalMetadata,
        Stream.unwrap(
          rpc.getClient.pipe(
            Effect.map((client) => client[WS_METHODS.subscribeTerminalMetadata]({})),
          ),
        ),
      ),
    );
    const value = Option.getOrUndefined(item);
    if (value === undefined || value.type !== "snapshot") {
      return yield* Effect.fail(
        new RpcError({
          message: "server did not return terminal metadata snapshot",
          method: WS_METHODS.subscribeTerminalMetadata,
        }),
      );
    }
    return value.terminals;
  });
}
