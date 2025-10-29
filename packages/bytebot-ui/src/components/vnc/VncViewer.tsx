"use client";

import React, { useRef, useEffect, useState } from "react";

interface VncViewerProps {
  viewOnly?: boolean;
}

export function VncViewer({ viewOnly = true }: VncViewerProps) {
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

  console.log("VncViewer props:", { viewOnly, wsUrl, VncComponent: !!VncComponent });

  return (
    <div
      ref={containerRef}
      className="h-full w-full"
    >
      {VncComponent && wsUrl && (
        <VncComponent
          key={viewOnly ? "view-only" : "interactive"} // Force remount when viewOnly changes
          focusOnClick={!viewOnly} // Focus on click when interactive
          url={wsUrl}
          scaleViewport
          viewOnly={viewOnly} // Respect the viewOnly prop
          showDotCursor={true} // Always show cursor for visibility
          style={{
            width: "100%",
            height: "100%",
          }}
          onConnect={() => console.log("VNC connected")}
          onDisconnect={() => console.log("VNC disconnected")}
        />
      )}
    </div>
  );
}
