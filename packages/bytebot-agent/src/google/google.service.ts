import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  isComputerToolUseContentBlock,
  isImageContentBlock,
  isUserActionContentBlock,
  MessageContentBlock,
  MessageContentType,
  ImageContentBlock,
  TextContentBlock,
  ThinkingContentBlock,
  ToolUseContentBlock,
} from '@bytebot/shared';
import {
  BytebotAgentService,
  BytebotAgentInterrupt,
  BytebotAgentResponse,
} from '../agent/agent.types';
import { BaseProvider } from '../providers/base-provider.interface';
import { Message, Role } from '@prisma/client';
import { googleTools } from './google.tools';
import {
  Content,
  GenerateContentResponse,
  GoogleGenAI,
  Part,
} from '@google/genai';
import { v4 as uuid } from 'uuid';
import { DEFAULT_MODEL, GOOGLE_MODELS } from './google.constants';

@Injectable()
export class GoogleService implements BytebotAgentService, BaseProvider {
  private readonly google: GoogleGenAI;
  private readonly logger = new Logger(GoogleService.name);
  private readonly apiKey: string;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('GEMINI_API_KEY') || '';

    if (!this.apiKey) {
      this.logger.warn(
        'GEMINI_API_KEY is not set. GoogleService will not work properly.',
      );
    }

