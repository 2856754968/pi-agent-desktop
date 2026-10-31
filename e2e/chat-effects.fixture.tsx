import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { I18nProvider } from "../hooks/useI18n";
import { ChatEffectsSettings } from "../components/ChatEffectsSettings";
import { ChatInput } from "../components/ChatInput";
import { MessageView } from "../components/MessageView";
import { ContextUsageRing } from "../components/ContextUsageRing";

function Fixture() {
  const [messages, setMessages] = useState<{ content: string; timestamp: number }[]>([]);
  const [text, setText] = useState("Existing **Markdown**");
  const [streaming, setStreaming] = useState(true);
  return <I18nProvider><main>
    <ChatEffectsSettings />
    <div className="chat-window" style={{ position: "relative", height: 550, display: "flex", flexDirection: "column" }}>
      <div style={{ overflow: "auto", flex: 1 }} data-transcript>
        <MessageView message={{ role: "user", content: "Historical message", timestamp: 1 }} />
        {messages.map((message, i) => <MessageView key={i} message={{ role: "user", ...message }} />)}
        <div id="stream"><MessageView isStreaming={streaming} message={{ role: "assistant", provider: "fixture", model: "fixture", content: [{ type: "text", text }], timestamp: 1 }} /></div>
      </div>
      <ChatInput isStreaming={false} onSend={(value) => setMessages((items) => [...items, { content: value, timestamp: Date.now() }])} onAbort={() => {}}
        model={{ provider: "relay", modelId: "claude-sonnet-4-6" }}
        modelList={[{ id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "relay" }, { id: "gpt-6", name: "GPT 6", provider: "relay" }]}
        onModelChange={() => {}} />
    </div>
    <div id="context"><ContextUsageRing contextUsage={{ percent: 72, contextWindow: 200000, tokens: 144000 }} /></div>
    <div id="unknown-context"><ContextUsageRing contextUsage={{ percent: null, contextWindow: 200000, tokens: null }} /></div>
    <button onClick={() => setText((value) => value + " 新到的文字")}>Append stream</button>
    <button onClick={() => setStreaming(false)}>Finish stream</button>
  </main></I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
