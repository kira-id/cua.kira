import { useState, useEffect, useCallback, useRef } from 'react';
import { Message } from '@/types';
import { extractScreenshots, getScreenshotForScrollPosition, ScreenshotData } from '@/utils/screenshotUtils';

interface UseScrollScreenshotProps {
  messages: Message[];
  scrollContainerRef: React.RefObject<HTMLElement | null>;
}

export function useScrollScreenshot({ messages, scrollContainerRef }: UseScrollScreenshotProps) {
  const [currentScreenshot, setCurrentScreenshot] = useState<ScreenshotData | null>(null);
  const [allScreenshots, setAllScreenshots] = useState<ScreenshotData[]>([]);
  const lastScrollTime = useRef<number>(0);
  const previewPinnedRef = useRef<boolean>(false);

  // Extract screenshots whenever messages change
  useEffect(() => {
    const screenshots = extractScreenshots(messages);
    setAllScreenshots(screenshots);
    
    // Only set initial screenshot if we don't have one yet
    if (screenshots.length > 0 && !currentScreenshot) {
      setTimeout(() => {
        const initialScreenshot = getScreenshotForScrollPosition(
          screenshots,
          messages,
          scrollContainerRef.current
        );
        if (initialScreenshot) {
          setCurrentScreenshot(initialScreenshot);
        } else {
          setCurrentScreenshot(screenshots[screenshots.length - 1]);
        }
        previewPinnedRef.current = false;
      }, 100);
    } else if (screenshots.length === 0) {
      setCurrentScreenshot(null);
      previewPinnedRef.current = false;
    } else if (screenshots.length > 0 && currentScreenshot) {
      // Ensure current screenshot still exists in the updated list
      const stillExists = screenshots.some(
        (screenshot) => screenshot.id === currentScreenshot.id
      );
      if (!stillExists) {
        setCurrentScreenshot(screenshots[screenshots.length - 1]);
        previewPinnedRef.current = false;
        return;
      }

      // When messages update, trigger a re-check
      setTimeout(() => {
        if (scrollContainerRef.current) {
          const event = new Event('scroll');
          scrollContainerRef.current.dispatchEvent(event);
        }
      }, 300);
    }
  }, [messages, scrollContainerRef, currentScreenshot]);

  // After initial render, force a re-check for screenshot markers using MutationObserver
  useEffect(() => {
    if (!scrollContainerRef.current) return;

    const container = scrollContainerRef.current;
    let mutationTimeout: NodeJS.Timeout;
    const observer = new MutationObserver(() => {
      clearTimeout(mutationTimeout);
      mutationTimeout = setTimeout(() => {
        const event = new Event('scroll');
        container.dispatchEvent(event);
      }, 200);
    });

    observer.observe(container, { childList: true, subtree: true });

    return () => {
      clearTimeout(mutationTimeout);
      observer.disconnect();
    };
  }, [scrollContainerRef, allScreenshots.length]);


  // Handle scroll events to update current screenshot
  const handleScroll = useCallback((scrollElement: HTMLElement) => {
    if (allScreenshots.length === 0) return;

    const now = Date.now();
    if (now - lastScrollTime.current < 100) return;
    if (previewPinnedRef.current) return;
    lastScrollTime.current = now;

    setTimeout(() => {
      if ((Date.now() - now) <= 150 && allScreenshots.length > 0) {
        setCurrentScreenshot(prevScreenshot => {
          const screenshot = getScreenshotForScrollPosition(allScreenshots, messages, scrollElement);
          
          if (screenshot && screenshot.id !== prevScreenshot?.id) {
            return screenshot;
          }
          return prevScreenshot;
        });
      }
    }, 50);
  }, [allScreenshots, messages]);

  // Attach scroll listener
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const scrollHandler = (e: Event) => {
      if (e.target !== container) return;

      if (previewPinnedRef.current) {
        if (e.isTrusted) {
          previewPinnedRef.current = false;
        } else {
          return;
        }
      }

      handleScroll(container);
    };

    // Only attach to the container itself
    container.addEventListener('scroll', scrollHandler, { passive: true });
    
    return () => container.removeEventListener('scroll', scrollHandler);
  }, [handleScroll, scrollContainerRef]);

  const selectScreenshotById = useCallback(
    (screenshotId: string) => {
      const fallbackScreenshot =
        allScreenshots.length > 0
          ? allScreenshots[allScreenshots.length - 1]
          : null;
      const targetScreenshot =
        allScreenshots.find((item) => item.id === screenshotId) ?? null;
      const screenshotToSet = targetScreenshot ?? fallbackScreenshot ?? null;

      previewPinnedRef.current = !!screenshotToSet;
      setCurrentScreenshot((prevScreenshot) => {
        if (!screenshotToSet) {
          previewPinnedRef.current = false;
          return prevScreenshot;
        }
        if (prevScreenshot?.id === screenshotToSet.id) {
          return prevScreenshot;
        }
        return screenshotToSet;
      });

      if (!screenshotToSet || !scrollContainerRef.current) {
        return;
      }

      // Locate the corresponding DOM marker and ensure it's visible
      const marker = scrollContainerRef.current.querySelector<HTMLElement>(
        `[data-screenshot-id="${screenshotToSet.id}"]`
      );

      if (marker) {
        const scrollTarget =
          (marker.parentElement as HTMLElement | null) ?? marker;

        // Defer scroll to allow any pending layout updates
        if (typeof window !== "undefined") {
          window.requestAnimationFrame(() => {
            scrollTarget.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          });
        } else {
          scrollTarget.scrollIntoView({
            behavior: "smooth",
            block: "center",
          });
        }
      }
    },
    [allScreenshots, scrollContainerRef]
  );

  return {
    currentScreenshot,
    allScreenshots,
    hasScreenshots: allScreenshots.length > 0,
    selectScreenshotById,
  };
}
