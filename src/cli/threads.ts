import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { readInitialMessage } from "../domain/message-input.ts";
import {
  formatThreadMessagesHuman,
  formatThreadMessagesJson,
  formatThreadsHuman,
  formatThreadStartedHuman,
  formatWaitDoneHuman,
  formatWaitEventNdjson,
} from "../domain/thread-format.ts";
import { T3Domain } from "../domain/service.ts";
import { InvalidLimitError } from "../domain/error.ts";
import { T3Input } from "../input/service.ts";
import { T3Output } from "../output/service.ts";

export function createThreadsCommand() {
  return Command.make("threads").pipe(
    Command.withDescription("thread commands"),
    Command.withSubcommands([
      listCommand,
      startCommand,
      sendCommand,
      archiveCommand,
      messagesCommand,
      waitCommand,
    ]),
  );
}

const listCommand = Command.make(
  "list",
  {
    project: Argument.string("project"),
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ project, format }) =>
    Effect.gen(function* () {
      const domain = yield* T3Domain;
      const output = yield* T3Output;
      const result = yield* domain.listThreads(project);
      if (format === "json") yield* output.printJson(result.threads);
      else yield* output.writeStdout(formatThreadsHuman(result.threads));
    }),
).pipe(Command.withDescription("list project threads"));

const startCommand = Command.make(
  "start",
  {
    project: Argument.string("project"),
    message: Argument.string("message").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    title: Flag.string("title").pipe(Flag.optional),
    worktree: Flag.string("worktree").pipe(Flag.optional),
    provider: Flag.string("provider").pipe(Flag.optional),
    model: Flag.string("model").pipe(Flag.optional),
    wait: Flag.boolean("wait"),
    format: Flag.choice("format", ["human", "json", "ndjson"] as const).pipe(
      Flag.withDefault("human"),
    ),
  },
  ({ project, message, stdin, title, worktree, provider, model, wait, format }) =>
    Effect.gen(function* () {
      const inputService = yield* T3Input;
      const text = yield* readInitialMessage({
        message: Option.getOrUndefined(message),
        fromStdin: stdin,
        readStdin: inputService.readStdin,
      });
      const titleValue = Option.getOrUndefined(title);
      const worktreeValue = Option.getOrUndefined(worktree);
      const providerValue = Option.getOrUndefined(provider);
      const modelValue = Option.getOrUndefined(model);
      const input = {
        projectRef: project,
        message: text,
        ...(titleValue ? { title: titleValue } : {}),
        ...(worktreeValue ? { worktreePath: worktreeValue } : {}),
        ...(providerValue ? { provider: providerValue } : {}),
        ...(modelValue ? { model: modelValue } : {}),
      };
      const domain = yield* T3Domain;
      const output = yield* T3Output;

      if (format === "ndjson") {
        const started = wait
          ? yield* domain.startThread(input, {
              until: "complete",
              onEvent: (event) => output.printNdjson(formatWaitEventNdjson(event)),
            })
          : yield* domain.startThread(input, { until: "visible" });
        yield* output.printNdjson({ type: "dispatch", sequence: started.dispatch.sequence });
        if (!wait) {
          yield* output.printNdjson(
            formatWaitEventNdjson({ type: "thread", thread: started.thread! }),
          );
        }
        return;
      }

      if (wait) {
        const started = yield* domain.startThread(input, { until: "dispatch" });
        yield* output.printInfo(`waiting for ${started.threadId}...`);
        const thread = yield* domain.waitForThread(started.threadId);
        yield* output.writeStdout(formatWaitDoneHuman(thread));
        return;
      }

      const result = yield* domain.startThread(input, { until: "visible" });
      if (format === "json") yield* output.printJson(result);
      else
        yield* output.printInfo(
          formatThreadStartedHuman({
            thread: result.thread!,
            sequence: result.dispatch.sequence,
          }),
        );
    }),
).pipe(Command.withDescription("start thread with initial message"));

