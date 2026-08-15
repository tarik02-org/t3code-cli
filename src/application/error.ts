import type { DomainError } from "../domain/error.ts";
import type { OrchestrationError } from "../orchestration/service.ts";

export type ApplicationError = DomainError | OrchestrationError;
