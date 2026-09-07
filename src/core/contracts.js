/**
 * @typedef {Object} SourcePost
 * @property {string} id
 * @property {string} url
 * @property {string} text
 * @property {string} authorName
 * @property {string} authorHandle
 * @property {string} capturedAt
 * @property {{hasVideo: boolean, imageCount: number}} media
 */

/** 文字能力的可替换连接器。真实实现必须在本机桥接中读取密钥。 */
export class TextGenerationConnector {
  getStatus() {
    throw new Error("TextGenerationConnector.getStatus 尚未实现");
  }

  async generateComments(_input) {
    throw new Error("TextGenerationConnector.generateComments 尚未实现");
  }

  async generateInspiration(_input) {
    throw new Error("TextGenerationConnector.generateInspiration 尚未实现");
  }
}

/** 视觉能力独立于文字模型，避免把 DeepSeek 当成画面理解模型。 */
export class VisionAnalysisConnector {
  getStatus() {
    throw new Error("VisionAnalysisConnector.getStatus 尚未实现");
  }

  async analyzeVideo(_input) {
    throw new Error("VisionAnalysisConnector.analyzeVideo 尚未实现");
  }
}

/** 业务数据只有一个 Repository 入口；未来由个人飞书适配器替换。 */
export class PracticeRepository {
  async saveInspiration(_record) {
    throw new Error("PracticeRepository.saveInspiration 尚未实现");
  }

  async listInspirations() {
    throw new Error("PracticeRepository.listInspirations 尚未实现");
  }
}
