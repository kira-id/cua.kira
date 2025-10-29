import { Message } from "@/types";
import {
  ImageMediaType,
  Coordinates,
  isToolResultContentBlock,
  isImageContentBlock,
  isComputerToolUseContentBlock,
  isMoveMouseToolUseBlock,
  isTraceMouseToolUseBlock,
  isClickMouseToolUseBlock,
  isDragMouseToolUseBlock,
  isScrollToolUseBlock,
  isTextContentBlock,
  ComputerToolUseContentBlock,
} from "@bytebot/shared";

export interface ScreenshotData {
  id: string;
  base64Data: string;
  mediaType: ImageMediaType;
  messageIndex: number;
  blockIndex: number;
  contentIndex: number;
  cursor?: Coordinates | null;
}

/**
 * Extracts all screenshots from messages
 */
export function extractScreenshots(messages: Message[]): ScreenshotData[] {
  const screenshots: ScreenshotData[] = [];
  const pendingCursorRequests = new Set<string>();
  let lastCursorPosition: Coordinates | null = null;

  const updateCursorFromToolUse = (
    blockCoordinates?: Coordinates | null,
  ): void => {
    if (!blockCoordinates) {
      return;
    }
    lastCursorPosition = { ...blockCoordinates };
  };

  const extractCoordinatesFromToolUse = (
    toolBlock: ComputerToolUseContentBlock,
  ): Coordinates | null => {
    if (isMoveMouseToolUseBlock(toolBlock)) {
      return toolBlock.input.coordinates ?? null;
    }

    if (isClickMouseToolUseBlock(toolBlock)) {
      return toolBlock.input.coordinates ?? null;
    }

    if (
      isTraceMouseToolUseBlock(toolBlock) &&
      Array.isArray(toolBlock.input.path) &&
      toolBlock.input.path.length > 0
    ) {
      return toolBlock.input.path[toolBlock.input.path.length - 1] ?? null;
    }

    if (
      isDragMouseToolUseBlock(toolBlock) &&
      Array.isArray(toolBlock.input.path) &&
      toolBlock.input.path.length > 0
    ) {
      return toolBlock.input.path[toolBlock.input.path.length - 1] ?? null;
    }

    if (isScrollToolUseBlock(toolBlock)) {
      return toolBlock.input.coordinates ?? null;
    }

    return null;
  };

  const tryParseCursorText = (text: string): Coordinates | null => {
    // Try to match "Cursor position: X, Y" format
    const cursorPositionMatch = text.match(/Cursor position:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    if (cursorPositionMatch) {
      const [, xRaw, yRaw] = cursorPositionMatch;
      const x = Number.parseFloat(xRaw);
      const y = Number.parseFloat(yRaw);

      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return null;
      }

      return { x, y };
    }

    // Fallback to general coordinate parsing
    const match = text.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/);
    if (!match) {
      return null;
    }

    const [, xRaw, yRaw] = match;
    const x = Number.parseFloat(xRaw);
    const y = Number.parseFloat(yRaw);

    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }

    return { x, y };
  };

  messages.forEach((message, messageIndex) => {
    message.content.forEach((block, blockIndex) => {
      if (isComputerToolUseContentBlock(block)) {
        if (block.name === "computer_cursor_position") {
          pendingCursorRequests.add(block.id);
        }

        updateCursorFromToolUse(extractCoordinatesFromToolUse(block));
      }

      // Check if this is a tool result block with images
      if (isToolResultContentBlock(block) && block.content && block.content.length > 0) {
        if (pendingCursorRequests.has(block.tool_use_id)) {
          const cursorFromResult = block.content
            .filter(isTextContentBlock)
            .map((contentItem) => tryParseCursorText(contentItem.text))
            .find((coords): coords is Coordinates => Boolean(coords));

          if (cursorFromResult) {
            updateCursorFromToolUse(cursorFromResult);
          } else {
            // Log when cursor position parsing fails for debugging
            const textContents = block.content
              .filter(isTextContentBlock)
              .map((contentItem) => contentItem.text);
            console.warn('Failed to parse cursor position from tool result:', textContents);
          }

          pendingCursorRequests.delete(block.tool_use_id);
        }

        // Check ALL content items in the tool result, not just the first one
        block.content.forEach((contentItem, contentIndex) => {
          if (isImageContentBlock(contentItem)) {
            screenshots.push({
              id: `${message.id}-${blockIndex}-${contentIndex}`,
              base64Data: contentItem.source.data,
              mediaType: contentItem.source.media_type,
              messageIndex,
              blockIndex,
              contentIndex,
              cursor: lastCursorPosition ? { ...lastCursorPosition } : null,
            });
          }
        });
      }
    });
  });
  return screenshots;
}

