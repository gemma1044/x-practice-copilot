import { createBridgeServer } from "./app.js";

const host = "127.0.0.1";
const port = Number(process.env.XPC_BRIDGE_PORT || 4317);
const server = createBridgeServer({
  apiKey: process.env.OPENAI_API_KEY,
  baseUrl: process.env.OPENAI_BASE_URL,
  model: "deepseek_v4_flash",
  extensionId: process.env.XPC_EXTENSION_ID
});

server.listen(port, host, () => {
  const configured = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_BASE_URL && process.env.XPC_EXTENSION_ID);
  console.log(`X Practice Copilot bridge: http://${host}:${port} · ${configured ? "configured" : "not configured"}`);
});
