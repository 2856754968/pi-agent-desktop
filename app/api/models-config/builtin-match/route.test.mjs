import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET } = await jiti.import("./route.ts");

async function match(baseUrl, modelId = "") {
  const params = new URLSearchParams({ baseUrl, modelId });
  const response = await GET(new Request(`http://localhost/api/models-config/builtin-match?${params}`));
  assert.equal(response.status, 200);
  return response.json();
}

test("Aliyun Token Plan's current and previous endpoints both match GLM-5.3", async () => {
  const current = await match("https://token-plan.maas.qianwenaiapi.com/compatible-mode/v1", "glm-5.3");
  const previous = await match("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/", "glm-5.3");
  assert.deepEqual(previous.providers.map((provider) => provider.id), ["qwen-token-plan-cn"]);
  assert.ok(current.providers.some((p) => p.id === "qwen-token-plan-cn"));
  assert.deepEqual(previous.model, {
    ...current.model,
    providers: current.model?.providers.filter((provider) => provider.id === "qwen-token-plan-cn"),
  });
  assert.ok(current.model, "glm-5.3 is in the built-in catalog");
  assert.equal(current.model.reasoning, true);
  assert.equal(current.model.thinkingLevelMap.medium, null);
  assert.equal(current.model.thinkingLevelMap.max, "max");
  assert.equal(current.model.compat.thinkingFormat, "qwen");
});

test("An unknown model at a built-in endpoint still names the provider", async () => {
  const result = await match("https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "not-a-real-model");
  assert.ok(result.providers.length > 0);
  assert.equal(result.model, null);
});

test("An endpoint pi does not ship matches nothing", async () => {
  assert.deepEqual(await match("https://example.test/v1", "glm-5.3"), { providers: [], model: null });
  assert.deepEqual(await match("https://token-plan.cn-beijing.maas.aliyuncs.com/v1", "glm-5.3"), { providers: [], model: null });
  assert.deepEqual(await match("not a url", "glm-5.3"), { providers: [], model: null });
});
