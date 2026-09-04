import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

type ToolError = {
  status: "error";
  error: string;
  errno?: string;
  sandbox?: "nono";
  message_for_user?: string;
  detail?: string;
};

function inNonoSandbox(): boolean {
  return Boolean(process.env.NONO_CAP_FILE);
}

function permissionDenied(requestedPath: string, resolvedPath: string, error: NodeJS.ErrnoException): ToolError {
  const result: ToolError = {
    status: "error",
    error: `Permission denied: ${JSON.stringify(requestedPath)}`,
  };
  if (error.code) result.errno = error.code;
  if (inNonoSandbox()) {
    result.sandbox = "nono";
    result.message_for_user =
      `Access to ${JSON.stringify(resolvedPath)} is blocked by corporate policy. ` +
      "If you believe this access should be allowed, please submit an access request.";
  }
  return result;
}

function networkDenied(url: string, detail: string): ToolError {
  return {
    status: "error",
    error: `Network access denied for ${JSON.stringify(url)}`,
    sandbox: "nono",
    message_for_user:
      `Access to ${JSON.stringify(url)} is blocked by corporate policy. ` +
      "If you believe this access should be allowed, please submit an access request.",
    detail,
  };
}

function isNonoNetworkDenial(detail: string): boolean {
  const normalized = detail.toLowerCase();
  return ["is in the deny list", "is not in the allowlist", "is in the link-local range"].some(
    (marker) => normalized.includes(marker),
  ) || normalized.includes("proxy response (403)");
}

function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = "cause" in error ? (error as Error & { cause?: unknown }).cause : undefined;
  return cause ? `${error.message}; caused by: ${describeError(cause)}` : error.message;
}

export const getCurrentTime = createTool({
  id: "get-current-time",
  description: "Return the current date and time for an IANA timezone.",
  inputSchema: z.object({
    timezone: z
      .string()
      .default("UTC")
      .describe("An IANA timezone name such as UTC, Europe/London, or America/New_York"),
  }),
  execute: async ({ timezone }) => {
    try {
      const formatter = new Intl.DateTimeFormat("en-GB", {
        dateStyle: "full",
        timeStyle: "long",
        timeZone: timezone,
      });
      const now = new Date();
      return {
        status: "ok" as const,
        timezone,
        datetime: now.toISOString(),
        human_readable: formatter.format(now),
      };
    } catch {
      return {
        status: "error" as const,
        error: `Unknown timezone: ${JSON.stringify(timezone)}. Use an IANA name like 'Europe/London'.`,
      };
    }
  },
});

class ArithmeticParser {
  private position = 0;

  constructor(private readonly input: string) {}

  parse(): number {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (this.position !== this.input.length || !Number.isFinite(value)) {
      throw new Error("Unsupported expression");
    }
    return value;
  }

  private parseExpression(): number {
    let value = this.parseTerm();
    while (true) {
      if (this.consume("+")) value += this.parseTerm();
      else if (this.consume("-")) value -= this.parseTerm();
      else return value;
    }
  }

  private parseTerm(): number {
    let value = this.parseUnary();
    while (true) {
      if (this.consume("//")) value = Math.floor(value / this.parseUnary());
      else if (this.consume("*", "**")) value *= this.parseUnary();
      else if (this.consume("/")) value /= this.parseUnary();
      else if (this.consume("%")) value %= this.parseUnary();
      else return value;
    }
  }

  private parseUnary(): number {
    if (this.consume("+")) return this.parseUnary();
    if (this.consume("-")) return -this.parseUnary();
    return this.parsePower();
  }

  private parsePower(): number {
    const base = this.parsePrimary();
    return this.consume("**") ? base ** this.parseUnary() : base;
  }

  private parsePrimary(): number {
    if (this.consume("(")) {
      const value = this.parseExpression();
      if (!this.consume(")")) throw new Error("Missing closing parenthesis");
      return value;
    }
    this.skipWhitespace();
    const match = this.input.slice(this.position).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new Error("Expected a number");
    this.position += match[0].length;
    return Number(match[0]);
  }

  private consume(token: string, excludedPrefix?: string): boolean {
    this.skipWhitespace();
    if (excludedPrefix && this.input.startsWith(excludedPrefix, this.position)) return false;
    if (!this.input.startsWith(token, this.position)) return false;
    this.position += token.length;
    return true;
  }

  private skipWhitespace(): void {
    while (/\s/.test(this.input[this.position] ?? "")) this.position += 1;
  }
}

export function evaluateArithmetic(expression: string): number {
  if (expression.length > 1_000) throw new Error("Expression is too long");
  return new ArithmeticParser(expression).parse();
}

