function sourceBlock(sourcePost) {
  return JSON.stringify(sourcePost, null, 2);
}

const REPLY_LANGUAGE_INSTRUCTIONS = {
  "zh-CN": "评论正文使用自然的简体中文。",
  en: "Write every comment body in natural English.",
  ja: "コメント本文は自然な日本語で書く。",
  ko: "댓글 본문은 자연스러운 한국어로 작성한다.",
  es: "Escribe el texto de cada comentario en español natural.",
  "same-as-source": "评论正文跟随原作者正文的主要语言；忽略附加的机器翻译文本，无法判断时使用英语。"
};

export function commentMessages(sourcePost, replyLanguage = "zh-CN") {
  return [
    {
      role: "system",
      content: `你是 X 评论助手。只依据来源帖子生成评论草稿，不虚构用户经历、测试或数字。${REPLY_LANGUAGE_INSTRUCTIONS[replyLanguage]} title 固定使用中文分类“观点补充”“开放提问”“可执行计划”，只有 text 使用目标语种。返回严格 JSON：{\"comments\":[{\"title\":\"\",\"text\":\"\"}]}，comments 必须恰好 3 条。`
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

export function visionMessages({ sourcePost, scenes, contactSheets, analysisPrompt, replacementBrief, referenceImages }) {
  const map = contactSheets.map((sheet, sheetIndex) => ({
    image: sheetIndex + 1,
    cells: sheet.sceneIds.flatMap((sceneId) => {
      const scene = scenes.find((item) => item.id === sceneId);
      return (scene?.frameTimes || []).map((timeSeconds, frameIndex) => ({
        scene: scene?.index,
        phase: ["早", "中", "晚"][frameIndex],
        timeSeconds
      }));
    })
  }));
  return [
    {
      role: "system",
      content: "你是短视频视觉拆解与复刻助手。每张视频输入图是 3×3 九宫格，每连续三格属于同一场景的早、中、晚采样。只描述可见变化，不推断未观察到的连续动作或音频。用户的替换说明和参考图优先于原视频中的产品、人物、文案与场地；保留原视频结构，但不得把被要求替换的元素继续写进最终 Prompt。返回严格 JSON：summary；structure{hook,progression,ending,pace}；scenes[{index,timeRange,visibleChange,visualStyle,transition}]；medeoPrompt。medeoPrompt 必须是可直接交给 AI Video 模型执行的中文完整提示词。"
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `来源帖子：${sourcePost.url}\n正文：${sourcePost.text}\n九宫格单元映射：${JSON.stringify(map)}\n\n用户编辑的分析任务：\n${analysisPrompt}\n\n替换说明：\n${replacementBrief || "无，忠实复刻原视频可见内容"}\n\n参考图顺序：${referenceImages.map((image, index) => `${index + 1}. ${image.name}`).join("；") || "无"}`
        },
        ...contactSheets.map((sheet) => ({
          type: "image_url",
          image_url: { url: sheet.dataUrl, detail: "high" }
        })),
        ...referenceImages.map((image) => ({ type: "image_url", image_url: { url: image.dataUrl, detail: "high" } }))
      ]
    }
  ];
}
