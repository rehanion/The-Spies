"use client";

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ background: "#0b0d10", color: "#e6e8eb", fontFamily: "system-ui, sans-serif", padding: "4rem 1rem", textAlign: "center" }}>
        <h1>SPIES is temporarily unavailable</h1>
        <p>Please try again in a moment.</p>
        <button type="button" onClick={reset}>Try again</button>
      </body>
    </html>
  );
}
