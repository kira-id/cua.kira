// Utility functions for message content parsing and validation

import {
  MessageContentType,
  ToolUseContentBlock,
  MessageContentBlock,
  TextContentBlock,
  ImageContentBlock,
  ToolResultContentBlock,
  ThinkingContentBlock,
  RedactedThinkingContentBlock,
  UserActionContentBlock,
  ComputerToolUseContentBlock,
  TypeKeysToolUseBlock,
  PressKeysToolUseBlock,
  TypeTextToolUseBlock,
  WaitToolUseBlock,
  ScrollToolUseBlock,
  ApplicationToolUseBlock,
  PasteTextToolUseBlock,
  ReadFileToolUseBlock,
  CursorPositionToolUseBlock,
  MoveMouseToolUseBlock,
  ScreenshotToolUseBlock,
  ClickMouseToolUseBlock,
  DragMouseToolUseBlock,
  PressMouseToolUseBlock,
  TraceMouseToolUseBlock,
  SetTaskStatusToolUseBlock,
  CreateTaskToolUseBlock,
} from '../types/messageContent.types';

// Simple logger shim for shared utils
const logger = {
  debug: (message: string) => {
    console.debug(`[MessageContentUtils] ${message}`);
  },
  warn: (message: string) => {
    console.warn(`[MessageContentUtils] ${message}`);
  },
};

/**
 * Interface for parsed tool call result
 */
export interface ParsedToolCall {
  remainingText: string;
  toolBlocks: ToolUseContentBlock[];
}

/**
 * Comprehensive tool call parsing from text, supporting multiple formats:
 * - computer_click_mouse({x: 100, y: 200})
 * - computer_click_mouse({"x": 100, "y": 200})
 * - computer_click_mouse(x=100, y=200) - Python-style
 * - Tool: computer_click_mouse with args: {x: 100, y: 200}
 */
export function parseToolCallsFromText(
  text: string,
  toolNames: Set<string>,
  parsedToolCallIds: Set<string>
): ParsedToolCall {
  let remaining = text;
  const toolBlocks: ToolUseContentBlock[] = [];

  // Pattern 1: Function call syntax - toolName(args)
  const functionCallPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([^)]*)\s*\)/g;

  // Pattern 2: Python-style function calls - toolName(arg=value, ...)
  const pythonCallPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*([^)]*)\s*\)/g;

  // Pattern 3: Natural language tool calls - "Tool: toolName with args: {...}"
  const naturalLanguagePattern = /Tool:\s*([a-zA-Z_][a-zA-Z0-9_]*).*?args?:\s*(\{[^}]*\})/gi;

  // Process all patterns
  const patterns = [functionCallPattern, pythonCallPattern, naturalLanguagePattern];

  for (const pattern of patterns) {
    let match;
    let searchOffset = 0;

    while ((match = pattern.exec(remaining)) !== null) {
      const toolName = match[1];
      let argsString = match[2];

      // Skip if not a valid tool name
      if (!toolNames.has(toolName)) {
        searchOffset = match.index + match[0].length;
        continue;
      }

      let parsedArgs: Record<string, unknown> | null = null;

      // Try to parse arguments based on pattern
      if (pattern === naturalLanguagePattern) {
        // Natural language format - argsString is already the JSON part
        parsedArgs = parseJsonArgs(argsString);
      } else if (pattern === pythonCallPattern && argsString.includes('=')) {
        // Python-style arguments
        parsedArgs = parsePythonArgs(argsString);
      } else {
        // Standard JSON arguments
        parsedArgs = parseJsonArgs(argsString);
      }

      if (!parsedArgs) {
        logger.debug(`Failed to parse arguments for tool ${toolName}: ${argsString}`);
        searchOffset = match.index + match[0].length;
        continue;
      }

      // Create tool block
      const toolId = `inline-tool-${parsedToolCallIds.size + toolBlocks.length + 1}`;
      toolBlocks.push({
        type: MessageContentType.ToolUse,
        id: toolId,
        name: toolName,
        input: parsedArgs,
      } as ToolUseContentBlock);

      parsedToolCallIds.add(toolId);

      // Remove the tool call from remaining text
      remaining =
        remaining.slice(0, match.index) +
        remaining.slice(match.index + match[0].length);

      // Reset pattern lastIndex since we modified the string
      pattern.lastIndex = match.index;
    }
  }

  return {
    remainingText: remaining.trim(),
    toolBlocks,
  };
}

/**
 * Parse JSON-style arguments
 */
