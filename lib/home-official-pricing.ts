/** USD per million tokens, verified against vendor Standard API rate cards.
 * This is a current-list-price equivalent, never the user's actual invoice.
 * No runtime fetches, models.json overrides, or provider-reported usage.cost.
 */
export const HOME_PRICING_CHECKED = "2026-10-31";
export const HOME_PRICING_SOURCES = [
  { name: "OpenAI", url: "https://developers.openai.com/api/docs/pricing" },
  { name: "Anthropic", url: "https://platform.claude.com/docs/en/about-claude/pricing" },
  { name: "DeepSeek", url: "https://api-docs.deepseek.com/quick_start/pricing" },
  { name: "Google", url: "https://ai.google.dev/gemini-api/docs/pricing" },
  { name: "xAI", url: "https://docs.x.ai/developers/models" },
];
export type HomeTokenUsage = { input: number; output: number; cacheRead: number; cacheWrite: number };
type Rates = { input: number; output: number; cacheRead: number; cacheWrite?: number };
type Price = Rates & { above?: number; long?: Rates };
const prices = new Map<string, Price>();
function add(ids: string[], rates: Price) { for (const id of ids) prices.set(id, rates); }
function openai(ids: string[], input: number, output: number, cacheRead: number) {
  const cacheWrite = input * 1.25; // Standard 30m retention; 12h retention is not recorded.
  add(ids, { input, output, cacheRead, cacheWrite, above: 272000,
    long: { input: input * 2, output: output * 1.5, cacheRead: cacheRead * 2, cacheWrite: cacheWrite * 2 } });
}
openai(["gpt-6.1-sol"], 2, 10, .1);
openai(["gpt-6.1-terra"], 1, 5, .05);
openai(["gpt-6-astra"], 10, 50, 1);
openai(["gpt-6-sol"], 2, 10, .2);
openai(["gpt-6-luna"], .1, .5, .01);
openai(["gpt-5.6-sol", "gpt-5.6"], 4, 20, .4);
openai(["gpt-5.6-terra"], 2, 12, .2);
openai(["gpt-5.6-luna"], .2, 1.2, .02);
add(["gpt-5.5"], { input: 5, output: 30, cacheRead: .5, above: 272000, long: { input: 10, output: 45, cacheRead: 1 } });
add(["gpt-5.4"], { input: 2.5, output: 15, cacheRead: .25, above: 272000, long: { input: 5, output: 22.5, cacheRead: .5 } });
// Anthropic Standard global pricing, 5m cache writes (1h retention is not recorded).
function claude(ids: string[], input: number, output: number, cacheRead: number) {
  add(ids, { input, output, cacheRead, cacheWrite: input * 1.25 });
}
claude(["claude-fable-5-1", "claude-mythos-5-1"], 10, 50, .25);
claude(["claude-fable-5", "claude-mythos-5"], 10, 50, 1);
claude(["claude-opus-5-5"], 4, 20, .2);
claude(["claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-opus-4-5"], 5, 25, .5);
claude(["claude-opus-4-1", "claude-opus-4"], 15, 75, 1.5);
claude(["claude-sonnet-5-5"], 2, 10, .1);
claude(["claude-sonnet-5"], 2, 10, .2);
claude(["claude-sonnet-4-6", "claude-sonnet-4-5", "claude-sonnet-4"], 3, 15, .3);
claude(["claude-haiku-4-5"], 1, 5, .1);
claude(["claude-haiku-3-5"], .8, 4, .08);
add(["claude-haiku-5-5"], { input: .1, output: .5, cacheRead: .01, cacheWrite: .125, above: 100000,
  long: { input: .5, output: 2.5, cacheRead: .05, cacheWrite: .625 } });
// DeepSeek peak list rates, not a reconstruction of holiday/off-peak billing.
add(["deepseek-flash", "deepseek-v4-flash", "deepseek-v4.1-flash", "deepseek-v4.1-flash-1017", "deepseek-v4-flash-vision-exp"], { input: .3, output: 1.2, cacheRead: .006 });
add(["deepseek-v4-pro", "deepseek-v4-pro-0813"], { input: 1.32, output: 3.96, cacheRead: .044 });
add(["gemini-3.1-pro-preview", "gemini-3.1-pro-preview-customtools"], { input: 2, output: 12, cacheRead: .2, above: 200000,
  long: { input: 4, output: 18, cacheRead: .4 } });
// xAI's higher tier begins AT 200k (rather than strictly above it).
add(["grok-4.6"], { input: 2, output: 6, cacheRead: .5, above: 199999, long: { input: 4, output: 12, cacheRead: 1 } });
add(["grok-4.5"], { input: 2, output: 6, cacheRead: .3, above: 199999, long: { input: 4, output: 12, cacheRead: .6 } });

export function estimateHomeUsageUsd(model: string | undefined, usage: HomeTokenUsage): number | null {
  if (Object.values(usage).some((value) => !Number.isFinite(value) || value < 0)) return null;
  if (Object.values(usage).every((value) => value === 0)) return 0;
  // Exact model IDs only; a relay path may prefix them. Never match a family
  // substring (e.g. auto routes, free tiers, or similarly named future models).
  const id = (model?.split("/").at(-1) ?? "").toLowerCase();
  const normalized = id.replace(/-\d{8}$/, "").replace(/^(claude-.+)-thinking$/, "$1");
  const price = prices.get(id) ?? prices.get(normalized);
  if (!price) return null;
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
  const rates = price.above !== undefined && prompt > price.above ? (price.long ?? price) : price;
  if (usage.cacheWrite > 0 && rates.cacheWrite === undefined) return null;
  const cost = (usage.input * rates.input + usage.output * rates.output
    + usage.cacheRead * rates.cacheRead + usage.cacheWrite * (rates.cacheWrite ?? 0)) / 1e6;
  return Number.isFinite(cost) ? cost : null;
}
