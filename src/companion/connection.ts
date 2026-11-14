import type { CompanionEnvironmentStatus } from "./schema.ts";

/** An environment's shell stream: delivering, or down since some moment. */
export type Connection =
  | { readonly kind: "connected" }
  | {
      readonly kind: "down";
      readonly sinceMs: number;
      /** Subscribers were told about the outage, so its end is announced too. */
      readonly reported: boolean;
      /** Null until the first failure: the environment is still connecting. */
      readonly lastError: string | null;
    };

export type ConnectionSignal =
  /** A snapshot arrived. */
  | { readonly kind: "connected" }
  | { readonly kind: "dropped"; readonly error: string }
  /** The outage outlasted the grace period. */
  | { readonly kind: "grace-elapsed" };

/** An outage start or end that subscribers should hear about. */
export interface ConnectionReport {
  readonly kind: "env-down" | "env-up";
  readonly sinceMs: number;
  readonly lastError: string | null;
}

/** Starts as an outage, so an environment that never connects is reported too. */
export const initialConnection = (nowMs: number): Connection => ({
  kind: "down",
  sinceMs: nowMs,
  reported: false,
  lastError: null,
});

/** One outage reports at most one `env-down`, and an `env-up` only after that. */
export function stepConnection(
  state: Connection,
  signal: ConnectionSignal,
  nowMs: number,
): readonly [ConnectionReport | null, Connection] {
  if (signal.kind === "connected") {
    return [
      state.kind === "down" && state.reported
        ? { kind: "env-up", sinceMs: state.sinceMs, lastError: state.lastError }
        : null,
      { kind: "connected" },
    ];
  }
  if (signal.kind === "dropped") {
    return [
      null,
      state.kind === "down"
        ? { ...state, lastError: signal.error }
        : { kind: "down", sinceMs: nowMs, reported: false, lastError: signal.error },
    ];
  }
  return state.kind === "down" && !state.reported
    ? [
        { kind: "env-down", sinceMs: state.sinceMs, lastError: state.lastError },
        { ...state, reported: true },
      ]
    : [null, state];
}

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
