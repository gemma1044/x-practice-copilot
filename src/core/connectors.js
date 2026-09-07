import { TextGenerationConnector, VisionAnalysisConnector } from "./contracts.js";

export class ConnectorNotConfiguredError extends Error {
  constructor(capability, nextStep) {
    super(`${capability}尚未配置`);
    this.name = "ConnectorNotConfiguredError";
    this.capability = capability;
    this.nextStep = nextStep;
  }
}

export class ConnectorRequestError extends Error {
  constructor(message, { code = "CONNECTOR_REQUEST_FAILED", status = 0, nextStep = "请确认本机 bridge 已启动后重试。" } = {}) {
    super(message);
    this.name = "ConnectorRequestError";
    this.code = code;
    this.status = status;
    this.nextStep = nextStep;
  }
}

export class LoopbackTextConnector extends TextGenerationConnector {
  constructor({ baseUrl = "http://127.0.0.1:4317", fetchImpl = globalThis.fetch, timeoutMs = 35_000 } = {}) {
    super();
    this.baseUrl = baseUrl.replace(/\/$/u, "");
    this.fetchImpl = typeof fetchImpl === "function" ? fetchImpl.bind(globalThis) : fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  async getStatus() {
    return this.#request("/health", { method: "GET" });
  }

  async generateComments(input) {
    return this.#request("/v1/text/comments", { method: "POST", body: input });
  }

  async generateInspiration(input) {
    return this.#request("/v1/text/inspiration", { method: "POST", body: input });
  }

  async #request(pathname, { method, body } = {}) {
    if (typeof this.fetchImpl !== "function") {
      throw new ConnectorRequestError("当前环境不支持请求本机 bridge");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${pathname}`, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ConnectorRequestError(payload.error?.message || `本机 bridge 返回 ${response.status}`, {
          code: payload.error?.code,
          status: response.status,
          nextStep: payload.error?.nextStep
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof ConnectorRequestError) throw error;
      if (error.name === "AbortError") {
        throw new ConnectorRequestError("文字 AI 请求超时", { code: "BRIDGE_TIMEOUT" });
      }
      throw new ConnectorRequestError("无法连接本机文字 AI bridge", { code: "BRIDGE_UNAVAILABLE" });
    } finally {
      clearTimeout(timeout);
    }
  }
}

export class UnconfiguredTextConnector extends TextGenerationConnector {
  getStatus() {
    return {
      configured: false,
      provider: "Merouter",
      model: "deepseek_v4_flash",
      message: "本机安全桥接尚未配置；扩展包不保存 OPENAI_API_KEY。"
    };
  }

  async generateComments() {
    throw new ConnectorNotConfiguredError(
      "文字 AI",
      "配置经确认的本机桥接后，再连接 Merouter deepseek_v4_flash。"
    );
  }

  async generateInspiration() {
    throw new ConnectorNotConfiguredError(
      "灵感 AI",
      "配置经确认的本机桥接后，再用 Merouter deepseek_v4_flash 提炼灵感。"
    );
  }
}

/** 只供本地可交互 Demo 使用，不代表真实模型调用。 */
export class DemoTextConnector extends TextGenerationConnector {
  getStatus() {
    return {
      configured: true,
      provider: "Demo AI 模拟",
      model: "deterministic-demo",
      message: "固定演示结果，不会访问外部模型。"
    };
  }

  async generateComments() {
    await new Promise((resolve) => setTimeout(resolve, 240));
    return [
      { title: "观点补充", text: "真正有价值的可能不是 20 分钟这个数字，而是任务有没有留下可复查的产物。" },
      { title: "开放提问", text: "如果只能保留一个判断信号，你会更看重最终输出，还是过程中暴露出的返工点？" },
      { title: "实践计划", text: "我计划用同一个小任务做一次模型对比，并记录输出、耗时和返工步骤，再回来补充观察。" }
    ];
  }

  async generateInspiration({ sourcePost }) {
    await new Promise((resolve) => setTimeout(resolve, 280));
    const subject = sourcePost?.text || "当前帖子";
    return {
      sourceSummary: `${subject.slice(0, 54)}${subject.length > 54 ? "…" : ""}`,
      mechanisms: [
        { id: "task", label: "限时真实任务", detail: "用具体任务代替抽象能力问答" },
        { id: "artifact", label: "可复查产物", detail: "把过程与输出作为判断依据" },
        { id: "contrast", label: "反常识对比", detail: "从“会不会”切换到“做出了什么”" }
      ],
      scriptIdeas: [
        { id: "race", label: "3 个 AI 同做 20 分钟海报，按返工次数排名", detail: "开头亮出同一 brief，中段并排过程，结尾展示成片与返工记录" },
        { id: "curve", label: "让 AI 从 5 分钟做到 30 分钟，寻找质量拐点", detail: "用 5/10/20/30 分钟四档结果推进，落点是时间投入是否真的换来质量" },
        { id: "blind", label: "隐藏模型名盲评成片，再公开过程和失败镜头", detail: "先让观众投票，后半段揭晓模型与过程证据，避免品牌先入为主" }
      ]
    };
  }
}

export class UnconfiguredVisionConnector extends VisionAnalysisConnector {
  getStatus() {
    return {
      configured: false,
      provider: null,
      message: "视觉模型尚未选择；当前不会上传截图或伪造分析结果。"
    };
  }

  async analyzeVideo() {
    throw new ConnectorNotConfiguredError(
      "视频视觉分析",
      "先配置独立视觉模型连接器，并由用户确认上传的帧。"
    );
  }
}
