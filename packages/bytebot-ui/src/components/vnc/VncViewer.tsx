"use client";

import React, { useRef, useEffect, useState } from "react";

interface VncViewerProps {
  viewOnly?: boolean;
}

export function VncViewer({ viewOnly = true }: VncViewerProps) {
  // For cursor display, we need interactive mode, but we'll prevent all input
  const shouldShowCursor = viewOnly;
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [VncComponent, setVncComponent] = useState<any>(null);
  const [wsUrl, setWsUrl] = useState<string | null>(null);

  useEffect(() => {
    // Dynamically import the VncScreen component only on the client side
    import("react-vnc").then(({ VncScreen }) => {
      setVncComponent(() => VncScreen);
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return; // SSR safety‑net
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    setWsUrl(`${proto}://${window.location.host}/api/proxy/websockify`);
  }, []);

  console.log("VncViewer props:", { viewOnly, wsUrl, VncComponent: !!VncComponent, shouldShowCursor });

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
      style={{
        pointerEvents: shouldShowCursor ? 'none' : 'auto', // Disable all pointer events when showing cursor
        userSelect: 'none' // Prevent text selection
      }}
      onClick={(e) => e.preventDefault()} // Prevent clicks
      onMouseDown={(e) => e.preventDefault()} // Prevent mouse down
      onMouseUp={(e) => e.preventDefault()} // Prevent mouse up
      onKeyDown={(e) => e.preventDefault()} // Prevent keyboard input
      onKeyUp={(e) => e.preventDefault()} // Prevent keyboard input
      tabIndex={-1} // Prevent focus
    >
      {VncComponent && wsUrl && (
        <VncComponent
          rfbOptions={{
            secure: false,
            shared: true,
            wsProtocols: ["binary"],
            // Disable input at the RFB level
            sendCtrlV: false,
            dragViewport: false,
            clipViewport: false,
          }}
          focusOnClick={false} // Don't focus on click
          key={shouldShowCursor ? "cursor-enabled" : "cursor-disabled"}
          url={wsUrl}
          scaleViewport
          viewOnly={false} // Must be false to show cursor
          showDotCursor={shouldShowCursor}
          style={{
            width: "100%",
            height: "100%",
            pointerEvents: 'none', // Additional pointer events disable
          }}
          onConnect={() => console.log("VNC connected")}
          onDisconnect={() => console.log("VNC disconnected")}
        />
      )}
    </div>
  );
}
