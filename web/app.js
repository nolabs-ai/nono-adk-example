const messages = document.querySelector("#messages");
const welcome = document.querySelector("#welcome");
const form = document.querySelector("#composer");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const newChatButton = document.querySelector("#new-chat");
const agentName = document.querySelector("#agent-name");
const modelName = document.querySelector("#model-name");

let sessionId = null;
let isSending = false;

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.detail || `Request failed (${response.status})`);
  }
  return body;
}

async function createSession() {
  const body = await requestJson("/api/sessions", { method: "POST" });
  sessionId = body.session_id;
}

function scrollToLatest() {
  messages.scrollTo({ top: messages.scrollHeight, behavior: "smooth" });
}

function addMessage(role, text, state = "") {
  welcome.hidden = true;
  const row = document.createElement("div");
  row.className = `message-row ${role}`;

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = role === "user" ? "You" : "n";
  avatar.setAttribute("aria-hidden", "true");

  const bubble = document.createElement("div");
  bubble.className = `message ${state}`.trim();
  bubble.textContent = text;

  row.append(avatar, bubble);
  messages.append(row);
  scrollToLatest();
  return { row, bubble };
}

function setSending(value) {
  isSending = value;
  input.disabled = value;
  sendButton.disabled = value;
  newChatButton.disabled = value;
  form.classList.toggle("is-sending", value);
}

function resizeInput() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}

async function sendMessage(text) {
  const message = text.trim();
  if (!message || isSending) return;

  addMessage("user", message);
  input.value = "";
  resizeInput();
  setSending(true);
  const pending = addMessage("assistant", "Thinking", "pending");

  try {
    if (!sessionId) await createSession();
    const body = await requestJson("/api/chat", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, message }),
    });
    pending.bubble.classList.remove("pending");
    pending.bubble.textContent = body.reply;
  } catch (error) {
    pending.row.classList.add("error");
    pending.bubble.classList.remove("pending");
    pending.bubble.textContent = error.message;
  } finally {
    setSending(false);
    input.focus();
    scrollToLatest();
  }
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  sendMessage(input.value);
});

input.addEventListener("input", resizeInput);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => sendMessage(button.dataset.prompt));
});

newChatButton.addEventListener("click", async () => {
  if (isSending) return;
  setSending(true);
  try {
    await createSession();
    messages.querySelectorAll(".message-row").forEach((node) => node.remove());
    welcome.hidden = false;
    input.value = "";
    resizeInput();
  } catch (error) {
    addMessage("assistant", `Could not start a new chat: ${error.message}`);
  } finally {
    setSending(false);
    input.focus();
  }
});

async function initialize() {
  try {
    const [agent] = await Promise.all([
      requestJson("/api/agent"),
      createSession(),
    ]);
    agentName.textContent = agent.name.replaceAll("_", " ");
    modelName.textContent = agent.model;
  } catch (error) {
    modelName.textContent = "Offline";
    addMessage("assistant", `Could not connect to the agent: ${error.message}`);
  }
}

initialize();
