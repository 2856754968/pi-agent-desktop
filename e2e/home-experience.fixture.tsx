import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { HomeExperienceSettings } from "../components/HomeExperienceSettings";
import { HomeUsageDashboard } from "../components/HomeUsageDashboard";
import { HomeRipple } from "../components/HomeRipple";
import { ComposerCompanion, type CompanionState } from "../components/ComposerCompanion";

function Fixture() {
  const [state, setState] = useState<CompanionState>("idle");
  const [costUsd, setCostUsd] = useState<number>();
  const [runningSubagentCount, setRunningSubagentCount] = useState(0);
  return <I18nProvider><main>
    <HomeExperienceSettings />
    <div className="home-fixture-stage chat-window" data-home-dashboard="true"><HomeRipple /><HomeUsageDashboard /></div>
    <div className="home-fixture-composer"><ComposerCompanion state={state} costUsd={costUsd} runningSubagentCount={runningSubagentCount} /><textarea aria-label="Composer" /></div>
    <button onClick={() => setCostUsd(0.01234)}>Record session cost</button>
    <div>{[0, 1, 2].map((count) => (
      <button key={count} onClick={() => setRunningSubagentCount(count)}>Running subagents: {count}</button>
    ))}</div>
    <div>{(["idle", "thinking", "working", "attention", "error", "typing", "compacting"] as const).map((value) =>
      <button key={value} onClick={() => setState(value)}>{value}</button>)}</div>
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
