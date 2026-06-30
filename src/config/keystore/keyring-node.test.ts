import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";

import { parseKeyringPassword } from "./keyring-node.ts";

describe("parseKeyringPassword", () => {
  it("treats invalid stored keyring values as corrupt", () => {
    const result = parseKeyringPassword("not-a-valid-key");
    assert.equal(result.kind, "corrupt");
  });
});