function parseJsonArgs(argsString: string): Record<string, unknown> | null {
  try {
    // Handle both single quotes and double quotes
    let jsonString = argsString.trim();

    // Convert single quotes to double quotes for valid JSON
    jsonString = jsonString.replace(/'/g, '"');

    // Handle unquoted keys
    jsonString = jsonString.replace(/([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '"$1":');

    return JSON.parse(jsonString);
  } catch (error) {
    logger.debug(`JSON parse failed for: ${argsString}, error: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Parse Python-style arguments (key=value, key2=value2)
 */
function parsePythonArgs(argsString: string): Record<string, unknown> | null {
  try {
    const result: Record<string, unknown> = {};
    const pairs = argsString.split(',').map(pair => pair.trim());

    for (const pair of pairs) {
      if (!pair) continue;

      const [key, ...valueParts] = pair.split('=');
      if (!key || valueParts.length === 0) continue;

      const keyName = key.trim();
      const valueString = valueParts.join('=').trim();

      // Try to parse as JSON first, then fallback to string
      try {
        result[keyName] = JSON.parse(valueString);
      } catch {
        // Remove quotes if present
        let cleanValue = valueString;
        if ((cleanValue.startsWith('"') && cleanValue.endsWith('"')) ||
            (cleanValue.startsWith("'") && cleanValue.endsWith("'"))) {
          cleanValue = cleanValue.slice(1, -1);
        }
        result[keyName] = cleanValue;
      }
    }

    return result;
  } catch (error) {
    logger.debug(`Python args parse failed for: ${argsString}, error: ${(error as Error).message}`);
    return null;
  }
}

/**
 * Validate tool arguments against expected schema
 */
export function validateToolArguments(
  toolName: string,
  args: Record<string, unknown>,
  toolSchemas: Record<string, any>
): boolean {
  const schema = toolSchemas[toolName];
  if (!schema) {
    logger.warn(`No schema found for tool: ${toolName}`);
    return false;
  }

  // Basic validation for required fields
  if (schema.required) {
    for (const required of schema.required) {
      if (!(required in args)) {
        logger.warn(`Missing required argument '${required}' for tool ${toolName}`);
        return false;
      }
    }
  }

  // Type validation
  if (schema.properties) {
    for (const [key, value] of Object.entries(args)) {
      const propSchema = schema.properties[key];
      if (!propSchema) {
        logger.warn(`Unknown argument '${key}' for tool ${toolName}`);
        continue; // Allow unknown args but warn
      }

      if (!validateArgumentType(value, propSchema)) {
        logger.warn(`Invalid type for argument '${key}' in tool ${toolName}`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Validate individual argument type
 */
function validateArgumentType(value: unknown, schema: any): boolean {
  const { type, enum: enumValues } = schema;

  // Check enum first
  if (enumValues && Array.isArray(enumValues)) {
    return enumValues.includes(value);
  }

  // Type checking
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    default:
      return true; // Allow unknown types
  }
}

/**
 * Sanitize and normalize tool arguments
 */
export function sanitizeToolArguments(args: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    // Convert string numbers to actual numbers
    if (typeof value === 'string') {
      const numValue = Number(value);
      if (!isNaN(numValue) && value.trim() === numValue.toString()) {
        sanitized[key] = numValue;
        continue;
      }

      // Convert string booleans
      if (value.toLowerCase() === 'true') {
        sanitized[key] = true;
        continue;
      }
      if (value.toLowerCase() === 'false') {
        sanitized[key] = false;
        continue;
      }
    }

    sanitized[key] = value;
  }

  return sanitized;
}

// Legacy function for backward compatibility - use extractInlineToolCalls instead
export function extractInlineToolCallsLegacy(
  text: string,
  toolNames: Set<string>,
  parsedToolCallIds: Set<string>
): ParsedToolCall {
  return extractInlineToolCalls(text, toolNames, parsedToolCallIds);
}

/**
 * Enhanced inline tool call extraction with validation
 */
export function extractInlineToolCalls(
  text: string,
  toolNames: Set<string>,
  parsedToolCallIds: Set<string>,
  toolSchemas?: Record<string, any>
): ParsedToolCall {
  const result = parseToolCallsFromText(text, toolNames, parsedToolCallIds);

  // Validate and sanitize each tool call
  const validToolBlocks: ToolUseContentBlock[] = [];

  for (const toolBlock of result.toolBlocks) {
    let sanitizedArgs = sanitizeToolArguments(toolBlock.input);

    // Validate if schemas are provided
    if (toolSchemas && !validateToolArguments(toolBlock.name, sanitizedArgs, toolSchemas)) {
      logger.warn(`Invalid arguments for tool ${toolBlock.name}, skipping: ${JSON.stringify(sanitizedArgs)}`);
      continue;
    }

    validToolBlocks.push({
      ...toolBlock,
      input: sanitizedArgs,
    });
  }

  return {
    remainingText: result.remainingText,
    toolBlocks: validToolBlocks,
  };
}

// Type guards for message content blocks

/**
 * Type guard for TextContentBlock
 */
export function isTextContentBlock(block: MessageContentBlock): block is TextContentBlock {
  return block.type === MessageContentType.Text;
}

/**
 * Type guard for ImageContentBlock
 */
export function isImageContentBlock(block: MessageContentBlock): block is ImageContentBlock {
  return block.type === MessageContentType.Image;
}

/**
 * Type guard for ToolUseContentBlock
 */
export function isToolUseContentBlock(block: MessageContentBlock): block is ToolUseContentBlock {
  return block.type === MessageContentType.ToolUse;
}

/**
 * Type guard for ToolResultContentBlock
 */
export function isToolResultContentBlock(block: MessageContentBlock): block is ToolResultContentBlock {
  return block.type === MessageContentType.ToolResult;
}

/**
 * Type guard for ThinkingContentBlock
 */
export function isThinkingContentBlock(block: MessageContentBlock): block is ThinkingContentBlock {
  return block.type === MessageContentType.Thinking;
}

/**
 * Type guard for RedactedThinkingContentBlock
 */
export function isRedactedThinkingContentBlock(block: MessageContentBlock): block is RedactedThinkingContentBlock {
  return block.type === MessageContentType.RedactedThinking;
}

/**
 * Type guard for UserActionContentBlock
 */
export function isUserActionContentBlock(block: MessageContentBlock): block is UserActionContentBlock {
  return block.type === MessageContentType.UserAction;
}

/**
 * Type guard for ComputerToolUseContentBlock
 */
export function isComputerToolUseContentBlock(block: MessageContentBlock): block is ComputerToolUseContentBlock {
  return block.type === MessageContentType.ToolUse && (
    block.name.startsWith('computer_') ||
    block.name === 'set_task_status' ||
    block.name === 'create_task'
  );
}

/**
 * Type guard for SetTaskStatusToolUseBlock
 */
export function isSetTaskStatusToolUseBlock(block: MessageContentBlock): block is SetTaskStatusToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'set_task_status';
}

/**
 * Type guard for CreateTaskToolUseBlock
 */
export function isCreateTaskToolUseBlock(block: MessageContentBlock): block is CreateTaskToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'create_task';
}

/**
 * Type guard for TypeKeysToolUseBlock
 */
export function isTypeKeysToolUseBlock(block: MessageContentBlock): block is TypeKeysToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_type_keys';
}

/**
 * Type guard for PressKeysToolUseBlock
 */
export function isPressKeysToolUseBlock(block: MessageContentBlock): block is PressKeysToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_press_keys';
}

/**
 * Type guard for TypeTextToolUseBlock
 */
export function isTypeTextToolUseBlock(block: MessageContentBlock): block is TypeTextToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_type_text';
}

/**
 * Type guard for WaitToolUseBlock
 */
/**
 * Type guard for ScrollToolUseBlock
 */
/**
 * Type guard for ApplicationToolUseBlock
 */
/**
 * Type guard for PasteTextToolUseBlock
 */
/**
 * Type guard for ReadFileToolUseBlock
 */
/**
 * Type guard for CursorPositionToolUseBlock
 */
/**
 * Type guard for MoveMouseToolUseBlock
 */
/**
 * Type guard for ScreenshotToolUseBlock
 */
/**
 * Type guard for ClickMouseToolUseBlock
 */
/**
 * Type guard for DragMouseToolUseBlock
 */
/**
 * Type guard for PressMouseToolUseBlock
 */
/**
 * Type guard for TraceMouseToolUseBlock
 */
export function isTraceMouseToolUseBlock(block: MessageContentBlock): block is TraceMouseToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_trace_mouse';
}
export function isPressMouseToolUseBlock(block: MessageContentBlock): block is PressMouseToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_press_mouse';
}
export function isDragMouseToolUseBlock(block: MessageContentBlock): block is DragMouseToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_drag_mouse';
}
export function isClickMouseToolUseBlock(block: MessageContentBlock): block is ClickMouseToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_click_mouse';
}
export function isScreenshotToolUseBlock(block: MessageContentBlock): block is ScreenshotToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_screenshot';
}
export function isMoveMouseToolUseBlock(block: MessageContentBlock): block is MoveMouseToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_move_mouse';
}
export function isCursorPositionToolUseBlock(block: MessageContentBlock): block is CursorPositionToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_cursor_position';
}
export function isReadFileToolUseBlock(block: MessageContentBlock): block is ReadFileToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_read_file';
}
export function isPasteTextToolUseBlock(block: MessageContentBlock): block is PasteTextToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_paste_text';
}
export function isApplicationToolUseBlock(block: MessageContentBlock): block is ApplicationToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_application';
}
export function isScrollToolUseBlock(block: MessageContentBlock): block is ScrollToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_scroll';
}
export function isWaitToolUseBlock(block: MessageContentBlock): block is WaitToolUseBlock {
  return block.type === MessageContentType.ToolUse && block.name === 'computer_wait';
}