const sendCommand = Command.make(
  "send",
  {
    thread: Argument.string("thread"),
    message: Argument.string("message").pipe(Argument.optional),
    stdin: Flag.boolean("stdin"),
    wait: Flag.boolean("wait"),
    format: Flag.choice("format", ["human", "json", "ndjson"] as const).pipe(
      Flag.withDefault("human"),
    ),
  },
  ({ thread, message, stdin, wait, format }) =>
    Effect.gen(function* () {
      const inputService = yield* T3Input;
      const text = yield* readInitialMessage({
        message: Option.getOrUndefined(message),
        fromStdin: stdin,
        readStdin: inputService.readStdin,
      });
      const domain = yield* T3Domain;
      const output = yield* T3Output;

      if (format === "ndjson") {
        const sent = wait
          ? yield* domain.sendThread(
              { message: text, threadId: thread },
              {
                until: "complete",
                onEvent: (event) => output.printNdjson(formatWaitEventNdjson(event)),
              },
            )
          : yield* domain.sendThread({ message: text, threadId: thread }, { until: "visible" });
        yield* output.printNdjson({ type: "dispatch", sequence: sent.dispatch.sequence });
        return;
      }

      if (wait) {
        const sent = yield* domain.sendThread(
          { message: text, threadId: thread },
          { until: "dispatch" },
        );
        yield* output.printInfo(`waiting for ${sent.threadId}...`);
        const finalThread = yield* domain.waitForThread(sent.threadId);
        yield* output.writeStdout(formatWaitDoneHuman(finalThread));
        return;
      }

      const result = yield* domain.sendThread(
        { message: text, threadId: thread },
        { until: "visible" },
      );
      if (format === "json") yield* output.printJson(result);
      else yield* output.printInfo(`message sent: ${result.threadId}`);
    }),
).pipe(Command.withDescription("send message to existing thread"));

const archiveCommand = Command.make(
  "archive",
  {
    thread: Argument.string("thread"),
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const domain = yield* T3Domain;
      const output = yield* T3Output;
      const dispatch = yield* domain.archiveThread(thread);
      if (format === "json") yield* output.printJson(dispatch);
      else yield* output.printInfo(`thread archived: ${thread}\nsequence: ${dispatch.sequence}`);
    }),
).pipe(Command.withDescription("archive thread"));

const messagesCommand = Command.make(
  "messages",
  {
    thread: Argument.string("thread"),
    limit: Flag.integer("limit").pipe(Flag.withDefault(20)),
    full: Flag.boolean("full"),
    format: Flag.choice("format", ["human", "json"] as const).pipe(Flag.withDefault("human")),
  },
  ({ thread, limit, full, format }) =>
    Effect.gen(function* () {
      if (limit < 0) {
        return yield* Effect.fail(
          new InvalidLimitError({ message: `invalid limit: ${limit}`, value: String(limit) }),
        );
      }
      const domain = yield* T3Domain;
      const output = yield* T3Output;
      const detail = yield* domain.getThreadMessages(thread);
      if (format === "json") return yield* output.printJson(formatThreadMessagesJson(detail, full));
      return yield* output.writeStdout(formatThreadMessagesHuman(detail, limit));
    }),
).pipe(Command.withDescription("get latest thread messages"));

const waitCommand = Command.make(
  "wait",
  {
    thread: Argument.string("thread"),
    format: Flag.choice("format", ["human", "ndjson"] as const).pipe(Flag.withDefault("human")),
  },
  ({ thread, format }) =>
    Effect.gen(function* () {
      const domain = yield* T3Domain;
      const output = yield* T3Output;
      if (format === "ndjson") {
        yield* domain.waitForThread(thread, (event) =>
          output.printNdjson(formatWaitEventNdjson(event)),
        );
        return;
      }
      yield* output.printInfo(`waiting for ${thread}...`);
      const finalThread = yield* domain.waitForThread(thread);
      yield* output.writeStdout(formatWaitDoneHuman(finalThread));
    }),
).pipe(Command.withDescription("wait for thread to pause"));
