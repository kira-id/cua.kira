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
import { DEFAULT_MODEL, OPENROUTER_MODELS } from './openrouter.constants';
import { Message, Role } from '@prisma/client';
import { openrouterTools } from './openrouter.tools';
import {
  BytebotAgentService,
  BytebotAgentInterrupt,
  BytebotAgentResponse,
} from '../agent/agent.types';
import { BaseProvider } from '../providers/base-provider.interface';
import { RateLimitError } from '../shared/errors';
import { extractInlineToolCalls } from '@bytebot/shared';
import { toolSchemas } from '../agent/agent.tools';

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
  private readonly toolNames = new Set(
    openrouterTools.map((tool) => tool.function.name),
  );

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
      this.logger.debug(
        `OpenRouter send called with params: ${this.serializeForLog({
          systemPrompt,
          model,
          useTools,
          hasSignal: Boolean(signal),
        })}`,
      );
      this.logger.debug(
        `Raw messages input: ${this.serializeForLog(messages)}`,
      );

      const openrouterMessages = this.formatMessagesForOpenRouter(
        systemPrompt,
        messages,
      );

      const maxTokens = 8192;
      const body: any = {
        model,
        messages: openrouterMessages,
        max_tokens: maxTokens,
        temperature: 0.7,
      };

      if (useTools) {
        body.tools = openrouterTools;
        body.tool_choice = 'auto';
      } else {
        this.logger.debug(`[DEBUG] OpenRouter tools disabled for this request`);
      }

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://kira.id',
          'X-Title': 'Kira.id Agent',
        },
        body: JSON.stringify(body),
        signal,
      });

      this.logger.debug(
        `OpenRouter response status: ${response.status} ${response.statusText}`,
      );
      if (response.headers && typeof response.headers.entries === 'function') {
        this.logger.debug(
          `OpenRouter response headers: ${this.serializeForLog(
            Object.fromEntries(response.headers.entries()),
          )}`,
        );
      } else {
        this.logger.debug('OpenRouter response headers: <unavailable in mock>');
      }

      if (!response.ok) {
        if (response.status === 429) {
          throw new RateLimitError('Rate limit exceeded');
        }
        throw new Error(
          `OpenRouter API error: ${response.status} ${response.statusText}`,
        );
      }

      const data: OpenRouterResponse = await response.json();

      this.logger.debug(
        `OpenRouter response body: ${this.serializeForLog(data)}`,
      );

      // Check for zero completion_tokens and handle appropriately
      if (data.usage && data.usage.completion_tokens === 0) {
        this.handleZeroCompletionTokens(data);
      }

      const contentBlocks = this.formatOpenRouterResponse(data);

      this.logger.debug(
        `Formatted content blocks: ${this.serializeForLog(contentBlocks)}`,
      );

      // Debug: Check for tool calls in the response
      const hasToolCalls =
        data.choices?.[0]?.message?.tool_calls?.length &&
        data.choices[0].message.tool_calls.length > 0;
      this.logger.debug(
        `[DEBUG] OpenRouter response has tool calls: ${hasToolCalls}`,
      );
      if (hasToolCalls) {
        this.logger.debug(
          `[DEBUG] Tool calls received: ${this.serializeForLog(data.choices[0].message.tool_calls)}`,
        );

        // Special logging for click_mouse tool calls
        const toolCalls = data.choices[0].message.tool_calls;
        if (toolCalls) {
          const clickMouseCalls = toolCalls.filter(
            (call) => call.function.name === 'computer_click_mouse',
          );
          if (clickMouseCalls.length > 0) {
            this.logger.debug(
              `[CLICK DEBUG] Found ${clickMouseCalls.length} click_mouse tool calls`,
            );
            clickMouseCalls.forEach((call) => {
              this.logger.debug(
                `[CLICK DEBUG] Raw click_mouse call: ${this.serializeForLog(call)}`,
              );
            });
          }
        }
      }

      this.logger.debug(
        `Token usage summary: ${this.serializeForLog(data.usage)}`,
      );

      if (contentBlocks.length === 0) {
        this.logger.warn(
          'OpenRouter returned an empty response with no content blocks or tool calls.',
        );

        if (useTools) {
          this.logger.warn(
            'Retrying OpenRouter request without tools due to empty response.',
          );
          return this.send(systemPrompt, messages, model, false, signal);
        }

        throw new Error(
          'OpenRouter returned an empty response without content or tool calls.',
        );
      }

      return {
        contentBlocks,
        tokenUsage: {
          inputTokens: data.usage?.prompt_tokens || 0,
          outputTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0,
        },
      };
    } catch (error: any) {
      this.logger.error(
        `Error sending message to OpenRouter: ${error.message}`,
        {
          error: error.message,
          stack: error.stack,
          model,
          useTools,
          systemPromptLength: systemPrompt.length,
          messagesCount: messages.length,
          taskId: messages.length > 0 ? messages[0].taskId : 'unknown',
          toolNames: useTools
            ? openrouterTools.map((t) => t.function.name)
            : [],
          timestamp: new Date().toISOString(),
        },
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
          'HTTP-Referer': 'https://kira.id',
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
          'HTTP-Referer': 'https://kira.id',
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
            openrouterMessages.push(
              this.createImageMessage('user', block as ImageContentBlock),
            );
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
            const imageBlock = block;
            openrouterMessages.push(
              this.createImageMessage(
                message.role === Role.USER ? 'user' : 'assistant',
                imageBlock,
              ),
            );
            break;
          }
          case MessageContentType.ToolUse: {
            if (message.role === Role.ASSISTANT) {
              const toolBlock = block as ToolUseContentBlock;
              openrouterMessages.push({
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
            }
            break;
          }
          case MessageContentType.ToolResult: {
            const toolResult = block;
            const textOutputs = toolResult.content
              .filter((content) => content.type === MessageContentType.Text)
              .map((content) => content.text)
              .filter((text) => text.trim().length > 0);
            const imageContents = toolResult.content.filter(
              (content) => content.type === MessageContentType.Image,
            );

            const toolContent = textOutputs.join('\n').trim();
            openrouterMessages.push({
              role: 'tool',
              tool_call_id: toolResult.tool_use_id,
              content: toolContent,
            });

            imageContents.forEach((imageContent) => {
              openrouterMessages.push(
                this.createImageMessage('user', imageContent),
              );
            });
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

    this.logger.debug(
      `[DEBUG] formatOpenRouterResponse called with ${response.choices?.length || 0} choices`,
    );

    if (response.choices && response.choices.length > 0) {
      const choice = response.choices[0];
      const message = choice.message;

      this.logger.debug(
        `[DEBUG] Processing choice with message content type: ${typeof message.content}`,
      );
      this.logger.debug(
        `[DEBUG] Message has tool_calls: ${!!message.tool_calls}`,
      );

      // Handle text content
      if (message.content) {
        if (Array.isArray(message.content)) {
          const textParts: string[] = [];
          const toolUseBlocksFromContent: ToolUseContentBlock[] = [];

          for (const part of message.content) {
            if (
              (part.type === 'text' || part.type === 'output_text') &&
              typeof part.text === 'string' &&
              part.text.trim().length > 0
            ) {
              textParts.push(part.text);
            }

            if (
              part.type === 'tool_use' ||
              part.type === 'function_call' ||
              part.type === 'function'
            ) {
              const toolUseId =
                part.id || `openrouter-tool-${parsedToolCallIds.size + 1}`;
              parsedToolCallIds.add(toolUseId);

              const toolInput = this.parseToolInput(
                part.input ?? part.arguments,
              );
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
      }

      // Handle tool calls
      if (message.tool_calls && message.tool_calls.length > 0) {
        this.logger.debug(
          `[TOOL CALL DEBUG] Processing ${message.tool_calls.length} tool calls`,
        );
        for (const toolCall of message.tool_calls) {
          if (parsedToolCallIds.has(toolCall.id)) {
            this.logger.debug(
              `[TOOL CALL DEBUG] Tool call ${toolCall.id} already processed, skipping`,
            );
            continue;
          }

          let parsedArguments: Record<string, unknown> = {};
          try {
            const rawArgs = toolCall.function.arguments;
            this.logger.debug(
              `[TOOL CALL DEBUG] Parsing arguments for ${toolCall.function.name}: ${rawArgs}`,
            );
            parsedArguments = toolCall.function.arguments
              ? JSON.parse(toolCall.function.arguments)
              : {};
            this.logger.debug(
              `[TOOL CALL DEBUG] Parsed arguments: ${JSON.stringify(parsedArguments)}`,
            );
          } catch (error) {
            this.logger.warn(
              `Failed to parse tool call arguments for ${toolCall.function.name}: ${toolCall.function.arguments}`,
            );
            this.logger.warn(
              `[TOOL CALL DEBUG] Parse error: ${(error as Error).message}`,
            );
          }

          // Special validation for click_mouse tool calls
          if (toolCall.function.name === 'computer_click_mouse') {
            this.logger.debug(
              `[TOOL CALL DEBUG] Validating click_mouse parameters`,
            );
            const coordinates = parsedArguments.coordinates as any;
            const button = parsedArguments.button;

            if (coordinates) {
              if (
                typeof coordinates.x !== 'number' ||
                typeof coordinates.y !== 'number'
              ) {
                this.logger.error(
                  `[TOOL CALL DEBUG] Invalid coordinates in click_mouse: x=${coordinates.x}, y=${coordinates.y}`,
                );
                // Try to fix if they're strings
                if (
                  typeof coordinates.x === 'string' &&
                  typeof coordinates.y === 'string'
                ) {
                  (parsedArguments.coordinates as any).x = parseFloat(
                    coordinates.x,
                  );
                  (parsedArguments.coordinates as any).y = parseFloat(
                    coordinates.y,
                  );
                  this.logger.debug(
                    `[TOOL CALL DEBUG] Fixed coordinates: x=${(parsedArguments.coordinates as any).x}, y=${(parsedArguments.coordinates as any).y}`,
                  );
                }
              } else {
                this.logger.debug(
                  `[TOOL CALL DEBUG] Coordinates valid: x=${coordinates.x}, y=${coordinates.y}`,
                );
              }
            } else {
              this.logger.debug(
                `[TOOL CALL DEBUG] No coordinates provided (using current position)`,
              );
            }

            this.logger.debug(
              `[TOOL CALL DEBUG] Button: ${button}, clickCount: ${parsedArguments.clickCount}`,
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
  ): OpenRouterMessage {
    return {
      role,
      content: [
        {
          type: 'image_url',
          image_url: {
            url: `data:${image.source.media_type};base64,${image.source.data}`,
            detail: 'high',
          },
        },
      ],
    };
  }

  private extractInlineToolCalls(
    text: string,
    parsedToolCallIds: Set<string>,
  ): { remainingText: string; toolBlocks: ToolUseContentBlock[] } {
    return extractInlineToolCalls(text, this.toolNames, parsedToolCallIds, toolSchemas);
  }

  private handleZeroCompletionTokens(data: OpenRouterResponse): void {
    const choice = data.choices?.[0];
    const message = choice?.message;

    // Check for tool-call only response
    if (message?.tool_calls && message.tool_calls.length > 0) {
      this.logger.warn(
        'Zero completion_tokens detected: Tool-call only response. This is normal behavior - OpenRouter does not count tool arguments as completion tokens.',
      );
      return;
    }

    // Check for empty content
    const hasContent =
      (typeof message?.content === 'string' &&
        message.content.trim().length > 0) ||
      (Array.isArray(message?.content) &&
        message.content.some(
          (part) =>
            typeof part.text === 'string' && part.text.trim().length > 0,
        ));

    if (!hasContent) {
      this.logger.warn(
        'Zero completion_tokens detected: Truly empty assistant message. Possible causes: brittle stop strings, invalid response_format/JSON schema, too small max_output_tokens, or model safety/guardrail silently blanking output.',
      );
      return;
    }

    // Check for streaming aggregation loss (though this is less likely in non-streaming mode)
    this.logger.warn(
      'Zero completion_tokens detected: Unknown cause. May be due to streaming aggregation loss or provider/model quirk with tool_choice:"required".',
    );
  }

  private serializeForLog(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch (error) {
      if (error instanceof Error) {
        return `Failed to serialize value for log: ${error.message}`;
      }
      return 'Failed to serialize value for log';
    }
  }
}
