import * as Option from "effect/Option";

type ModelOptionValue = string | boolean;

export type ModelOption = {
  readonly id: string;
  readonly value: ModelOptionValue;
};

export function buildModelOptions(input: {
  readonly option: Option.Option<Record<string, string>>;
  readonly reasoningEffort: Option.Option<string>;
  readonly effort: Option.Option<string>;
  readonly fastMode: Option.Option<boolean>;
  readonly thinking: Option.Option<boolean>;
}): ReadonlyArray<ModelOption> {
  const options = new Map<string, ModelOption>();
  const optionRecord = Option.getOrUndefined(input.option);
  if (optionRecord !== undefined) {
    for (const [id, value] of Object.entries(optionRecord)) {
      options.set(id, { id, value: parseModelOptionValue(value) });
    }
  }
  setStringOption(options, "reasoningEffort", Option.getOrUndefined(input.reasoningEffort));
  setStringOption(options, "effort", Option.getOrUndefined(input.effort));
  setBooleanOption(options, "fastMode", Option.getOrUndefined(input.fastMode));
  setBooleanOption(options, "thinking", Option.getOrUndefined(input.thinking));
  return [...options.values()];
}

function parseModelOptionValue(value: string): ModelOptionValue {
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return value;
}

function setStringOption(options: Map<string, ModelOption>, id: string, value: string | undefined) {
  if (value !== undefined && value.length > 0) {
    options.set(id, { id, value });
  }
}

function setBooleanOption(
  options: Map<string, ModelOption>,
  id: string,
  value: boolean | undefined,
) {
  if (value !== undefined) {
    options.set(id, { id, value });
  }
}
