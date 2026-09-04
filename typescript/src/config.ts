import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import dotenv from "dotenv";

const packageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(packageDirectory, ".env"), quiet: true });

export const supportedProviders = ["gemini", "openai", "anthropic"] as const;
export type AgentProvider = (typeof supportedProviders)[number];

const defaultModels: Record<AgentProvider, string> = {
  gemini: "gemini-2.5-flash",
  openai: "gpt-5.4-mini",
  anthropic: "claude-sonnet-5",
};

const providerKeyVariables: Record<AgentProvider, readonly string[]> = {
  // nono v0.72 used GOOGLE_API_KEY; current releases also expose the names
  // expected by Google's JavaScript SDKs. Accept all three for compatibility.
  gemini: ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_API_KEY"],
};

function readProvider(): AgentProvider {
  const configured = (process.env.AGENT_PROVIDER || "gemini").trim().toLowerCase();
  const provider = configured === "google" ? "gemini" : configured;
  if (!supportedProviders.includes(provider as AgentProvider)) {
    throw new Error(
      `Unsupported AGENT_PROVIDER ${JSON.stringify(provider)}; use ${supportedProviders.join(", ")}.`,
    );
  }
  return provider as AgentProvider;
}

export const agentProvider = readProvider();
export const agentModel = process.env.AGENT_MODEL?.trim() || defaultModels[agentProvider];
export const apiKeyEnvironmentVariables = providerKeyVariables[agentProvider];

export function providerApiKeyIsAvailable(): boolean {
  return apiKeyEnvironmentVariables.some((name) => Boolean(process.env[name]));
}

function requireApiKey(): string {
  const apiKey = apiKeyEnvironmentVariables
    .map((name) => process.env[name])
    .find((value): value is string => Boolean(value));
  if (!apiKey) {
    throw new Error(
      `No ${apiKeyEnvironmentVariables.join(" or ")} found for provider ${JSON.stringify(agentProvider)}. ` +
        `Launch nono with --credential ${agentProvider}; nono will inject a phantom value.`,
    );
  }
  return apiKey;
}

export function createModel() {
  const apiKey = requireApiKey();
  switch (agentProvider) {
    case "gemini":
      return createGoogleGenerativeAI({ apiKey })(agentModel);
    case "openai":
      return createOpenAI({ apiKey })(agentModel);
    case "anthropic":
      return createAnthropic({ apiKey })(agentModel);
  }
}
