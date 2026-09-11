import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { SettingsService } from '../settings/settings.service';
import type { GeneratedSection } from './seo-content';

export type GeneratedArticleDraft = {
  title: string;
  excerpt: string;
  primaryKeyword: string;
  relatedKeywords: string[];
  tags: string[];
  seoTitle: string;
  metaDescription: string;
  coverAlt: string;
  imagePrompt: string;
  sections: GeneratedSection[];
};

type ProviderConfig = {
  baseUrl: string;
  apiKey: string;
  textModel: string;
  imageModel?: string;
  timeoutMs: number;
};

@Injectable()
export class SeoAiAdapter {
  constructor(private readonly settings: SettingsService) {}

  async generateArticle(input: {
    keyword: string;
    category: string;
    publicContext: string;
    existingArticles: Array<{ title: string; slug: string }>;
  }) {
    const config = await this.config();
    const prompt = this.articlePrompt(input);
    const response = await this.generateText(config, prompt);
    const article = this.parseArticle(response.text);
    return {
      article,
      usage: response.usage,
      modelSnapshot: {
        baseUrl: config.baseUrl,
        textModel: config.textModel,
        imageModel: config.imageModel ?? null,
      },
    };
  }

  async generateCover(prompt: string) {
    const config = await this.config();
    if (!config.imageModel) throw new BadRequestException('图片模型尚未配置');
    const response = await this.requestJson(
      `${config.baseUrl}/images/generations`,
      {
        model: config.imageModel,
        prompt: `${prompt}\nClean editorial network illustration, no text, no letters, no logos, no watermark, 16:9 composition.`,
        size: '1536x1024',
        quality: 'high',
        response_format: 'b64_json',
      },
      config,
    );
    const data = Array.isArray(response.data) ? response.data : [];
    const image = this.object(data[0]);
    if (typeof image?.b64_json === 'string') {
      const buffer = Buffer.from(image.b64_json, 'base64');
      if (!buffer.length || buffer.length > 20 * 1024 * 1024) {
        throw new BadGatewayException('图片服务返回了无效文件');
      }
      return buffer;
    }
    if (typeof image?.url === 'string') {
      const url = new URL(image.url);
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new BadGatewayException('图片服务返回了无效地址');
      }
      const imageResponse = await fetch(url, {
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!imageResponse.ok) throw new BadGatewayException('下载生成图片失败');
      const bytes = Buffer.from(await imageResponse.arrayBuffer());
      if (!bytes.length || bytes.length > 20 * 1024 * 1024) {
        throw new BadGatewayException('图片服务返回了无效文件');
      }
      return bytes;
    }
    throw new BadGatewayException('图片服务没有返回可用图片');
  }

  async testConnection() {
    const config = await this.config();
    const response = await this.generateText(
      config,
      'Return only this JSON object: {"ok":true}',
    );
    return { ok: response.text.includes('true'), model: config.textModel };
  }

