import { homedir } from "node:os";
import type * as Path from "effect/Path";

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

export function resolveT3BaseDir(input: {
  readonly layout: T3Layout;
  readonly baseDir?: string | undefined;
  readonly path: Path.Path;
}): string {
  const raw = input.baseDir ?? input.layout.t3codeHome;
  if (raw === undefined || raw.length === 0) {
    return input.path.join(input.layout.homeDir, ".t3");
  }
  if (raw === "~") {
    return input.layout.homeDir;
  }
  if (raw.startsWith("~/") || raw.startsWith("~\\")) {
    return input.path.join(input.layout.homeDir, raw.slice(2));
  }
  return input.path.resolve(input.layout.cwd, raw);
}
