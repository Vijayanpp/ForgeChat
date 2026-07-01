import { ImageResponse } from "next/og";

// AgentForge favicon — app icon rendered as a blue rounded square.

export const runtime = "edge";
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1565c0",
          borderRadius: 6,
        }}
      >
        {/* Chat bubble (green) inside cloud (blue) */}
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
        >
          {/* Cloud shape */}
          <path
            d="M18 10h-.27A6 6 0 0 0 6 10H6a4 4 0 0 0 0 8h12a4 4 0 0 0 0-8z"
            fill="#64b5f6"
          />
          {/* Chat bubble */}
          <path
            d="M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0"
            fill="#43a047"
          />
          <circle cx="10.5" cy="8" r="0.6" fill="white" />
          <circle cx="12" cy="8" r="0.6" fill="white" />
          <circle cx="13.5" cy="8" r="0.6" fill="white" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