    this.google = new GoogleGenAI({
      apiKey: this.apiKey || 'dummy-key-for-initialization',
    });
  }

  async generateMessage(
    systemPrompt: string,
    messages: Message[],
    model: string = DEFAULT_MODEL.name,
    useTools: boolean = true,
    signal?: AbortSignal,
  ): Promise<BytebotAgentResponse> {
    try {
      const maxTokens = 8192;

      // Convert our message content blocks to Anthropic's expected format
      const googleMessages = this.formatMessagesForGoogle(messages);

      const response: GenerateContentResponse =
        await this.google.models.generateContent({
          model,
          contents: googleMessages,
          config: {
            thinkingConfig: {
              thinkingBudget: 24576,
            },
            maxOutputTokens: maxTokens,
            systemInstruction: systemPrompt,
            tools: useTools
              ? [
                  {
                    functionDeclarations: googleTools,
                  },
                ]
              : [],
            abortSignal: signal,
          },
        });

      const candidate = response.candidates?.[0];

      if (!candidate) {
        throw new Error('No candidate found in response');
      }

      const content = candidate.content;

      if (!content) {
        throw new Error('No content found in candidate');
      }

      if (!content.parts) {
        throw new Error('No parts found in content');
      }

      return {
        contentBlocks: this.formatGoogleResponse(content.parts),
        tokenUsage: {
          inputTokens: response.usageMetadata?.promptTokenCount || 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
          totalTokens: response.usageMetadata?.totalTokenCount || 0,
        },
      };
    } catch (error) {
      if (error.message.includes('AbortError')) {
        throw new BytebotAgentInterrupt();
      }
      this.logger.error(
        `Error sending message to Google Gemini: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Convert our MessageContentBlock format to Google Gemini's message format
   */
  private formatMessagesForGoogle(messages: Message[]): Content[] {
    const googleMessages: Content[] = [];

    // Process each message content block
    for (const message of messages) {
      const messageContentBlocks = message.content as MessageContentBlock[];

      const parts: Part[] = [];

      if (
        messageContentBlocks.every((block) => isUserActionContentBlock(block))
      ) {
        const userActionContentBlocks = messageContentBlocks.flatMap(
          (block) => block.content,
        );
        for (const block of userActionContentBlocks) {
          if (isComputerToolUseContentBlock(block)) {
            parts.push({
              text: `User performed action: ${block.name}\n${JSON.stringify(block.input, null, 2)}`,
            });
          } else if (isImageContentBlock(block)) {
            parts.push({
              inlineData: {
                data: block.source.data,
                mimeType: block.source.media_type,
              },
            });
          }
        }
      } else {
        for (const block of messageContentBlocks) {
          switch (block.type) {
            case MessageContentType.Text:
              parts.push({
                text: block.text,
              });
              break;
            case MessageContentType.ToolUse:
              parts.push({
                functionCall: {
                  id: block.id,
                  name: block.name,
                  args: block.input ?? {},
                },
              });
              break;
            case MessageContentType.Image:
              parts.push({
                inlineData: {
                  data: block.source.data,
                  mimeType: block.source.media_type,
                },
              });
              break;
            case MessageContentType.ToolResult: {
              const textOutputs = block.content
                .filter((content) => content.type === MessageContentType.Text)
                .map((content) => (content as TextContentBlock).text)
                .filter((text) => text.trim().length > 0);
              const imageContents = block.content.filter(
                (content) => content.type === MessageContentType.Image,
              ) as ImageContentBlock[];

              const aggregatedText = textOutputs.join('\n').trim();
              const responsePayload: Record<string, unknown> = {};

              if (aggregatedText.length > 0) {
                if (block.is_error) {
                  responsePayload.error = aggregatedText;
                } else {
                  responsePayload.output = aggregatedText;
                }
              }

              parts.push({
                functionResponse: {
                  id: block.tool_use_id,
                  name: this.getToolName(block.tool_use_id, messages),
                  response: responsePayload,
                },
              });

              imageContents.forEach((imageBlock) => {
                parts.push({
                  inlineData: {
                    data: imageBlock.source.data,
                    mimeType: imageBlock.source.media_type,
                  },
                });
              });
              break;
            }
            case MessageContentType.Thinking:
              parts.push({
                text: block.thinking,
                thoughtSignature: block.signature,
                thought: true,
              });
              break;
            default:
              parts.push({
                text: JSON.stringify(block),
              });
              break;
          }
        }
      }

      googleMessages.push({
        role: message.role === Role.USER ? 'user' : 'model',
        parts: parts,
      });
    }

    return googleMessages;
  }

  // Find the content block with the tool_use_id and return the name
  private getToolName(
    tool_use_id: string,
    messages: Message[],
  ): string | undefined {
    const toolMessage = messages.find((message) =>
      (message.content as MessageContentBlock[]).some(
        (block) =>
          block.type === MessageContentType.ToolUse && block.id === tool_use_id,
      ),
    );
    if (!toolMessage) {
      return undefined;
    }

    const toolBlock = (toolMessage.content as MessageContentBlock[]).find(
      (block) =>
        block.type === MessageContentType.ToolUse && block.id === tool_use_id,
    );
    if (!toolBlock) {
      return undefined;
    }
    return (toolBlock as ToolUseContentBlock).name;
  }

  /**
   * Convert Google Gemini's response content to our MessageContentBlock format
   */
  private formatGoogleResponse(parts: Part[]): MessageContentBlock[] {
    return parts.map((part) => {
      if (part.text) {
        return {
          type: MessageContentType.Text,
          text: part.text,
        } as TextContentBlock;
      }

      if (part.thought) {
        return {
          type: MessageContentType.Thinking,
          signature: part.thoughtSignature,
          thinking: part.text,
        } as ThinkingContentBlock;
      }

      if (part.functionCall) {
        return {
          type: MessageContentType.ToolUse,
          id: part.functionCall.id || uuid(),
          name: part.functionCall.name,
          input: part.functionCall.args,
        } as ToolUseContentBlock;
      }

      this.logger.warn(`Unknown content type from Google: ${part}`);
      return {
        type: MessageContentType.Text,
        text: JSON.stringify(part),
      } as TextContentBlock;
    });
  }

  // BaseProvider interface methods
  async send(
    systemPrompt: string,
    messages: Message[],
    model: string,
    useTools: boolean,
    signal?: AbortSignal,
  ): Promise<BytebotAgentResponse> {
    return this.generateMessage(systemPrompt, messages, model, useTools, signal);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.apiKey) {
      return false;
    }

    try {
      // Simple test with minimal token usage
      const result = await this.google.models.generateContent({
        model: DEFAULT_MODEL.name,
        contents: [{ role: 'user', parts: [{ text: 'Hi' }] }],
        config: { maxOutputTokens: 1 },
      });

      return !!result.candidates && result.candidates.length > 0;
    } catch (error) {
      this.logger.error('Google health check failed:', error);
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    // Google doesn't provide a direct API to list models
    // Return the models we know are available
    return GOOGLE_MODELS.map(model => model.name);
  }
}
