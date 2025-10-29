import React from "react";
import { isTextContentBlock, ToolResultContentBlock } from "@bytebot/shared";
import { AlertCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

interface ErrorContentProps {
  block: ToolResultContentBlock;
}

export function ErrorContent({ block }: ErrorContentProps) {
  // Log extensive error information to help users identify tool failure causes
  console.error("Tool execution error detected:", {
    toolUseId: block.tool_use_id,
    isError: block.is_error,
    contentCount: block.content?.length || 0,
    contentTypes: block.content?.map(c => c.type) || [],
    contentDetails: block.content?.map(c => ({
      type: c.type,
      textLength: isTextContentBlock(c) ? c.text.length : 'N/A',
      textPreview: isTextContentBlock(c) ? c.text.substring(0, 100) : 'N/A'
    })) || [],
    timestamp: new Date().toISOString()
  });

  const errorMessage = isTextContentBlock(block.content?.[0])
    ? block.content[0].text
    : "Error running tool";

  // Log to console for additional debugging (users can check browser console)
  console.error(`Tool ${block.tool_use_id} failed: ${errorMessage}`);

  return (
    <div className="mb-3 rounded-md border border-red-200 bg-red-100 p-2">
      <div className="flex items-center justify-start gap-2">
        <HugeiconsIcon
          icon={AlertCircleIcon}
          className="h-5 w-5 text-red-800"
        />
        <div className="prose prose-sm max-w-none text-sm text-red-800">
          {errorMessage}
        </div>
      </div>
      <div className="mt-2 text-xs text-red-600">
        Tool ID: {block.tool_use_id} | Check browser console for detailed logs
      </div>
    </div>
  );
}
