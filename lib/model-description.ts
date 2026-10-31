import descriptions from "./model-description-data.json";
// Family copy adapted from Nwflower/dsh-claude-style; see public/THIRD_PARTY_NOTICES.txt.
const rules = descriptions.map((rule) => ({ ...rule, pattern: new RegExp(rule.match, "i") }));
export function modelDescription(modelId: string, name: string, locale: string): string | null {
  const rule = rules.find((item) => item.pattern.test(modelId)) ?? rules.find((item) => item.pattern.test(name));
  return rule ? rule.text[locale.startsWith("zh") ? "zh" : "en"] : null;
}
