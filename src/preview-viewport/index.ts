import {
  PREVIEW_VIEWPORT_PRESETS as T3_PREVIEW_VIEWPORT_PRESETS,
  resolvePreviewViewport as resolveT3PreviewViewport,
} from "../../upstream-t3code/packages/shared/src/previewViewport.ts";

import type {
  PreviewAutomationResizeInput,
  PreviewViewportPresetId,
  PreviewViewportSetting as PreviewViewportSettingType,
} from "../contracts/index.ts";

export {
  PREVIEW_VIEWPORT_PRESET_IDS,
  PreviewViewportSetting,
  type PreviewViewportPresetId,
} from "../contracts/index.ts";

export interface PreviewViewportPreset {
  readonly id: PreviewViewportPresetId;
  readonly label: string;
  readonly category: "Desktop" | "Tablet" | "Phone";
  readonly detail: string;
  readonly width: number;
  readonly height: number;
}

export const PREVIEW_VIEWPORT_PRESETS: ReadonlyArray<PreviewViewportPreset> =
  T3_PREVIEW_VIEWPORT_PRESETS;

export function resolvePreviewViewport(
  input: PreviewAutomationResizeInput,
): PreviewViewportSettingType {
  return resolveT3PreviewViewport(input);
}
