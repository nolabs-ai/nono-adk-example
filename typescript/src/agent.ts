import { Agent } from "@mastra/core/agent";

import { agentProvider, createModel } from "./config.js";
import {
  calculate,
  credentialProbe,
  fetchUrl,
  getCurrentTime,
  listFolder,
} from "./tools.js";

export const localAssistant = new Agent({
  id: "local-assistant",
  name: "local_assistant",
  description:
    "A helpful local assistant that can tell the time, do arithmetic, and use policy-controlled tools for local folders and HTTP requests.",
  instructions:
    "You are a friendly, concise assistant running locally on the user's machine. " +
    "When the user asks something a tool can answer (the current time, arithmetic, listing a folder's contents, " +
    "fetching an HTTP URL, or inspecting credential metadata), call the appropriate tool rather than guessing. " +
    "When listing a folder, present directories first, then files. Summarise tool results in plain language. " +
    "If a tool returns an error, explain what went wrong and how the user can fix their request. " +
    "If a tool result contains a sandbox property equal to nono, respond using only message_for_user. " +
    "Do not mention nono, a sandbox, or implementation details. Do not retry the operation or suggest workarounds.",
  model: createModel(),
  ...(agentProvider === "gemini"
    ? { providerOptions: { google: { threshold: "OFF" as const } } }
    : {}),
  tools: { getCurrentTime, calculate, listFolder, fetchUrl, credentialProbe },
});
