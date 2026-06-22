import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import type * as Redacted from "effect/Redacted";

export type T3CliEnvScope = {
  readonly t3codeProjectRoot?: string | undefined;
  readonly t3codeProjectId?: string | undefined;
  readonly t3codeWorktreePath?: string | undefined;
  readonly t3codeThreadId?: string | undefined;
};

export type T3CliEnvShape = {
  readonly home: Option.Option<string>;
  readonly xdgConfigHome: Option.Option<string>;
  readonly t3cliEnv: Option.Option<string>;
  readonly t3codeUrl: Option.Option<string>;
  readonly t3codeToken: Option.Option<Redacted.Redacted>;
  readonly t3codeHome: Option.Option<string>;
  readonly term: Option.Option<string>;
  readonly ci: boolean;
  readonly codexCi: boolean;
  readonly codexThreadId: boolean;
  readonly t3cliAgent: boolean;
  readonly scope: T3CliEnvScope;
};

export const T3CliEnvConfig = Config.all({
  home: Config.string("HOME").pipe(Config.option),
  xdgConfigHome: Config.string("XDG_CONFIG_HOME").pipe(Config.option),
  t3cliEnv: Config.string("T3CLI_ENV").pipe(Config.option),
  t3codeUrl: Config.string("T3CODE_URL").pipe(Config.option),
  t3codeToken: Config.redacted("T3CODE_TOKEN").pipe(Config.option),
  t3codeHome: Config.string("T3CODE_HOME").pipe(Config.option),
  t3codeProjectRoot: Config.string("T3CODE_PROJECT_ROOT").pipe(Config.option),
  t3codeProjectId: Config.string("T3CODE_PROJECT_ID").pipe(Config.option),
  t3codeWorktreePath: Config.string("T3CODE_WORKTREE_PATH").pipe(Config.option),
  t3codeThreadId: Config.string("T3CODE_THREAD_ID").pipe(Config.option),
  term: Config.string("TERM").pipe(Config.option),
  ci: Config.string("CI").pipe(Config.option, Config.map(Option.isSome)),
  codexCi: Config.string("CODEX_CI").pipe(Config.option, Config.map(Option.isSome)),
  codexThreadId: Config.string("CODEX_THREAD_ID").pipe(Config.option, Config.map(Option.isSome)),
  t3cliAgent: Config.string("T3CLI_AGENT").pipe(Config.option, Config.map(Option.isSome)),
});

function toScope(loaded: {
  readonly t3codeProjectRoot: Option.Option<string>;
  readonly t3codeProjectId: Option.Option<string>;
  readonly t3codeWorktreePath: Option.Option<string>;
  readonly t3codeThreadId: Option.Option<string>;
}): T3CliEnvScope {
  return {
    ...(Option.isSome(loaded.t3codeProjectRoot)
      ? { t3codeProjectRoot: loaded.t3codeProjectRoot.value }
      : {}),
    ...(Option.isSome(loaded.t3codeProjectId)
      ? { t3codeProjectId: loaded.t3codeProjectId.value }
      : {}),
    ...(Option.isSome(loaded.t3codeWorktreePath)
      ? { t3codeWorktreePath: loaded.t3codeWorktreePath.value }
      : {}),
    ...(Option.isSome(loaded.t3codeThreadId)
      ? { t3codeThreadId: loaded.t3codeThreadId.value }
      : {}),
  };
}

export const loadT3CliEnv = Effect.map(T3CliEnvConfig, (loaded) => ({
  home: loaded.home,
  xdgConfigHome: loaded.xdgConfigHome,
  t3cliEnv: loaded.t3cliEnv,
  t3codeUrl: loaded.t3codeUrl,
  t3codeToken: loaded.t3codeToken,
  t3codeHome: loaded.t3codeHome,
  term: loaded.term,
  ci: loaded.ci,
  codexCi: loaded.codexCi,
  codexThreadId: loaded.codexThreadId,
  t3cliAgent: loaded.t3cliAgent,
  scope: toScope(loaded),
}));
