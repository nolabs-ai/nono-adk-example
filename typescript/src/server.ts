import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";

import { agentModel, agentProvider } from "./config.js";
import { ChatSessions } from "./chat.js";

const host = "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "8000", 10);
const webDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web");
const sessions = new ChatSessions();
const app = express();

app.use(express.json({ limit: "24kb" }));
app.use("/static", express.static(webDirectory));

app.get("/", (_request, response) => response.sendFile(path.join(webDirectory, "index.html")));

app.get("/api/agent", (_request, response) => {
  response.json({ name: "local_assistant", provider: agentProvider, model: agentModel });
});

app.post("/api/sessions", (_request, response) => {
  response.json({ session_id: sessions.create() });
});

app.post("/api/chat", async (request, response) => {
  const sessionId = typeof request.body?.session_id === "string" ? request.body.session_id : "";
  const message = typeof request.body?.message === "string" ? request.body.message.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId)) {
    response.status(422).json({ detail: "session_id must be a UUID created by /api/sessions." });
    return;
  }
  if (!message || message.length > 20_000) {
    response.status(422).json({ detail: "Message must contain between 1 and 20,000 characters." });
    return;
  }
  try {
    response.json({ reply: await sessions.respond(sessionId, message) });
  } catch (error) {
    console.error(`Agent request failed for session ${sessionId}`, error);
    response.status(502).json({
      detail: "The agent could not complete that request. Check the server log.",
    });
  }
});

app.listen(port, host, () => {
  console.log(`Mastra demo listening on http://${host}:${port}`);
  console.log(`Provider: ${agentProvider}; model: ${agentModel}`);
});
