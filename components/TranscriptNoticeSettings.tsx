"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { NOTICE_SETTING_KEYS, type NoticeSettingKey, type NoticeSettings } from "@/lib/transcript-notices";
import { ConfigSwitch } from "./SettingsUi";

async function requestNotices(init?: RequestInit): Promise<NoticeSettings> {
  const response = await fetch("/api/notices", init);
  const data = await response.json() as { notices?: NoticeSettings; error?: string };
  if (!response.ok || !data.notices) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data.notices;
}

export function TranscriptNoticeSettings({ onSaved }: { onSaved: () => void }) {
  const { t } = useI18n();
  const [notices, setNotices] = useState<NoticeSettings | null>(null);
  const [saving, setSaving] = useState<NoticeSettingKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void requestNotices({ signal: controller.signal })
      .then(setNotices)
      .catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, []);

  async function toggleNotice(key: NoticeSettingKey, shown: boolean) {
    setSaving(key);
    setError(null);
    try {
      setNotices(await requestNotices({
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, shown }),
      }));
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(null);
    }
  }

  return (
    <section className="settings-general-section">
      <h3 className="settings-general-heading">{t("settings.notices")}</h3>
      <div className="settings-chat-options">
        {NOTICE_SETTING_KEYS.map((key) => (
          <div key={key} className="settings-chat-option settings-chat-switch-option">
            <span>{t(`settings.notice.${key}`)}</span>
            <ConfigSwitch
              checked={notices?.[key] === true}
              loading={(notices === null && error === null) || saving === key}
              disabled={notices === null || saving !== null}
              label={t(`settings.notice.${key}`)}
              describedBy="settings-notices-description"
              onChange={(shown) => void toggleNotice(key, shown)}
            />
          </div>
        ))}
      </div>
      <p id="settings-notices-description" className="settings-general-description">{t("settings.noticesDescription")}</p>
      {error && <p role="alert" className="settings-general-error">{error}</p>}
    </section>
  );
}
