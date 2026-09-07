function sourceBlock(sourcePost) {
  return JSON.stringify(sourcePost, null, 2);
}

export function commentMessages(sourcePost) {
  return [
    {
      role: "system",
      content: "你是 X 评论助手。只依据来源帖子生成中文评论草稿，不虚构用户经历、测试或数字。返回严格 JSON：{\"comments\":[{\"title\":\"\",\"text\":\"\"}]}，comments 必须恰好 3 条，分别偏观点补充、开放提问、可执行计划。"
    },
    { role: "user", content: `来源帖子：\n${sourceBlock(sourcePost)}` }
  ];
}

export function inspirationMessages(sourcePost) {
  return [
    {
      role: "system",
      content: "你是 X 创作实践助手。只返回两组选项，不生成或暗示用户证据。返回严格 JSON：{\"sourceSummary\":\"\",\"mechanisms\":[{\"id\":\"\",\"label\":\"\",\"detail\":\"\"}],\"scriptIdeas\":[{\"id\":\"\",\"label\":\"\",\"detail\":\"\"}]}。mechanisms 与 scriptIdeas 各 3–5 项；脚本 idea 必须包含具体对象、实验结构和叙事钩子。"
    },
    { role: "user", content: `来源帖子：\n${sourceBlock(sourcePost)}` }
  ];
}
