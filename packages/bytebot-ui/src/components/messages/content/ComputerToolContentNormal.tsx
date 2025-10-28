import React from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ComputerToolUseContentBlock,
  isTypeKeysToolUseBlock,
  isTypeTextToolUseBlock,
  isPressKeysToolUseBlock,
  isWaitToolUseBlock,
  isScrollToolUseBlock,
  isApplicationToolUseBlock,
  Application,
  isPasteTextToolUseBlock,
  isReadFileToolUseBlock,
  isCursorPositionToolUseBlock,
} from "@bytebot/shared";
import { getIcon, getLabel } from "./ComputerToolUtils";
import { normalizeCoordinates } from "@bytebot/shared";

interface ComputerToolContentNormalProps {
  block: ComputerToolUseContentBlock;
}

const applicationMap: Record<Application, string> = {
  firefox: "Firefox",
  "1password": "1Password",
  thunderbird: "Thunderbird",
  blender: "Blender",
  vscode: "Visual Studio Code",
  terminal: "Terminal",
  directory: "File Manager",
  desktop: "Desktop",
};

function ToolDetailsNormal({ block }: { block: ComputerToolUseContentBlock }) {
  const baseClasses =
    "px-1 py-0.5 text-[12px] text-bytebot-bronze-light-11 bg-bytebot-red-light-1 border border-bytebot-bronze-light-7 rounded-md";

  return (
    <>
      {isApplicationToolUseBlock(block) && (
        <p className={baseClasses}>
          {applicationMap[block.input.application as Application]}
        </p>
      )}

      {/* Text for type and key actions */}
      {(isTypeKeysToolUseBlock(block) || isPressKeysToolUseBlock(block)) && (
        <p className={baseClasses}>{String(block.input.keys.join(" + "))}</p>
      )}

      {(isTypeTextToolUseBlock(block) || isPasteTextToolUseBlock(block)) && (
        <p className={baseClasses}>
          {String(
            block.input.isSensitive
              ? "●".repeat(block.input.text.length)
              : block.input.text,
          )}
        </p>
      )}

      {/* Duration for wait actions */}
      {isWaitToolUseBlock(block) && (
        <p className={baseClasses}>{`${block.input.duration}ms`}</p>
      )}

      {/* Coordinates for click/mouse actions */}
      {(() => {
        const normalized = normalizeCoordinates(block.input.coordinates);
        return normalized ? (
          <p className={baseClasses}>
            {normalized.x}, {normalized.y}
          </p>
        ) : null;
      })()}

      {/* Start and end coordinates for path actions */}
      {"path" in block.input &&
        Array.isArray(block.input.path) &&
        block.input.path.every(
          (point) => point.x !== undefined && point.y !== undefined,
        ) && (
          <p className={baseClasses}>
            From: {(() => {
              const start = normalizeCoordinates(block.input.path[0]);
              return start ? `${start.x}, ${start.y}` : 'unknown';
            })()} → To:{" "}
            {(() => {
              const end = normalizeCoordinates(block.input.path[block.input.path.length - 1]);
              return end ? `${end.x}, ${end.y}` : 'unknown';
            })()}
          </p>
        )}

      {/* Cursor position information */}
      {isCursorPositionToolUseBlock(block) && (
        <p className={baseClasses}>Getting mouse cursor position</p>
      )}

      {/* Scroll information */}
      {isScrollToolUseBlock(block) && (
        <p className={baseClasses}>
          {String(block.input.direction)} {Number(block.input.scrollCount)}
        </p>
      )}

      {/* File information */}
      {isReadFileToolUseBlock(block) && (
        <p className={baseClasses}>{block.input.path}</p>
      )}
    </>
  );
}

export function ComputerToolContentNormal({
  block,
}: ComputerToolContentNormalProps) {
  // Don't render screenshot tool use blocks here - they're handled separately
  if (getLabel(block) === "Screenshot") {
    return null;
  }

  return (
    <div className="mb-3 max-w-4/5">
      <div className="flex items-center gap-2">
        <HugeiconsIcon
          icon={getIcon(block)}
          className="text-bytebot-bronze-dark-9 h-4 w-4"
        />
        <p className="text-bytebot-bronze-light-11 text-xs">
          {getLabel(block)}
        </p>
        <ToolDetailsNormal block={block} />
      </div>
    </div>
  );
}
