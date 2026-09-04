import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { agentModel, agentProvider } from "./config.js";
import { ChatSessions } from "./chat.js";

const sessions = new ChatSessions();
const sessionId = sessions.create();
const terminal = createInterface({ input: stdin, output: stdout });

console.log(`Chatting with 'local_assistant' (provider: ${agentProvider}, model: ${agentModel}).`);
console.log("Type your message. Use 'exit' or Ctrl-D to quit.\n");

try {
  while (true) {
    const message = (await terminal.question("you> ")).trim();
    if (["exit", "quit"].includes(message.toLowerCase())) break;
    if (!message) continue;
    const reply = await sessions.respond(sessionId, message);
    console.log(`\nassistant> ${reply}\n`);
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ERR_USE_AFTER_CLOSE") throw error;
} finally {
  terminal.close();
}
