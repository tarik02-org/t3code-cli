import { homedir } from "node:os";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

export type T3Layout = {
  readonly cwd: string;
  readonly homeDir: string;
  readonly t3codeHome?: string | undefined;
};

export function readT3LayoutFromNodeProcess(): T3Layout {
  return {
    cwd: process.cwd(),
    homeDir: homedir(),
    t3codeHome: process.env["T3CODE_HOME"],
  };
}

export const resolveT3BaseDir = Effect.fn("resolveT3BaseDir")(function* (input: {
  readonly layout: T3Layout;
  readonly baseDir?: string | undefined;
}) {
  const path = yield* Path.Path;
  const raw = input.baseDir ?? input.layout.t3codeHome;
  if (raw === undefined || raw.length === 0) {
    return path.join(input.layout.homeDir, ".t3");
  }
  if (raw === "~") {
    return input.layout.homeDir;
  }
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return path.join(input.layout.homeDir, raw.slice(2));
  }
  return path.resolve(input.layout.cwd, raw);
});
