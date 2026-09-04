import { localAssistant } from "./agent.js";
import type { CoreMessage } from "@mastra/core/llm";

type Session = {
  messages: CoreMessage[];
  queue: Promise<void>;
};

export class ChatSessions {
  private readonly sessions = new Map<string, Session>();

  create(): string {
    const id = crypto.randomUUID();
    this.ensure(id);
    return id;
  }

  async respond(id: string, text: string): Promise<string> {
    const session = this.ensure(id);
    let resolveReply!: (reply: string) => void;
    let rejectReply!: (error: unknown) => void;
    const reply = new Promise<string>((resolve, reject) => {
      resolveReply = resolve;
      rejectReply = reject;
    });

    const run = session.queue.then(async () => {
      try {
        const messages: CoreMessage[] = [...session.messages, { role: "user", content: text }];
        const result = await localAssistant.generate(messages);
        const response = result.text.trim();
        if (!response) throw new Error("The agent completed without a text response");
        session.messages.push({ role: "user", content: text }, { role: "assistant", content: response });
        resolveReply(response);
      } catch (error) {
        rejectReply(error);
      }
    });
    session.queue = run.catch(() => undefined);
    return reply;
  }

  private ensure(id: string): Session {
    let session = this.sessions.get(id);
    if (!session) {
      session = { messages: [], queue: Promise.resolve() };
      this.sessions.set(id, session);
    }
    return session;
  }
}
