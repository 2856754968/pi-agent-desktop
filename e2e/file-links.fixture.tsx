import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownBody } from "../components/MarkdownBody";
import { FileViewer } from "../components/FileViewer";
import { I18nProvider } from "../hooks/useI18n";

function Fixture() {
  const [target, setTarget] = useState<{ path: string; line?: number; revision: number }>();
  return <I18nProvider>
    <MarkdownBody cwd="D:/project" onOpenFile={(path, _page, line) => setTarget((old) => ({ path, line, revision: (old?.revision ?? 0) + 1 }))}>
      {"[Windows](D:/project/demo.ts:42) [Later](D:/project/demo.ts:150) [Plain](D:/project/demo.ts) [Markdown](D:/project/readme.md#L42)"}
    </MarkdownBody>
    <div style={{ height: 300, width: 600 }}>
      {target && <FileViewer key={target.revision} filePath={target.path} initialLine={target.line} watchEnabled={false} />}
    </div>
  </I18nProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
