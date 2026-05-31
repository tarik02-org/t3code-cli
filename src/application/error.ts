import type { DomainError } from "../domain/error.ts";
import type { RpcError } from "../rpc/error.ts";

export type ApplicationError = DomainError | RpcError;
