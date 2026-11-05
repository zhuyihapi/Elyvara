import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientMessage } from "../dist/packages/protocol/src/index.js";

const fixtures = JSON.parse(readFileSync(new URL("../packages/protocol/fixtures/v1.json", import.meta.url), "utf8"));
test("TypeScript accepts the shared v1 protocol fixtures", () => {
  for (const { valid, message } of fixtures) {
    assert.equal(clientMessage.safeParse(message).success, valid, JSON.stringify(message));
  }
});
