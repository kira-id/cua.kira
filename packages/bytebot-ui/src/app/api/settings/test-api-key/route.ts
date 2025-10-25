import { NextRequest } from "next/server";

// Configuration constants
const API_REQUEST_TIMEOUT_MS = 5000; // 5 seconds timeout

// Helper function to safely log errors without sensitive data

type ErrorMetadata = {
  code?: string | number;
  status?: number;
  stack?: string;
};

function logSafeError(message: string, error: unknown) {
  if (error instanceof Error) {
    const metadata = error as Error & ErrorMetadata;
    console.error({
      message,
      errorType: error.constructor.name,
      errorCode: metadata.code,
      statusCode: metadata.status,
      ...(process.env.NODE_ENV === "development" && metadata.stack
        ? { stack: metadata.stack }
        : {}),
    });
    return;
  }

  if (typeof error === "object" && error !== null) {
    const metadata = error as ErrorMetadata & { constructor?: { name?: string } };
    console.error({
      message,
      errorType: metadata.constructor?.name ?? "Unknown",
      errorCode: metadata.code,
      statusCode: metadata.status,
      details: metadata,
    });
    return;
  }

  console.error({
    message,
    errorType: typeof error,
    value: error,
  });

  // TODO: Send to secure error monitoring service
  // Example: await sendToErrorMonitoring({ message, error });
}

// API endpoint to test API keys
type TestApiKeyRequestBody = {
  provider: string;
  apiKey: string;
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<TestApiKeyRequestBody>;
    const { provider, apiKey } = body;
    
    if (!provider || !apiKey) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Provider and API key are required" 
        }),
        { 
          status: 400,
          headers: { "Content-Type": "application/json" }
        }
      );
    }
    
    // Forward the request to the backend agent API
    const BYTEBOT_AGENT_BASE_URL = process.env.BYTEBOT_AGENT_BASE_URL || "http://localhost:3001";
    
    // Set up timeout handling
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, API_REQUEST_TIMEOUT_MS);
    
    let response;
    try {
      response = await fetch(`${BYTEBOT_AGENT_BASE_URL}/api-keys/test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider, apiKey }),
        signal: controller.signal,
      });
      
      // Clear timeout on successful response
      clearTimeout(timeoutId);
    } catch (fetchError) {
      clearTimeout(timeoutId);
      
      // Handle timeout specifically
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        logSafeError("API key test request timed out", { 
          timeout: API_REQUEST_TIMEOUT_MS,
          errorName: fetchError.name 
        });
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Request timed out after ${API_REQUEST_TIMEOUT_MS / 1000} seconds`,
            timeout: true
          }),
          { 
            status: 504, // Gateway Timeout
            headers: { "Content-Type": "application/json" }
          }
        );
      }
      
      // Re-throw other fetch errors to be handled by outer catch
      throw fetchError;
    }
    
    // Handle response parsing safely
    let result: unknown;
    const contentType = response.headers.get('content-type');
    
    // Read response body as text first to avoid consuming the stream
    const responseText = await response.text().catch(() => "Unable to read response body");
    
    if (contentType && contentType.includes('application/json')) {
      try {
        result = JSON.parse(responseText);
      } catch (parseError) {
        logSafeError("Failed to parse JSON response from backend", parseError);
        return new Response(
          JSON.stringify({ 
            success: false, 
            error: `Invalid JSON response from backend: ${responseText}`,
            status: response.status,
            statusText: response.statusText
          }),
          { 
            status: 502,
            headers: { "Content-Type": "application/json" }
          }
        );
      }
    } else {
      // Non-JSON response, return the text content
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: `Backend returned non-JSON response: ${responseText}`,
          status: response.status,
          statusText: response.statusText
        }),
        { 
          status: 502,
          headers: { "Content-Type": "application/json" }
        }
      );
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: response.status,
        headers: { "Content-Type": "application/json" }
      }
    );
  } catch (error) {
    logSafeError("Error testing API key", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: "Failed to test API key" 
      }),
      { 
        status: 500,
        headers: { "Content-Type": "application/json" }
      }
    );
  }
}
