import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI, { APIUserAbortError } from 'openai';
import {
  ChatCompletionMessageParam,
  ChatCompletionContentPart,
} from 'openai/resources/chat/completions';
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
  ThinkingContentBlock,
} from '@bytebot/shared';
import { Message, Role } from '@prisma/client';
import { proxyTools } from './proxy.tools';
import {
  BytebotAgentService,
  BytebotAgentInterrupt,
  BytebotAgentResponse,
} from '../agent/agent.types';

@Injectable()
export class ProxyService implements BytebotAgentService {
  private readonly openai: OpenAI;
  private readonly logger = new Logger(ProxyService.name);
  private readonly toolNames = new Set(
    proxyTools
      .map((tool) =>
        tool.type === 'function' ? tool.function.name : undefined,
      )
      .filter((name): name is string => Boolean(name)),
  );

  constructor(private readonly configService: ConfigService) {
    const proxyUrl = this.configService.get<string>('BYTEBOT_LLM_PROXY_URL');

    if (!proxyUrl) {
      this.logger.warn(
        'BYTEBOT_LLM_PROXY_URL is not set. ProxyService will not work properly.',
      );
    }

    // Initialize OpenAI client with proxy configuration
    this.openai = new OpenAI({
      apiKey: 'dummy-key-for-proxy',
      baseURL: proxyUrl,
    });
  }

