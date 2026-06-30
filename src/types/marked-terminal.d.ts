declare module "marked-terminal" {
  import type { MarkedExtension } from "marked";

  export type TerminalRendererOptions = {
    readonly reflowText?: boolean;
    readonly showSectionPrefix?: boolean;
    readonly width?: number;
  };

  export function markedTerminal(options?: TerminalRendererOptions): MarkedExtension;
}
