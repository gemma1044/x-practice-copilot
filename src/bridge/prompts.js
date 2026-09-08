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

export function visionMessages({ sourcePost, scenes, contactSheets, taskMode, analysisPrompt, replacementBrief, referenceImages }) {
  const map = contactSheets.map((sheet, sheetIndex) => ({
    image: sheetIndex + 1,
    cells: sheet.sceneIds.flatMap((sceneId) => {
      const scene = scenes.find((item) => item.id === sceneId);
      return (scene?.frameTimes || []).map((timeSeconds, frameIndex) => ({
        scene: scene?.index,
        clipStartSeconds: scene?.startSeconds,
        clipEndSeconds: scene?.endSeconds,
        phase: ["早", "中", "晚"][frameIndex],
        timeSeconds
      }));
    })
  }));
  return [
    {
      role: "system",
      content: "你是短视频视觉标注、复刻与改编助手。先结合原贴正文和九宫格，在内部按每个 clip 的早、中、晚采样完成分析，但不要在响应中返回 clips、structure、分析过程或推理。sourceAnalysis.claimedModel 只能逐字保留原贴正文、可见字幕或水印明确出现的生成模型名；不得扩写别名、产品线或猜测版本，没有明确证据必须写“未识别”。每张视频输入图是 3×3 九宫格，每连续三格属于同一 clip；medeoPrompt 必须使用映射中每个 clip 的真实起止时间，逐段写清画面、动作、字幕、风格与转场，不得遗漏或自行改写时间。只描述可见变化，不推断音频或采样帧之间未观察到的连续动作。taskMode=replicate 时忠实复刻原片；taskMode=adapt 时以用户文本为创作目标，沿用有效结构但替换相应内容。返回严格 JSON，且只能包含：summary；sourceAnalysis{postSummary,claimedModel,modelEvidence,confidence}；medeoPrompt。medeoPrompt 直接从视频规格和时间轴正文开始，不要另写模型信息；bridge 会把 claimedModel 作为唯一模型行加入最终 Prompt。"
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `任务类型：${taskMode === "adapt" ? "改编成用户的视频" : "忠实复刻原片"}\n来源帖子：${sourcePost.url}\n原贴正文：${sourcePost.text}\n九宫格单元映射：${JSON.stringify(map)}\n\n用户编辑的分析任务：\n${analysisPrompt}\n\n用户的改编文本：\n${replacementBrief || "无"}\n\n参考图顺序：${referenceImages.map((image, index) => `${index + 1}. ${image.name}`).join("；") || "无"}`
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
