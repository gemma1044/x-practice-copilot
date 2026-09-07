(() => {
  const ACTIONS = [
    { id: "comment", label: "AI 评论", icon: "✦" },
    { id: "inspiration", label: "收为灵感", icon: "⌁" },
    { id: "video", label: "拆解视频", icon: "▻" }
  ];

  function cleanText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function statusUrl(article) {
    const anchors = [...article.querySelectorAll('a[href*="/status/"]')];
    const href = anchors.map((anchor) => anchor.getAttribute("href")).find(Boolean);
    return href ? new URL(href, location.origin).href : location.href;
  }

  function extractPost(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    const userText = cleanText(userName?.textContent);
    const handle = userText.match(/@[\w_]+/u)?.[0] || "";
    const authorName = cleanText(userText.replace(handle, "").split("·")[0]);
    const textNodes = [...article.querySelectorAll('[data-testid="tweetText"]')];
    const text = cleanText(textNodes[0]?.textContent);
    const url = statusUrl(article);

    return {
      id: url.match(/status\/(\d+)/u)?.[1] || url,
      url,
      text,
      authorName,
      authorHandle: handle,
      capturedAt: new Date().toISOString(),
      contextScope: textNodes.length > 1 ? "当前帖子及可见引用" : "仅当前可见帖子",
      media: {
        hasVideo: Boolean(article.querySelector("video")),
        imageCount: article.querySelectorAll('[data-testid="tweetPhoto"] img').length
      }
    };
  }

  function createActions(article) {
    if (article.querySelector(".xpc-actions")) return;
    const tweetText = article.querySelector('[data-testid="tweetText"]');
    if (!tweetText) return;

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
            context: extractPost(article)
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

    const socialGroup = article.querySelector('[role="group"]');
    if (socialGroup?.parentElement) socialGroup.parentElement.append(bar);
    else tweetText.insertAdjacentElement("afterend", bar);
  }

  function scan() {
    document.querySelectorAll('article[data-testid="tweet"]').forEach(createActions);
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
