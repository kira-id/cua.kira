import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  MessageContentBlock,
  MessageContentType,
  TextContentBlock,
  ToolUseContentBlock,
  ToolResultContentBlock,
  ImageContentBlock,
  isUserActionContentBlock,
  isComputerToolUseContentBlock,
  isImageContentBlock,
} from '@bytebot/shared';
import { DEFAULT_MODEL } from './openrouter.constants';
import { Message, Role } from '@prisma/client';
import { openrouterTools } from './openrouter.tools';
import {
  BytebotAgentService,
  BytebotAgentInterrupt,
  BytebotAgentResponse,
} from '../agent/agent.types';
import { BaseProvider } from '../providers/base-provider.interface';

type OpenRouterMessageContentPart = {
  type: string;
  text?: string;
  image_url?: { url: string; detail?: 'low' | 'high' };
  id?: string;
  name?: string;
  input?: unknown;
  arguments?: unknown;
};

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null | OpenRouterMessageContentPart[];
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
}

interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenRouterResponse {
  choices: Array<{
    message: {
      content?: string | OpenRouterMessageContentPart[];
      tool_calls?: OpenRouterToolCall[];
    };
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

@Injectable()
export class OpenRouterService implements BytebotAgentService, BaseProvider {
  private readonly logger = new Logger(OpenRouterService.name);
  private readonly apiKey: string;
  private readonly baseUrl = 'https://openrouter.ai/api/v1';

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';

    if (!this.apiKey) {
      this.logger.warn(
        'OPENROUTER_API_KEY is not set. OpenRouterService will not work properly.',
      );
    }
  }

  async generateMessage(
    systemPrompt: string,
    messages: Message[],
    model: string = DEFAULT_MODEL.name,
    useTools: boolean = true,
    signal?: AbortSignal,
  ): Promise<BytebotAgentResponse> {
    return this.send(systemPrompt, messages, model, useTools, signal);
  }

  async send(
    systemPrompt: string,
    messages: Message[],
    model: string = DEFAULT_MODEL.name,
    useTools: boolean = true,
    signal?: AbortSignal,
  ): Promise<BytebotAgentResponse> {
    try {
      const openrouterMessages = this.formatMessagesForOpenRouter(
        systemPrompt,
        messages,
      );

      const body: any = {
        model,
        messages: openrouterMessages,
        max_tokens: 8192,
        temperature: 0.7,
      };

      if (useTools) {
        body.tools = openrouterTools;
        body.tool_choice = 'auto';
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://bytebot.ai',
          'X-Title': 'Bytebot Agent',
        },
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Rate limit exceeded');
        }
        throw new Error(
          `OpenRouter API error: ${response.status} ${response.statusText}`,
        );
      }

      const data: OpenRouterResponse = await response.json();

      return {
        contentBlocks: this.formatOpenRouterResponse(data),
        tokenUsage: {
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `Error sending message to OpenRouter: ${error.message}`,
        error.stack,
      );

      if (error.name === 'AbortError') {
        throw new BytebotAgentInterrupt();
      }

      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://bytebot.ai',
          'X-Title': 'Bytebot Agent',
        },
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async getAvailableModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://bytebot.ai',
          'X-Title': 'Bytebot Agent',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch models');
      }

      const data = await response.json();
      return data.data?.map((model: any) => model.id) || [];
    } catch (error) {
      this.logger.error('Failed to fetch available models:', error);
      return [];
    }
  }

  private formatMessagesForOpenRouter(
    systemPrompt: string,
    messages: Message[],
  ): OpenRouterMessage[] {
    const openrouterMessages: OpenRouterMessage[] = [
      {
        role: 'system',
        content: systemPrompt,
      },
    ];

    for (const message of messages) {
      const messageContentBlocks = message.content as MessageContentBlock[];

      if (
        messageContentBlocks.every((block) => isUserActionContentBlock(block))
      ) {
        // Handle user action blocks
        const userActionContentBlocks = messageContentBlocks.flatMap(
          (block) => block.content,
        );

        for (const block of userActionContentBlocks) {
          if (isComputerToolUseContentBlock(block)) {
            openrouterMessages.push({
              role: 'user',
              content: `User performed action: ${block.name}\n${JSON.stringify(block.input, null, 2)}`,
            });
          } else if (isImageContentBlock(block)) {
            openrouterMessages.push({
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Screenshot',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${block.source.media_type};base64,${block.source.data}`,
                    detail: 'high',
                  },
                },
              ],
            });
          }
        }
        continue;
      }

      // Convert content blocks to OpenRouter format
      for (const block of messageContentBlocks) {
        switch (block.type) {
          case MessageContentType.Text: {
            openrouterMessages.push({
              role: message.role === Role.USER ? 'user' : 'assistant',
              content: block.text,
            });
            break;
          }
          case MessageContentType.Image: {
            const imageBlock = block as ImageContentBlock;
            openrouterMessages.push({
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Screenshot',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${imageBlock.source.media_type};base64,${imageBlock.source.data}`,
                    detail: 'high',
                  },
                },
              ],
            });
            break;
          }
          case MessageContentType.ToolUse: {
            if (message.role === Role.ASSISTANT) {
              const toolBlock = block as ToolUseContentBlock;
              openrouterMessages.push({
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: toolBlock.id,
                    type: 'function',
                    function: {
                      name: toolBlock.name,
                      arguments: JSON.stringify(toolBlock.input),
                    },
                  },
                ],
              });
            }
            break;
          }
          case MessageContentType.ToolResult: {
            const toolResult = block as ToolResultContentBlock;
            const textOutputs: string[] = [];
            let hasImageContent = false;

            toolResult.content.forEach((content) => {
              if (content.type === MessageContentType.Text) {
                textOutputs.push(content.text);
              } else if (content.type === MessageContentType.Image) {
                hasImageContent = true;
                const imageContent = content as ImageContentBlock;
                openrouterMessages.push({
                  role: 'user',
                  content: [
                    {
                      type: 'text',
                      text: 'Screenshot',
                    },
                    {
                      type: 'image_url',
                      image_url: {
                        url: `data:${imageContent.source.media_type};base64,${imageContent.source.data}`,
                        detail: 'high',
                      },
                    },
                  ],
                });
              }
            });

            if (textOutputs.length > 0) {
              openrouterMessages.push({
                role: 'tool',
                tool_call_id: toolResult.tool_use_id,
                content: textOutputs.join('\n'),
              });
            } else if (hasImageContent) {
              openrouterMessages.push({
                role: 'tool',
                tool_call_id: toolResult.tool_use_id,
                content: 'screenshot',
              });
            }
            break;
          }
          default:
            // Handle unknown content types as text
            openrouterMessages.push({
              role: 'user',
              content: JSON.stringify(block),
            });
        }
      }
    }

    return openrouterMessages;
  }

  private formatOpenRouterResponse(
    response: OpenRouterResponse,
  ): MessageContentBlock[] {
    const contentBlocks: MessageContentBlock[] = [];
    const parsedToolCallIds = new Set<string>();

    if (response.choices && response.choices.length > 0) {
      const choice = response.choices[0];
      const message = choice.message;

      // Handle text content
      if (message.content) {
        if (Array.isArray(message.content)) {
          const textParts: string[] = [];
          const toolUseBlocksFromContent: ToolUseContentBlock[] = [];

          for (const part of message.content) {
            if (typeof part.text === 'string' && part.text.trim().length > 0) {
              textParts.push(part.text);
            }

            if (part.type === 'tool_use') {
              const toolUseId =
                part.id || `openrouter-tool-${parsedToolCallIds.size + 1}`;
              parsedToolCallIds.add(toolUseId);

              const toolInput = this.parseToolInput(part.input ?? part.arguments);
              if (typeof part.name === 'string') {
                toolUseBlocksFromContent.push({
                  type: MessageContentType.ToolUse,
                  id: toolUseId,
                  name: part.name,
                  input: toolInput,
                } as ToolUseContentBlock);
              }
            }
          }

          if (textParts.length > 0) {
            contentBlocks.push({
              type: MessageContentType.Text,
              text: textParts.join('\n'),
            } as TextContentBlock);
          }

          toolUseBlocksFromContent.forEach((block) => {
            contentBlocks.push(block);
          });
        } else if (
          typeof message.content === 'string' &&
          message.content.trim().length > 0
        ) {
          contentBlocks.push({
            type: MessageContentType.Text,
            text: message.content,
          } as TextContentBlock);
        }
      }

      // Handle tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const toolCall of message.tool_calls) {
          if (parsedToolCallIds.has(toolCall.id)) {
            continue;
          }

          let parsedArguments: Record<string, unknown> = {};
          try {
            parsedArguments = toolCall.function.arguments
              ? JSON.parse(toolCall.function.arguments)
              : {};
          } catch (error) {
            this.logger.warn(
              `Failed to parse tool call arguments for ${toolCall.function.name}: ${toolCall.function.arguments}`,
            );
          }

          contentBlocks.push({
            type: MessageContentType.ToolUse,
            id: toolCall.id,
            name: toolCall.function.name,
            input: parsedArguments,
          } as ToolUseContentBlock);

          parsedToolCallIds.add(toolCall.id);
        }
      }

      const refusal =
        typeof (message as any).refusal === 'string'
          ? (message as any).refusal
          : undefined;

      if (refusal && refusal.trim().length > 0) {
        contentBlocks.push({
          type: MessageContentType.Text,
          text: `Refusal: ${refusal}`,
        } as TextContentBlock);
      }
    }

    return contentBlocks;
  }

  private parseToolInput(rawInput: unknown): Record<string, unknown> {
    if (!rawInput) {
      return {};
    }

    if (typeof rawInput === 'string') {
      try {
        return JSON.parse(rawInput);
      } catch (error) {
        this.logger.warn(
          `Failed to parse tool input from string: ${rawInput}`,
        );
        return {};
      }
    }

    if (typeof rawInput === 'object') {
      return rawInput as Record<string, unknown>;
    }

    return {};
  }
}
