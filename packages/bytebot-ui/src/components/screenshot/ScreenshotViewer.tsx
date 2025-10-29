import React, { useState, useEffect, useRef, useMemo } from "react";
import Image from "next/image";
import { ScreenshotData } from "@/utils/screenshotUtils";

interface ScreenshotViewerProps {
  screenshot: ScreenshotData | null;
  className?: string;
}

export function ScreenshotViewer({ screenshot, className = '' }: ScreenshotViewerProps) {
  const [currentScreenshot, setCurrentScreenshot] = useState(screenshot);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [displayMetrics, setDisplayMetrics] = useState({
    width: 0,
    height: 0,
    offsetX: 0,
    offsetY: 0,
  });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentScreenshot(screenshot);
  }, [screenshot]);

  useEffect(() => {
    if (!currentScreenshot) {
      setNaturalSize(null);
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    let isCancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (isCancelled) {
        return;
      }

      const width = image.naturalWidth || image.width;
      const height = image.naturalHeight || image.height;

      if (width > 0 && height > 0) {
        setNaturalSize({ width, height });
      } else {
        setNaturalSize(null);
      }
    };

    image.src = `data:${currentScreenshot.mediaType};base64,${currentScreenshot.base64Data}`;

    return () => {
      isCancelled = true;
    };
  }, [currentScreenshot]);

  useEffect(() => {
    if (!naturalSize) {
      setDisplayMetrics({
        width: 0,
        height: 0,
        offsetX: 0,
        offsetY: 0,
      });
      return;
    }

    const updateMetrics = () => {
      const container = containerRef.current;
      if (!container) {
        return;
      }

      const { clientWidth, clientHeight } = container;
      if (clientWidth === 0 || clientHeight === 0) {
        return;
      }

      const imageAspect = naturalSize.width / naturalSize.height;
      const containerAspect = clientWidth / clientHeight;

      let width = clientWidth;
      let height = clientHeight;

      if (imageAspect > containerAspect) {
        height = clientWidth / imageAspect;
      } else {
        width = clientHeight * imageAspect;
      }

      setDisplayMetrics({
        width,
        height,
        offsetX: (clientWidth - width) / 2,
        offsetY: (clientHeight - height) / 2,
      });
    };

    updateMetrics();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(updateMetrics);
      const container = containerRef.current;
      if (container) {
        observer.observe(container);
      }
      return () => observer.disconnect();
    }

    if (typeof window !== "undefined") {
      window.addEventListener("resize", updateMetrics);
      return () => window.removeEventListener("resize", updateMetrics);
    }

    return;
  }, [naturalSize, currentScreenshot?.id]);

  const cursorStyle = useMemo(() => {
    const cursor = currentScreenshot?.cursor;
    if (
      !cursor ||
      !naturalSize ||
      naturalSize.width === 0 ||
      naturalSize.height === 0 ||
      displayMetrics.width === 0 ||
      displayMetrics.height === 0
    ) {
      return null;
    }

    const xRatio = cursor.x / naturalSize.width;
    const yRatio = cursor.y / naturalSize.height;

    if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) {
      return null;
    }

    const left =
      displayMetrics.offsetX + xRatio * displayMetrics.width;
    const top =
      displayMetrics.offsetY + yRatio * displayMetrics.height;

    if (!Number.isFinite(left) || !Number.isFinite(top)) {
      return null;
    }

    const clamp = (value: number, min: number, max: number) =>
      Math.min(Math.max(value, min), max);

    const style = {
      left: clamp(left, displayMetrics.offsetX, displayMetrics.offsetX + displayMetrics.width),
      top: clamp(top, displayMetrics.offsetY, displayMetrics.offsetY + displayMetrics.height),
    };
    return style;
  }, [
    currentScreenshot?.cursor,
    currentScreenshot?.id,
    naturalSize,
    displayMetrics,
  ]);

  if (!currentScreenshot) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 ${className}`}>
        <div className="text-center text-gray-500">
          <div className="mb-2 text-4xl">📷</div>
          <p className="text-sm">No screenshots available</p>
          <p className="text-xs mt-1">Screenshots will appear here when the task has run</p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <Image
        src={`data:${currentScreenshot.mediaType};base64,${currentScreenshot.base64Data}`}
        alt="Task screenshot"
        fill
        className="object-contain"
        priority
      />
      <div className="absolute inset-0 pointer-events-none">
        {cursorStyle && (
          <div
            className="absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-red-500 shadow-[0_0_6px_rgba(0,0,0,0.3)]"
            style={{ left: cursorStyle.left, top: cursorStyle.top }}
          />
        )}
      </div>
    </div>
  );
}
