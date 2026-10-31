import assert from "node:assert/strict";
import test from "node:test";
import { estimateHomeUsageUsd as price } from "./home-official-pricing.ts";
import { projectHomeUsage, summarizeHomeUsage } from "./home-usage.ts";
const usage = (extra = {}) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, ...extra });
test("official rates split input, output, cache read and write rather than pricing total tokens", () => {
  assert.equal(price("relay/claude-opus-5-5", usage({ input: 1000, output: 1000, cacheRead: 1000, cacheWrite: 1000 })), .0292);
  assert.equal(price("relay/claude-opus-5-thinking", usage({ input: 1000, output: 1000 })), .03);
  assert.equal(price("relay/gpt-6.1-sol", usage({ cacheRead: 1e6 })), .2, "long prompt doubles cache rate");
  assert.equal(price("deepseek/deepseek-flash", usage({ input: 1000, output: 1000, cacheRead: 1000 })), .001506);
});
test("long context boundaries apply to whole request including cached prompt", () => {
  assert.equal(price("gpt-6.1-sol", usage({ input: 272000, output: 1000 })), .554);
  assert.equal(price("gpt-6.1-sol", usage({ input: 272000, cacheRead: 1000, output: 1000 })), 1.1032);
  assert.equal(price("grok-4.6", usage({ input: 200000 })), .8);
  assert.equal(price("gemini-3.1-pro-preview", usage({ input: 200000 })), .4);
});
test("unknown routes and unsupported buckets cannot silently become free or borrow family prices", () => {
  for (const id of ["gpt-6.1-sol-free", "auto-deepseek-v4-1-flash", "[free]GLM-5.3", "claude-opus-5-unknown", undefined]) {
    assert.equal(price(id, usage({ input: 1 })), null);
  }
  assert.equal(price("deepseek-flash", usage({ cacheWrite: 1 })), null);
  assert.equal(price("unknown", usage()), 0);
  assert.equal(price("gpt-6.1-sol", usage({ input: -1 })), null);
});
test("summary deduplicates costs, follows date range, excludes unpriced records and ignores stored costs", () => {
  const record = (id, model, timestamp = "2026-10-30T01:00:00Z") => projectHomeUsage({ type: "message", id, timestamp,
    message: { role: "assistant", model, provider: "relay", usage: { input: 1000, output: 1000, cost: { total: 99999 } } } }, id);
  const a = record("a", "claude-opus-5-5"), b = record("b", "mystery");
  const result = summarizeHomeUsage([a, a, b, record("old", "gpt-6.1-sol", "2026-01-01T00:00:00Z")], [], "7", new Date("2026-10-31"));
  assert.equal(result.costUsd, .024);
  assert.equal(result.tokens, 4000);
  assert.equal(result.unpricedRecords, 1);
  assert.equal(result.unpricedTokens, 2000);
  assert.equal(result.models.find((m) => m.name === "relay/mystery").costUsd, null);
  assert.equal(summarizeHomeUsage([b], [], "all", new Date("2026-10-31")).costUsd, null);
  assert.equal(summarizeHomeUsage([], [], "all").costUsd, 0);
});
