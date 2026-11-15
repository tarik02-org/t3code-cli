import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

const StateDirConfig = Config.all({
  localAppData: Config.String("LOCALAPPDATA").pipe(Config.option),
  xdgStateHome: Config.String("XDG_STATE_HOME").pipe(Config.option),
  home: Config.String("HOME").pipe(Config.option),
});

/** `%LOCALAPPDATA%\t3cli` on Windows, `$XDG_STATE_HOME/t3cli` (default `~/.local/state`) elsewhere. */
export const resolveCompanionStateDir = Effect.fn("resolveCompanionStateDir")(function* () {
  const path = yield* Path.Path;
  const config = yield* StateDirConfig;
  if (Option.isSome(config.localAppData)) {
    return path.join(config.localAppData.value, "t3cli");
  }
  if (Option.isSome(config.xdgStateHome)) {
    return path.join(config.xdgStateHome.value, "t3cli");
  }
  const home = yield* Option.match(config.home, {
    onNone: () => Effect.die("HOME is not set"),
    onSome: Effect.succeed,
  });
  return path.join(home, ".local", "state", "t3cli");
});

export const resolveCompanionPaths = Effect.fn("resolveCompanionPaths")(function* () {
  const path = yield* Path.Path;
  const stateDir = yield* resolveCompanionStateDir();
  return {
    stateDir,
    database: path.join(stateDir, "companion.sqlite"),
    runtimeFile: path.join(stateDir, "companion.json"),
    logFile: path.join(stateDir, "companion.log"),
  };
});

export const defaultCompanionPort = 47_731;
