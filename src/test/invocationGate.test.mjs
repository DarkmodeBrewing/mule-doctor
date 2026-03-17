import test from "node:test";
import assert from "node:assert/strict";

import { LlmInvocationGate } from "../../dist/llm/invocationGate.js";

test("LlmInvocationGate blocks overlapping requests on the same key", () => {
  const gate = new LlmInvocationGate();
  const first = gate.tryAcquire([{ key: "k1", cooldownMs: 1000 }]);
  assert.equal(first.ok, true);

  const second = gate.tryAcquire([{ key: "k1", cooldownMs: 1000 }]);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "in_flight");

  first.lease.release();
});

test("LlmInvocationGate enforces cooldown after release", async () => {
  const gate = new LlmInvocationGate();
  const first = gate.tryAcquire([{ key: "k1", cooldownMs: 50 }]);
  assert.equal(first.ok, true);
  first.lease.release();

  const second = gate.tryAcquire([{ key: "k1", cooldownMs: 50 }]);
  assert.equal(second.ok, false);
  assert.equal(second.reason, "cooldown");

  await new Promise((resolve) => setTimeout(resolve, 60));
  const third = gate.tryAcquire([{ key: "k1", cooldownMs: 50 }]);
  assert.equal(third.ok, true);
  third.lease.release();
});
