import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { getDocs } from "@oxc-ts-docgen/docgen";
import type { DocSchema } from "@oxc-ts-docgen/docgen";
import type { ButtonProps } from "./components/button";
import type { TextFieldProps } from "./components/text-field";
import { ArgTable } from "./components/ArgTable";

const buttonDocs = getDocs<ButtonProps>();
const textFieldDocs = getDocs<TextFieldProps>();

const components: Record<string, DocSchema> = {
  ButtonProps: buttonDocs,
  TextFieldProps: textFieldDocs,
};

type Tab = "table" | "json";

function App() {
  const [selected, setSelected] = useState("ButtonProps");
  const [tab, setTab] = useState<Tab>("table");

  const docs = components[selected];
  const entry = docs?.entries[0];

  return (
    <div
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 960,
        margin: "2rem auto",
        padding: "0 1rem",
        background: "#111",
        color: "#eee",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ color: "#8b5cf6", marginBottom: "1.5rem" }}>oxc-ts-docgen playground</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {Object.keys(components).map((name) => (
          <button
            key={name}
            onClick={() => setSelected(name)}
            style={{
              padding: "6px 16px",
              borderRadius: 6,
              border: selected === name ? "1px solid #8b5cf6" : "1px solid #333",
              background: selected === name ? "#1e1b4b" : "transparent",
              color: selected === name ? "#c4b5fd" : "#888",
              cursor: "pointer",
              fontSize: 14,
              fontWeight: selected === name ? 600 : 400,
              fontFamily: "monospace",
            }}
          >
            {name}
          </button>
        ))}
      </div>

      {entry && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <h2 style={{ color: "#6366f1", margin: "0 0 0.5rem" }}>{entry.name}</h2>
            <span
              style={{
                fontSize: 12,
                padding: "2px 8px",
                borderRadius: 4,
                background: "#1e1b4b",
                color: "#818cf8",
              }}
            >
              {entry.kind}
            </span>
            <span style={{ fontSize: 13, color: "#666" }}>{entry.properties.length} props</span>
          </div>

          {entry.description && (
            <p style={{ color: "#aaa", margin: "0.25rem 0 1rem" }}>{entry.description}</p>
          )}

          <div style={{ display: "flex", gap: 0, marginBottom: 16 }}>
            {(["table", "json"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: "8px 20px",
                  border: "1px solid #333",
                  borderBottom: tab === t ? "2px solid #8b5cf6" : "1px solid #333",
                  background: tab === t ? "#1a1a2e" : "#111",
                  color: tab === t ? "#c4b5fd" : "#888",
                  cursor: "pointer",
                  fontSize: 14,
                  fontWeight: tab === t ? 600 : 400,
                }}
              >
                {t === "table" ? "Props Table" : "Raw JSON"}
              </button>
            ))}
          </div>

          {tab === "table" ? (
            <ArgTable properties={entry.properties} related={docs.related} />
          ) : (
            <pre
              style={{
                background: "#1a1a2e",
                border: "1px solid #333",
                borderRadius: 8,
                padding: "1rem",
                overflowX: "auto",
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {JSON.stringify(docs, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
