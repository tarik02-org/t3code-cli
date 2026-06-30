import "vite-plus/test/config";

import { describe, it } from "@effect/vitest";
import { expect } from "vite-plus/test";

import { shouldUseFileKeystoreForRead } from "./service.ts";

describe("shouldUseFileKeystoreForRead", () => {
  it("treats unavailable keyring reads as file-keystore fallback", () => {
    const result = { kind: "unavailable" as const, message: "failed" };
    expect(shouldUseFileKeystoreForRead(result)).toBe(true);
  });

  it("does not fall back for corrupt keyring reads", () => {
    const result = { kind: "corrupt" as const, message: "invalid key" };
    expect(shouldUseFileKeystoreForRead(result)).toBe(false);
  });
});
