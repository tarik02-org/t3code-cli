import type { CompanionEnvironmentStatus } from "./schema.ts";

/** An environment's shell stream: delivering, or not. */
export type Connection =
  | { readonly kind: "connected" }
  /** `lastError` is null until the first failure: the environment is still connecting. */
  | { readonly kind: "down"; readonly lastError: string | null };

export const initialConnection: Connection = { kind: "down", lastError: null };

export const connectionStatus = (
  environment: Pick<CompanionEnvironmentStatus, "name" | "aliases" | "url">,
  state: Connection,
): CompanionEnvironmentStatus => ({
  name: environment.name,
  aliases: environment.aliases,
  url: environment.url,
  state:
    state.kind === "connected"
      ? "connected"
      : state.lastError === null
        ? "connecting"
        : "disconnected",
  lastError: state.kind === "connected" ? null : state.lastError,
});
