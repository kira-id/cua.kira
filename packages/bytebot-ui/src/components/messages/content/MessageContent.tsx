import React from "react";
import {
  MessageContentBlock,
  isTextContentBlock,
  isImageContentBlock,
  isComputerToolUseContentBlock,
  isToolResultContentBlock,
} from "@bytebot/shared";
import { TextContent } from "./TextContent";
import { ImageContent } from "./ImageContent";
import { ComputerToolContent } from "./ComputerToolContent";
import { ErrorContent } from "./ErrorContent";

interface MessageContentProps {
  content: MessageContentBlock[];
  isTakeOver?: boolean;
  messageId: string;
  onScreenshotSelect?: (screenshotId: string) => void;
}

export function MessageContent({
  content,
  isTakeOver = false,
  messageId,
  onScreenshotSelect,
}: MessageContentProps) {
  const shouldRenderBlock = (block: MessageContentBlock) => {
    if (
      isToolResultContentBlock(block) &&
      block.content &&
      block.content.some((contentBlock) => isImageContentBlock(contentBlock))
    ) {
      return true;
    }
    if (
      isToolResultContentBlock(block) &&
      block.tool_use_id !== "set_task_status" &&
      !block.is_error
    ) {
      return false;
    }
    return true;
  };

  const hasVisibleBlocks = content.some((block) => shouldRenderBlock(block));
  if (!hasVisibleBlocks) {
    return null;
  }

  return (
    <div className="w-full">
      {content.map((block, blockIndex) => {
        if (!shouldRenderBlock(block)) {
          return null;
        }

        return (
          <div key={blockIndex}>
            {isTextContentBlock(block) && <TextContent block={block} />}

            {isToolResultContentBlock(block) &&
              !block.is_error &&
              block.content.map((contentBlock, contentBlockIndex) => {
                if (isImageContentBlock(contentBlock)) {
                  const screenshotId = `${messageId}-${blockIndex}-${contentBlockIndex}`;
                  return (
                    <ImageContent
                      key={contentBlockIndex}
                      block={contentBlock}
                      screenshotId={screenshotId}
                      onViewScreenshot={onScreenshotSelect}
                    />
                  );
                }
                return null;
              })}

            {isComputerToolUseContentBlock(block) && (
              <ComputerToolContent block={block} isTakeOver={isTakeOver} />
            )}

            {isToolResultContentBlock(block) && block.is_error && (
              <ErrorContent block={block} />
            )}

            {isToolResultContentBlock(block) &&
              !block.is_error &&
              block.tool_use_id === "set_task_status" &&
              block.content?.[0].type === "text" && (
                <TextContent block={block.content?.[0]} />
              )}
          </div>
        );
      })}
    </div>
  );
}
