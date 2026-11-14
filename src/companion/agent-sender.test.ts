import "vite-plus/test/config";

import { assert, describe, it } from "@effect/vitest";

import { responseJson } from "./agent-sender.ts";

describe("responseJson", () => {
  it("reads a plain JSON reply as is", () => {
    assert.equal(responseJson("application/json", '{"result":{}}'), '{"result":{}}');
  });

  it("takes the last data line of an event-stream reply", () => {
    const body = 'event: message\ndata: {"id":1}\n\nevent: message\ndata: {"id":2,"result":{}}\n\n';
    assert.equal(responseJson("text/event-stream", body), '{"id":2,"result":{}}');
  });
});
