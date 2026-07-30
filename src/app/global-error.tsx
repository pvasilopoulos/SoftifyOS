"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[SoftifyOS:global]", error);
  }, [error]);

  return (
    <html lang="el">
      <body
        style={{
          margin: 0,
          minHeight: "100dvh",
          display: "grid",
          placeItems: "center",
          fontFamily:
            "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif",
          background: "#F1F4F7",
          color: "#0B1220",
        }}
      >
        <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
          <h1 style={{ fontSize: 22, margin: "0 0 8px" }}>
            SoftifyOS προσωρινά μη διαθέσιμο
          </h1>
          <p style={{ color: "#64748B", fontSize: 14, margin: "0 0 20px" }}>
            Προέκυψε απρόσμενο σφάλμα. Δοκιμάστε ανανέωση.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              height: 40,
              padding: "0 16px",
              borderRadius: 12,
              border: 0,
              background: "#0D9488",
              color: "white",
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Επανάληψη
          </button>
        </div>
      </body>
    </html>
  );
}
