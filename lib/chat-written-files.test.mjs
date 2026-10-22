import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { extractTurnWrittenFiles } = await jiti.import("./turn-written-files.ts");

const folder = "/home/me/.pi/agent/chats/20261022-101500-ab12cd34";
const call = (toolCallId, toolName, input) => ({ type: "toolCall", toolCallId, toolName, input });
const ok = (toolCallId) => [toolCallId, { role: "toolResult", toolCallId, isError: false, content: [] }];

test("a chat's write with a relative path is listed under the chat's folder", () => {
  const content = [call("1", "write", { path: "调研报告.md", content: "# a\nb\n" }), call("2", "write", { path: "notes/x.md", content: "x" })];
  const files = extractTurnWrittenFiles(content, new Map([ok("1"), ok("2")]), folder);
  assert.deepEqual(files.map((file) => file.filePath), [`${folder}/调研报告.md`, `${folder}/notes/x.md`]);
  assert.equal(files[0].added, 2);
});

test("without the folder a relative path cannot be placed, so no card is made until it is known", () => {
  const content = [call("1", "write", { path: "report.md", content: "x" })];
  assert.deepEqual(extractTurnWrittenFiles(content, new Map([ok("1")]), undefined), []);
});

test("the chat window feeds the card the chat folder and opens a row without a preview pane", async () => {
  const window = await readFile(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");
  const message = await readFile(new URL("../components/MessageView.tsx", import.meta.url), "utf8");
  assert.match(window, /const chatFolder = chatOnly \? chatAccess\?\.state\.folder \?\? undefined : undefined/);
  assert.match(window, /const writtenFilesCwd = chatOnly \? chatFolder : messageCwd/);
  assert.match(window, /getTurnWrittenFiles\(finalAssistant,[^;]*writtenFilesCwd\)/);
  assert.match(window, /onOpenWrittenFile=\{chatFolder \? openChatFile : undefined\}/);
  // Desktop opens the file with its default app; a browser shows the folder.
  assert.match(window, /isTauriDesktop\(\)\) \{\s*void openPathNative\(filePath\)/);
  // The rest of a chat's links stay off: only the card gets a handler.
  assert.match(window, /const openFile = chatOnly \? undefined : onOpenFile/);
  assert.match(message, /<TurnWrittenFiles files=\{writtenFiles\} onOpenFile=\{onOpenWrittenFile \?\? onOpenFile\} \/>/);
});