  private async config(): Promise<ProviderConfig> {
    const [baseUrl, apiKey, textModel, imageModel, timeoutRaw] =
      await Promise.all([
        this.settings.get('seo.aiBaseUrl'),
        this.settings.getSecret('seo.aiApiKey'),
        this.settings.get('seo.textModel'),
        this.settings.get('seo.imageModel'),
        this.settings.get('seo.timeoutMs'),
      ]);
    if (!baseUrl?.trim() || !apiKey?.trim() || !textModel?.trim()) {
      throw new BadRequestException('AI 服务尚未配置');
    }
    let parsed: URL;
    try {
      parsed = new URL(baseUrl.trim());
    } catch {
      throw new BadRequestException('AI Base URL 格式无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new BadRequestException('AI Base URL 必须使用 HTTP(S)');
    }
    if (
      process.env.NODE_ENV === 'production' &&
      parsed.protocol !== 'https:' &&
      !['localhost', '127.0.0.1'].includes(parsed.hostname)
    ) {
      throw new BadRequestException('生产环境 AI Base URL 必须使用 HTTPS');
    }
    const timeout = Number(timeoutRaw ?? 60_000);
    return {
      baseUrl: parsed.toString().replace(/\/$/, ''),
      apiKey,
      textModel: textModel.trim(),
      imageModel: imageModel?.trim() || undefined,
      timeoutMs: Number.isFinite(timeout)
        ? Math.min(Math.max(timeout, 5_000), 180_000)
        : 60_000,
    };
  }

  private async generateText(config: ProviderConfig, prompt: string) {
    try {
      const json = await this.requestJson(
        `${config.baseUrl}/responses`,
        {
          model: config.textModel,
          input: prompt,
          text: { format: { type: 'json_object' } },
        },
        config,
      );
      return {
        text: this.responseText(json),
        usage: this.responseUsage(json),
      };
    } catch (error) {
      if (
        !(error instanceof ProviderHttpError) ||
        ![404, 405].includes(error.status)
      ) {
        throw error;
      }
      const json = await this.requestJson(
        `${config.baseUrl}/chat/completions`,
        {
          model: config.textModel,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
        },
        config,
      );
      const choices = Array.isArray(json.choices) ? json.choices : [];
      const choice = this.object(choices[0]);
      const message = this.object(choice?.message);
      if (typeof message?.content !== 'string') {
        throw new BadGatewayException('AI 服务没有返回正文');
      }
      return {
        text: message.content,
        usage: this.responseUsage(json),
      };
    }
  }

  private async requestJson(
    url: string,
    body: Record<string, unknown>,
    config: ProviderConfig,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      throw new BadGatewayException(
        `AI 服务连接失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > 25 * 1024 * 1024) {
      throw new BadGatewayException('AI 服务响应超过大小限制');
    }
    const raw = await response.text();
    if (!response.ok) {
      throw new ProviderHttpError(response.status, raw.slice(0, 300));
    }
    try {
      return this.object(JSON.parse(raw)) ?? {};
    } catch {
      throw new BadGatewayException('AI 服务返回了无效 JSON');
    }
  }

  private responseText(json: Record<string, unknown>) {
    if (typeof json.output_text === 'string') return json.output_text;
    const output = Array.isArray(json.output) ? json.output : [];
    for (const item of output) {
      const content = Array.isArray(this.object(item)?.content)
        ? (this.object(item)?.content as unknown[])
        : [];
      for (const part of content) {
        const value = this.object(part);
        if (typeof value?.text === 'string') return value.text;
      }
    }
    throw new BadGatewayException('AI 服务没有返回正文');
  }

  private responseUsage(json: Record<string, unknown>) {
    const usage = this.object(json.usage);
    return {
      inputTokens: Number(usage?.input_tokens ?? usage?.prompt_tokens ?? 0),
      outputTokens: Number(
        usage?.output_tokens ?? usage?.completion_tokens ?? 0,
      ),
    };
  }

  private parseArticle(raw: string): GeneratedArticleDraft {
    let value: Record<string, unknown>;
    try {
      value = this.object(JSON.parse(raw)) ?? {};
    } catch {
      throw new BadGatewayException('AI 正文不是有效 JSON');
    }
    const required = [
      'title',
      'excerpt',
      'primaryKeyword',
      'seoTitle',
      'metaDescription',
      'coverAlt',
      'imagePrompt',
    ] as const;
    for (const field of required) {
      if (typeof value[field] !== 'string' || !value[field].trim()) {
        throw new BadGatewayException(`AI 正文缺少字段：${field}`);
      }
    }
    if (!Array.isArray(value.sections)) {
      throw new BadGatewayException('AI 正文缺少 sections');
    }
    return {
      title: String(value.title),
      excerpt: String(value.excerpt),
      primaryKeyword: String(value.primaryKeyword),
      relatedKeywords: this.stringArray(value.relatedKeywords, 12),
      tags: this.stringArray(value.tags, 8),
      seoTitle: String(value.seoTitle),
      metaDescription: String(value.metaDescription),
      coverAlt: String(value.coverAlt),
      imagePrompt: String(value.imagePrompt),
      sections: value.sections as GeneratedSection[],
    };
  }

  private articlePrompt(input: {
    keyword: string;
    category: string;
    publicContext: string;
    existingArticles: Array<{ title: string; slug: string }>;
  }) {
    return `你是素心 Network 编辑部的中文技术编辑。围绕“${input.keyword}”生成一篇可由人工审核的${input.category}草稿。

要求：正文 1600 至 2600 个中文字符；至少三个清晰章节；先给判断方法，再给按顺序执行的步骤；不要虚构测试数据、用户评价、软件版本、价格或保证；不要关键词堆砌；不要输出 HTML；只使用下方公开资料中的事实。内部链接由系统补充。

公开资料：
${input.publicContext.slice(0, 20_000) || '暂无，使用通用且可核验的排障方法。'}

已有文章，避免重复：
${input.existingArticles.map((article) => `- ${article.title} (/blog/${article.slug})`).join('\n') || '暂无'}

仅返回 JSON：
{"title":"","excerpt":"","primaryKeyword":"${input.keyword}","relatedKeywords":[""],"tags":[""],"seoTitle":"","metaDescription":"","coverAlt":"","imagePrompt":"","sections":[{"heading":"","blocks":[{"type":"paragraph","text":""},{"type":"bullets","items":[""]},{"type":"ordered","items":[""]},{"type":"blockquote","text":""},{"type":"code","language":"","code":""}]}]}`;
  }

  private object(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private stringArray(value: unknown, maximum: number) {
    return Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === 'string')
          .map((item) => item.trim())
          .filter(Boolean)
          .slice(0, maximum)
      : [];
  }
}

class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(`AI 服务返回 ${status}：${message}`);
  }
}
