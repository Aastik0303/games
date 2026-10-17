"use client";

/* Replaces the root layout when it fails, so it can't rely on globals.css. */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, minHeight: "100vh", display: "grid", placeItems: "center", background: "#080a12", color: "#f1f2fa", fontFamily: "system-ui, sans-serif" }}>
        <title>Something went wrong · Prism</title>
        <main style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 22, marginBottom: 8 }}>Prism couldn&apos;t load</h1>
          <p style={{ color: "#b3b8cf", fontSize: 14, lineHeight: 1.5 }}>An unexpected error stopped the app from starting. Please try again.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{ marginTop: 16, padding: "10px 18px", borderRadius: 12, border: 0, background: "#c4b5fd", color: "#04050a", fontWeight: 600, cursor: "pointer" }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
