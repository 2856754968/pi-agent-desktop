import { createRoot } from "react-dom/client";
import { MessageView } from "../components/MessageView";
import { I18nProvider } from "../hooks/useI18n";
import { copyText } from "../lib/clipboard";

const content = "完整消息 full message\nSecond paragraph, not just a selection.";
function Fixture() {
  return <I18nProvider>
    <div id="assistant"><MessageView message={{ role: "assistant", content: [{ type: "text", text: content + '\n\n```js\nconst whole = "完整代码";\nconsole.log(whole);\n```' }], model: "test", provider: "test", stopReason: "stop", timestamp: 0 }} /></div>
    <div id="user"><MessageView message={{ role: "user", content }} /></div>
    <p id="selected">Only selected text</p>
    <input id="input" defaultValue="input selection" />
    <button id="direct" onClick={() => void copyText(content)}>Copy explicit text</button>
    <dialog id="modal"><input defaultValue="modal selection" /><button id="modal-copy" onClick={() => void copyText(content)}>Copy modal text</button></dialog>
  </I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