  /**
   * Main method to generate messages using the Chat Completions API
   */
  async generateMessage(
    systemPrompt: string,
    messages: Message[],
    model: string,
    useTools: boolean = true,
    signal?: AbortSignal,
  ): Promise<BytebotAgentResponse> {
    // Convert messages to Chat Completion format
    const chatMessages = this.formatMessagesForChatCompletion(
      systemPrompt,
      messages,
    );
    try {
      // Prepare the Chat Completion request
      const completionRequest: OpenAI.Chat.ChatCompletionCreateParams = {
        model,
        messages: chatMessages,
        max_tokens: 8192,
        ...(useTools && { tools: proxyTools }),
        reasoning_effort: 'high',
      };

      // Make the API call
      const completion = await this.openai.chat.completions.create(
        completionRequest,
        { signal },
      );

      // Process the response
      const choice = completion.choices[0];
      if (!choice || !choice.message) {
        throw new Error('No valid response from Chat Completion API');
      }

      // Convert response to MessageContentBlocks
      const contentBlocks = this.formatChatCompletionResponse(choice.message);

      return {
        contentBlocks,
        tokenUsage: {
          inputTokens: completion.usage?.prompt_tokens || 0,
          outputTokens: completion.usage?.completion_tokens || 0,
          totalTokens: completion.usage?.total_tokens || 0,
        },
      };
    } catch (error: any) {
      if (error instanceof APIUserAbortError) {
        this.logger.log('Chat Completion API call aborted');
        throw new BytebotAgentInterrupt();
      }

      this.logger.error(
        `Error sending message to proxy: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Convert Bytebot messages to Chat Completion format
   */
  private formatMessagesForChatCompletion(
    systemPrompt: string,
    messages: Message[],
  ): ChatCompletionMessageParam[] {
    const chatMessages: ChatCompletionMessageParam[] = [];

    // Add system message
    chatMessages.push({
      role: 'system',
      content: systemPrompt,
    });

    // Process each message
    for (const message of messages) {
      const messageContentBlocks = message.content as MessageContentBlock[];

      // Handle user actions specially
      if (
        messageContentBlocks.every((block) => isUserActionContentBlock(block))
      ) {
        const userActionBlocks = messageContentBlocks.flatMap(
          (block) => block.content,
        );

        for (const block of userActionBlocks) {
          if (isComputerToolUseContentBlock(block)) {
            chatMessages.push({
              role: 'user',
              content: `User performed action: ${block.name}\n${JSON.stringify(
                block.input,
                null,
                2,
              )}`,
            });
          } else if (isImageContentBlock(block)) {
            chatMessages.push(
              this.createImageMessage('user', block as ImageContentBlock),
            );
          }
        }
      } else {
        for (const block of messageContentBlocks) {
          switch (block.type) {
            case MessageContentType.Text: {
              chatMessages.push({
                role: message.role === Role.USER ? 'user' : 'assistant',
                content: block.text,
              });
              break;
            }
            case MessageContentType.Image: {
              const imageBlock = block;
              chatMessages.push(this.createImageMessage('user', imageBlock));
              break;
            }
            case MessageContentType.ToolUse: {
              const toolBlock = block as ToolUseContentBlock;
              chatMessages.push({
                role: 'assistant',
                content: '',
                tool_calls: [
                  {
                    id: toolBlock.id,
                    type: 'function',
                    function: {
                      name: toolBlock.name,
                      arguments: JSON.stringify(toolBlock.input ?? {}),
                    },
                  },
                ],
              });
              break;
            }
            case MessageContentType.Thinking: {
              const thinkingBlock = block;
              const message: ChatCompletionMessageParam = {
                role: 'assistant',
                content: null,
              };
              message['reasoning_content'] = thinkingBlock.thinking;
              chatMessages.push(message);
              break;
            }
            case MessageContentType.ToolResult: {
              const toolResultBlock = block;
              const textOutputs = toolResultBlock.content
                .filter((content) => content.type === MessageContentType.Text)
                .map((content) => content.text)
                .filter((text) => text.trim().length > 0);
              const imageContents = toolResultBlock.content.filter(
                (content) => content.type === MessageContentType.Image,
              );

              const toolContent = textOutputs.join('\n').trim();
              chatMessages.push({
                role: 'tool',
                tool_call_id: toolResultBlock.tool_use_id,
                content: toolContent.length > 0 ? toolContent : ' ',
              });

              imageContents.forEach((imageContent) => {
                chatMessages.push(
                  this.createImageMessage('user', imageContent),
                );
              });
              break;
            }
          }
        }
      }
    }

    return chatMessages;
  }

  /**
   * Convert Chat Completion response to MessageContentBlocks
   */
  private formatChatCompletionResponse(
    message: OpenAI.Chat.ChatCompletionMessage,
  ): MessageContentBlock[] {
    const contentBlocks: MessageContentBlock[] = [];
    const parsedToolCallIds = new Set<string>();

    if (Array.isArray(message.content)) {
      const textParts: string[] = [];

      message.content.forEach((part) => {
        const candidate = part as ChatCompletionContentPart & {
          text?: string;
          id?: string;
          name?: string;
          input?: unknown;
          arguments?: unknown;
          type?: string;
        };

        if (
          candidate &&
          typeof candidate.text === 'string' &&
          candidate.text.trim().length > 0
        ) {
          textParts.push(candidate.text.trim());
        }

        if (candidate && 'id' in candidate && 'name' in candidate) {
          const toolId =
            (candidate as any).id ||
            `proxy-inline-tool-${parsedToolCallIds.size + contentBlocks.length + 1}`;
          const toolInput = this.parseToolInput(
            (candidate as any).input ?? (candidate as any).arguments,
          );
          if (
            typeof (candidate as any).name === 'string' &&
            (candidate as any).name.length > 0
          ) {
            contentBlocks.push({
              type: MessageContentType.ToolUse,
              id: toolId,
              name: (candidate as any).name,
              input: toolInput,
            } as ToolUseContentBlock);
            parsedToolCallIds.add(toolId);
          }
        } else if (
          candidate &&
          candidate.type === 'text' &&
          typeof candidate.text === 'string' &&
          candidate.text.trim().length > 0
        ) {
          textParts.push(candidate.text.trim());
        }
      });

      if (textParts.length > 0) {
        contentBlocks.push({
          type: MessageContentType.Text,
          text: textParts.join('\n'),
        } as TextContentBlock);
      }
    } else if (
      typeof message.content === 'string' &&
      message.content.trim().length > 0
    ) {
      let remainingText = message.content;

      if (!message.tool_calls || message.tool_calls.length === 0) {
        const inlineToolResult = this.extractInlineToolCalls(
          remainingText,
          parsedToolCallIds,
        );
        remainingText = inlineToolResult.remainingText;
        inlineToolResult.toolBlocks.forEach((block) => {
          contentBlocks.push(block);
        });
      }

      if (remainingText.trim().length > 0) {
        contentBlocks.push({
          type: MessageContentType.Text,
          text: remainingText.trim(),
        } as TextContentBlock);
      }
    }

    if (message['reasoning_content']) {
      contentBlocks.push({
        type: MessageContentType.Thinking,
        thinking: message['reasoning_content'],
        signature: message['reasoning_content'],
      } as ThinkingContentBlock);
    }

    // Handle tool calls
    if (message.tool_calls && message.tool_calls.length > 0) {
      for (const toolCall of message.tool_calls) {
        if (toolCall.type === 'function') {
          if (parsedToolCallIds.has(toolCall.id)) {
            continue;
          }
          let parsedInput = {};
          try {
            parsedInput = JSON.parse(toolCall.function.arguments || '{}');
          } catch (e) {
            this.logger.warn(
              `Failed to parse tool call arguments: ${toolCall.function.arguments}`,
            );
            parsedInput = {};
          }

          contentBlocks.push({
            type: MessageContentType.ToolUse,
            id: toolCall.id,
            name: toolCall.function.name,
            input: parsedInput,
          } as ToolUseContentBlock);
          parsedToolCallIds.add(toolCall.id);
        }
      }
    }

    // Handle refusal
    if (message.refusal) {
      contentBlocks.push({
        type: MessageContentType.Text,
        text: `Refusal: ${message.refusal}`,
      } as TextContentBlock);
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
        this.logger.warn(`Failed to parse tool input from string: ${rawInput}`);
        return {};
      }
    }

    if (typeof rawInput === 'object') {
      return rawInput as Record<string, unknown>;
    }

    return {};
  }

  private createImageMessage(
    role: 'user' | 'assistant',
    image: ImageContentBlock,
  ): ChatCompletionMessageParam {
    return {
      role: role === 'user' ? 'user' : 'assistant',
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${image.source.media_type};base64,${image.source.data}`,
            detail: 'high',
          },
        },
      ],
    } as ChatCompletionMessageParam;
  }

  private extractInlineToolCalls(
    text: string,
    parsedToolCallIds: Set<string>,
  ): { remainingText: string; toolBlocks: ToolUseContentBlock[] } {
    let remaining = text;
    const toolBlocks: ToolUseContentBlock[] = [];

    for (const toolName of this.toolNames) {
      let searchIndex = 0;

      while (searchIndex < remaining.length) {
        const invocationIndex = remaining.indexOf(`${toolName}(`, searchIndex);
        if (invocationIndex === -1) {
          break;
        }

        const argsStart = remaining.indexOf('{', invocationIndex);
        if (argsStart === -1) {
          searchIndex = invocationIndex + toolName.length;
          continue;
        }

        const argsEnd = this.findMatchingClosingBrace(remaining, argsStart);
        if (argsEnd === -1) {
          searchIndex = invocationIndex + toolName.length;
          continue;
        }

        const closingParenIndex = remaining.indexOf(')', argsEnd);
        if (closingParenIndex === -1) {
          searchIndex = invocationIndex + toolName.length;
          continue;
        }

        const rawArguments = remaining.slice(argsStart, argsEnd + 1);
        const parsedArguments = this.tryParseJson(rawArguments);

        if (!parsedArguments) {
          searchIndex = invocationIndex + toolName.length;
          continue;
        }

        const toolId = `inline-tool-${parsedToolCallIds.size + toolBlocks.length + 1}`;
        toolBlocks.push({
          type: MessageContentType.ToolUse,
          id: toolId,
          name: toolName,
          input: parsedArguments,
        } as ToolUseContentBlock);
        parsedToolCallIds.add(toolId);

        remaining =
          remaining.slice(0, invocationIndex) +
          remaining.slice(closingParenIndex + 1);
        searchIndex = invocationIndex;
      }
    }

    return {
      remainingText: remaining.trim(),
      toolBlocks,
    };
  }

  private findMatchingClosingBrace(text: string, startIndex: number): number {
    let depth = 0;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;

        if (depth === 0) {
          return i;
        }
      }
    }

    return -1;
  }

  private tryParseJson(raw: string): Record<string, unknown> | null {
    try {
      return JSON.parse(raw);
    } catch (error) {
      this.logger.debug(
        `Failed to parse inline tool call arguments: ${raw}. ${(error as Error).message}`,
      );
      return null;
    }
  }
}