/**
 * Gets the screenshot that should be displayed based on scroll position
 */
export function getScreenshotForScrollPosition(
  screenshots: ScreenshotData[],
  messages: Message[],
  scrollContainer: HTMLElement | null
): ScreenshotData | null {
  if (!scrollContainer || screenshots.length === 0) {
    return screenshots[screenshots.length - 1] || null; // Default to last screenshot
  }

  // Get all screenshot marker elements in the scroll container
  const screenshotElements = scrollContainer.querySelectorAll('[data-message-index][data-block-index]');
  if (screenshotElements.length === 0) {
    return screenshots[screenshots.length - 1] || null;
  }
  const containerScrollTop = scrollContainer.scrollTop;
  const containerHeight = scrollContainer.clientHeight;

  // Find the screenshot marker that's most visible at 350px down from the top of the container
  const targetViewPosition = 350; // 350px down from top
  let bestVisibleMessageIndex = -1; // Start with -1 to detect when no markers are found
  let bestVisibleBlockIndex = -1;
  let bestVisibility = 0;
  let minDistanceFromTarget = Infinity;
  let lastMarkerMessageIndex = -1;
  let lastMarkerBlockIndex = -1;

  screenshotElements.forEach((element) => {
    const messageIndex = parseInt((element as HTMLElement).dataset.messageIndex || '0');
    const blockIndex = parseInt((element as HTMLElement).dataset.blockIndex || '0');
    const elementTop = (element as HTMLElement).offsetTop;
    const elementHeight = (element as HTMLElement).offsetHeight;
    const elementBottom = elementTop + elementHeight;
    
    // Keep track of the last (bottommost) marker
    if (messageIndex > lastMarkerMessageIndex || 
        (messageIndex === lastMarkerMessageIndex && blockIndex > lastMarkerBlockIndex)) {
      lastMarkerMessageIndex = messageIndex;
      lastMarkerBlockIndex = blockIndex;
    }
    
    // Distance from top of container (accounting for scroll)
    const distanceFromViewportTop = elementTop - containerScrollTop;
    const distanceFromViewportBottom = elementBottom - containerScrollTop;
    
    // Check if element is visible in viewport
    const isVisible = distanceFromViewportTop < containerHeight && 
                     distanceFromViewportBottom > 0;
    
    if (isVisible) {
      // Calculate how much of this element is visible
      const visibleTop = Math.max(0, distanceFromViewportTop);
      const visibleBottom = Math.min(containerHeight, distanceFromViewportBottom);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);
      const visibility = elementHeight === 0 ? 1 : visibleHeight / elementHeight;
      
      // Calculate distance from our target position (150px down)
      const elementCenter = distanceFromViewportTop + (elementHeight / 2);
      const distanceFromTarget = Math.abs(elementCenter - targetViewPosition);
      
      // Prefer elements that are closer to our target position and more visible
      if (visibility > 0.1 && 
          (distanceFromTarget < minDistanceFromTarget || 
           (distanceFromTarget === minDistanceFromTarget && visibility > bestVisibility))) {
        bestVisibility = visibility;
        bestVisibleMessageIndex = messageIndex;
        bestVisibleBlockIndex = blockIndex;
        minDistanceFromTarget = distanceFromTarget;
      }
    }
  });

  // If no markers are visible, check if we've scrolled past all markers
  if (bestVisibleMessageIndex === -1 && lastMarkerMessageIndex !== -1) {
    // Check if we're scrolled past the last marker
    const lastMarker = Array.from(screenshotElements).find(element => {
      const msgIdx = parseInt((element as HTMLElement).dataset.messageIndex || '0');
      const blockIdx = parseInt((element as HTMLElement).dataset.blockIndex || '0');
      return msgIdx === lastMarkerMessageIndex && blockIdx === lastMarkerBlockIndex;
    });
    
    if (lastMarker) {
      const lastMarkerTop = (lastMarker as HTMLElement).offsetTop;
      if (containerScrollTop > lastMarkerTop) {
        // We're scrolled past the last marker, use it
        bestVisibleMessageIndex = lastMarkerMessageIndex;
        bestVisibleBlockIndex = lastMarkerBlockIndex;
      }
    }
  }

  // If still no marker found, return null to keep current screenshot
  if (bestVisibleMessageIndex === -1) {
    return null;
  }

  // Find the most recent screenshot at or before the best visible marker
  let bestScreenshot: ScreenshotData | null = null;
  for (const screenshot of screenshots) {
    if (
      screenshot.messageIndex < bestVisibleMessageIndex ||
      (screenshot.messageIndex === bestVisibleMessageIndex && screenshot.blockIndex <= bestVisibleBlockIndex)
    ) {
      bestScreenshot = screenshot;
    }
  }
  
  return bestScreenshot;
}
