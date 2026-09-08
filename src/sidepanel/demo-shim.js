(() => {
  const isDemo = new URLSearchParams(location.search).get("demo") === "1";
  if (!isDemo) return;

  const listeners = new Set();
  const prefix = "xpc_demo_";
  const sampleContext = {
    id: "demo-1908800000000000000",
    url: "https://x.com/ai_builder/status/1908800000000000000",
    text: "MiniMax H3 + Midjourney v8.2：用六张 Midjourney 参考图生成一支时尚预告片，看 H3 如何保留人物、色彩与场景连续性。",
    authorName: "AI Builder",
    authorHandle: "@ai_builder",
    capturedAt: new Date().toISOString(),
    contextScope: "Demo 帖子",
    media: { hasVideo: true, imageCount: 0 }
  };

  function read(key) {
    const value = localStorage.getItem(`${prefix}${key}`);
    return value === null ? undefined : JSON.parse(value);
  }

  function write(values) {
    const changes = {};
    for (const [key, value] of Object.entries(values)) {
      const oldValue = read(key);
      localStorage.setItem(`${prefix}${key}`, JSON.stringify(value));
      changes[key] = { oldValue, newValue: value };
    }
    listeners.forEach((listener) => listener(changes, "local"));
  }

  globalThis.chrome = globalThis.chrome || {};
  globalThis.chrome.storage = {
    local: {
      async get(keys) {
        const selected = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(selected.map((key) => [key, read(key)]).filter(([, value]) => value !== undefined));
      },
      async set(values) { write(values); }
    },
    onChanged: {
      addListener(listener) { listeners.add(listener); }
    }
  };

  if (!read("xpc_current_context")) {
    write({ xpc_current_context: sampleContext, xpc_current_mode: "comment" });
  }

  addEventListener("message", (event) => {
    if (event.data?.type !== "XPC_DEMO_ACTION") return;
    write({ xpc_current_context: sampleContext, xpc_current_mode: event.data.action });
  });
})();
