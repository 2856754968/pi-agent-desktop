import { existsSync } from "node:fs";
import { NextResponse } from "next/server";
import { getGlobalSettingsPath, readGlobalSettings, updateGlobalSettings } from "@/lib/global-settings-file";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { DEFAULT_NOTICE_SETTINGS, isNoticeSettingKey, type NoticeSettings } from "@/lib/transcript-notices";
import { migrateNoticeSettings, noticeSettingsOf } from "@/lib/transcript-notices-server";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function readNotices(): Promise<NoticeSettings> {
  return readGlobalSettings(getGlobalSettingsPath(), (settings) => ({ ...DEFAULT_NOTICE_SETTINGS, ...noticeSettingsOf(settings) }));
}

function errorResponse(error: unknown) {
  return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
}

export async function GET() {
  try {
    return NextResponse.json({ notices: await readNotices() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { key, shown } = isRecord(body) ? body : {};
  if (!isNoticeSettingKey(key)) {
    return NextResponse.json({ error: "key must be one of pi's notices settings" }, { status: 400 });
  }
  if (typeof shown !== "boolean") {
    return NextResponse.json({ error: "shown must be a boolean" }, { status: 400 });
  }
  try {
    const settingsPath = getGlobalSettingsPath();
    if (!shown && !existsSync(settingsPath)) return NextResponse.json({ notices: DEFAULT_NOTICE_SETTINGS });
    const notices = await updateGlobalSettings(settingsPath, (settings) => {
      migrateNoticeSettings(settings);
      settings.notices = { ...(isRecord(settings.notices) ? settings.notices : {}), [key]: shown };
      return { ...DEFAULT_NOTICE_SETTINGS, ...noticeSettingsOf(settings) };
    });
    return NextResponse.json({ notices });
  } catch (error) {
    return errorResponse(error);
  }
}
