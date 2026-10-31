"use client";
import { useI18n } from "@/hooks/useI18n";
import { setChatEffect, useChatEffect, type ChatEffectKey } from "@/hooks/useChatEffects";
import { AppSelect } from "./AppSelect";
import { ConfigSwitch } from "./SettingsUi";

function Toggle({ effect }: { effect: "caretMotion" | "streamReveal" | "contextPercent" }) {
  const { t } = useI18n();
  const value = useChatEffect(effect);
  return <div className="settings-option">
    <span className="settings-option-text"><span className="settings-option-title">{t("effects." + effect)}</span>
      <span className="settings-option-hint">{t("effects." + effect + "Hint")}</span></span>
    <ConfigSwitch label={t("effects." + effect)} checked={value === "on"}
      onChange={(enabled) => setChatEffect(effect, enabled ? "on" : "off")} />
  </div>;
}
function Choice({ effect, values }: { effect: Extract<ChatEffectKey, "messageMotion" | "contextDisplay">; values: string[] }) {
  const { t } = useI18n();
  const value = useChatEffect(effect);
  return <div className="settings-option">
    <span className="settings-option-text"><span className="settings-option-title">{t("effects." + effect)}</span>
      <span className="settings-option-hint">{t("effects." + effect + "Hint")}</span></span>
    <AppSelect aria-label={t("effects." + effect)} value={value}
      options={values.map((item) => ({ value: item, label: t("effects." + item) }))}
      onValueChange={(next) => setChatEffect(effect, next as typeof value)} />
  </div>;
}
export function ChatEffectsSettings() {
  const { t } = useI18n();
  return <section className="settings-general-section chat-effects-settings">
    <h3 className="settings-general-heading">{t("effects.title")}</h3>
    <p className="settings-general-description">{t("effects.motionHint")}</p>
    <div className="settings-option-list">
      <Toggle effect="caretMotion" /><Toggle effect="streamReveal" />
      <Choice effect="messageMotion" values={["flight", "grow", "off"]} />
      <Choice effect="contextDisplay" values={["pie", "ramp", "band"]} />
      <Toggle effect="contextPercent" />
    </div>
  </section>;
}
