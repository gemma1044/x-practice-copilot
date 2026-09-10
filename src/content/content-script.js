(() => {
  const ACTIONS = [
    { id: "comment", label: "AI 评论", icon: "✦" },
    { id: "inspiration", label: "收为灵感", icon: "⌁" },
    { id: "video", label: "拆解视频", icon: "▻" }
  ];

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function hasVideoMedia(postRoot) {
    return Boolean(postRoot.querySelector([
      "video",
      '[data-testid="videoPlayer"]',
      '[data-testid="videoComponent"]'
    ].join(",")));
  }

  function statusUrl(postRoot) {
    const anchors = [...postRoot.querySelectorAll('a[href*="/status/"]')];
    const timestampAnchor = anchors.find((anchor) => anchor.querySelector("time"));
    const href = timestampAnchor?.getAttribute("href")
      || anchors.map((anchor) => anchor.getAttribute("href")).find(Boolean);
    return href ? new URL(href, location.origin).href : location.href;
  }

  function extractPost(postRoot, tweetText) {
    const userName = postRoot.querySelector('[data-testid="User-Name"]');
    const userText = cleanText(userName?.textContent);
    const handle = userText.match(/@[\w_]+/u)?.[0] || "";
    const authorName = cleanText(userText.replace(handle, "").split("·")[0]);
    const textNodes = [...postRoot.querySelectorAll('[data-testid="tweetText"]')];
    const text = cleanText(tweetText?.textContent);
    const url = statusUrl(postRoot);

    return {
      id: url.match(/status\/(\d+)/u)?.[1] || url,
      url,
      text,
      authorName,
      authorHandle: handle,
      capturedAt: new Date().toISOString(),
      contextScope: textNodes.length > 1 ? "当前帖子及可见引用" : "仅当前可见帖子",
      media: {
        hasVideo: hasVideoMedia(postRoot),
        imageCount: postRoot.querySelectorAll('[data-testid="tweetPhoto"] img').length
      }
    };
  }

  function fallbackPostRoot(tweetText) {
    let candidate = tweetText.parentElement;
    for (let depth = 0; candidate && depth < 12; depth += 1) {
      if (
        candidate.querySelector('a[href*="/status/"]')
        && candidate.querySelector('[role="group"]')
      ) return candidate;
      candidate = candidate.parentElement;
    }
    return null;
  }

  function resolvePostRoot(tweetText) {
    return tweetText.closest('[data-testid="tweet"]')
      || tweetText.closest('[data-testid="cellInnerDiv"]')
      || fallbackPostRoot(tweetText);
  }

  function createActions(postRoot, tweetText) {
    if (postRoot.querySelector(":scope > .xpc-actions, :scope .xpc-actions")) return;

    const bar = document.createElement("div");
    bar.className = "xpc-actions";
    bar.setAttribute("aria-label", "X Practice Copilot 操作");

    for (const action of ACTIONS) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "xpc-action";
      button.dataset.action = action.id;
      button.innerHTML = `<span aria-hidden="true">${action.icon}</span>${action.label}`;
      button.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.dataset.loading = "true";
        delete button.dataset.error;
        button.removeAttribute("title");
        try {
          const response = await chrome.runtime.sendMessage({
            type: "XPC_OPEN_PANEL",
            action: action.id,
            context: extractPost(postRoot, tweetText)
          });
          if (!response?.ok) throw new Error(response?.error || "侧栏未能打开");
        } catch (error) {
          button.dataset.error = "true";
          button.title = `打开失败：${error.message}`;
        } finally {
          delete button.dataset.loading;
        }
      });
      bar.append(button);
    }

    const socialGroup = postRoot.querySelector('[role="group"]');
    if (socialGroup) socialGroup.insertAdjacentElement("afterend", bar);
    else tweetText.insertAdjacentElement("afterend", bar);
  }

  function scan() {
    document.querySelectorAll('[data-testid="tweetText"]').forEach((tweetText) => {
      const postRoot = resolvePostRoot(tweetText);
      if (postRoot) createActions(postRoot, tweetText);
    });
  }

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  });

  scan();
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