export const calculate = createTool({
  id: "calculate",
  description: "Safely evaluate basic arithmetic using + - * / // % ** and parentheses.",
  inputSchema: z.object({
    expression: z.string().describe("A basic arithmetic expression such as (3 ** 4) / 9"),
  }),
  execute: async ({ expression }) => {
    try {
      return { status: "ok" as const, expression, result: evaluateArithmetic(expression) };
    } catch {
      return {
        status: "error" as const,
        error: `Could not evaluate ${JSON.stringify(expression)}. Use numbers and + - * / // % ** ( ).`,
      };
    }
  },
});

function expandHome(requestedPath: string): string {
  if (requestedPath === "~") return os.homedir();
  if (requestedPath.startsWith(`~${path.sep}`)) return path.join(os.homedir(), requestedPath.slice(2));
  return requestedPath;
}

export async function listFolderContents(requestedPath = ".") {
  const expanded = expandHome(requestedPath);
  const resolved = path.resolve(expanded);
  try {
    const info = await fs.stat(expanded);
    if (!info.isDirectory()) {
      return { status: "error" as const, error: `Not a directory: ${JSON.stringify(requestedPath)}` };
    }
    const directoryEntries = await fs.readdir(expanded, { withFileTypes: true });
    const entries = await Promise.all(
      directoryEntries.map(async (entry) => {
        let sizeBytes: number | null = null;
        if (entry.isFile()) {
          try {
            sizeBytes = (await fs.stat(path.join(expanded, entry.name))).size;
          } catch {
            sizeBytes = null;
          }
        }
        return {
          name: entry.name,
          type: entry.isDirectory() ? ("dir" as const) : ("file" as const),
          size_bytes: sizeBytes,
        };
      }),
    );
    entries.sort((left, right) => {
      if (left.type !== right.type) return left.type === "dir" ? -1 : 1;
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
    return { status: "ok" as const, path: resolved, count: entries.length, entries };
  } catch (error) {
    const fileError = error as NodeJS.ErrnoException;
    if (fileError.code === "ENOENT") {
      return { status: "error" as const, error: `Path does not exist: ${JSON.stringify(requestedPath)}` };
    }
    if (fileError.code === "EACCES" || fileError.code === "EPERM") {
      return permissionDenied(requestedPath, resolved, fileError);
    }
    return {
      status: "error" as const,
      error: `Could not access ${JSON.stringify(requestedPath)}: ${fileError.message}`,
    };
  }
}

export const listFolder = createTool({
  id: "list-folder",
  description: "List the files and subfolders in a local directory.",
  inputSchema: z.object({
    path: z.string().default(".").describe("A directory path; ~ expands to the user's home directory"),
  }),
  execute: async ({ path: requestedPath }) => listFolderContents(requestedPath),
});

async function readLimitedBody(response: Response, limit: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  try {
    while (received <= limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const remaining = limit + 1 - received;
      chunks.push(value.subarray(0, remaining));
      received += value.length;
      if (received > limit) {
        truncated = true;
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const combined = new Uint8Array(Math.min(received, limit));
  let offset = 0;
  for (const chunk of chunks) {
    const part = chunk.subarray(0, combined.length - offset);
    combined.set(part, offset);
    offset += part.length;
    if (offset === combined.length) break;
  }
  return { text: new TextDecoder("utf-8").decode(combined), truncated };
}

export async function fetchUrlContent(rawUrl: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { status: "error" as const, error: "Use an absolute http:// or https:// URL." };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { status: "error" as const, error: "Use an absolute http:// or https:// URL." };
  }
  if (url.username || url.password) {
    return { status: "error" as const, error: "URLs containing credentials are not accepted." };
  }

  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "mastrademo/0.1" },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await readLimitedBody(response, 4_096);
    const detail = `HTTP ${response.status}: ${response.statusText}; ${body.text}`;
    if (inNonoSandbox() && response.status === 403 && isNonoNetworkDenial(detail)) {
      return networkDenied(rawUrl, detail.trim());
    }
    if (!response.ok) {
      return { status: "error" as const, error: `HTTP ${response.status}: ${response.statusText}` };
    }
    return {
      status: "ok" as const,
      url: response.url,
      http_status: response.status,
      content_type: response.headers.get("content-type")?.split(";", 1)[0] || "application/octet-stream",
      body: body.text,
      truncated: body.truncated,
    };
  } catch (error) {
    const detail = describeError(error);
    if (inNonoSandbox() && isNonoNetworkDenial(detail)) return networkDenied(rawUrl, detail);
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return { status: "error" as const, error: "Request timed out after 10 seconds." };
    }
    return { status: "error" as const, error: `Request failed: ${detail}` };
  }
}

export const fetchUrl = createTool({
  id: "fetch-url",
  description: "Fetch the first 4 KiB of a public HTTP or HTTPS URL.",
  inputSchema: z.object({
    url: z.url().describe("An absolute HTTP or HTTPS URL"),
  }),
  execute: async ({ url }) => fetchUrlContent(url),
});
