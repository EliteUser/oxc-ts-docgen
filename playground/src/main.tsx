import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { ArgTable } from "./components/arg-table/ArgTable";
import { componentCaseExamples } from "./docs";
import styles from "./styles.module.css";

const examples = componentCaseExamples;

function App() {
  const [selectedId, setSelectedId] = useState(examples[0]?.id ?? "");

  const selectedExample = examples.find((example) => example.id === selectedId) ?? examples[0];
  const docs = selectedExample.docs;
  const entry = docs.entries[0];

  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <h1 className={styles.title}>oxc-ts-docgen playground</h1>
      </header>

      <main className={styles.layout}>
        <aside className={styles.sidebar} aria-labelledby="playground-sidebar-title">
          <div className={styles.sidebarTitle} id="playground-sidebar-title">
            Examples
          </div>
          <nav className={styles.nav} aria-label="Doc examples">
            {examples.map((example) => {
              const selected = example.id === selectedExample.id;

              return (
                <button
                  key={example.id}
                  type="button"
                  onClick={() => setSelectedId(example.id)}
                  aria-current={selected ? "page" : undefined}
                  className={`${styles.navItem} ${selected ? styles.navItemSelected : ""}`}
                >
                  <span className={styles.navItemType}>{example.typeName}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <section
          className={styles.main}
          aria-labelledby={entry ? "playground-entry-title" : undefined}
        >
          {entry ? (
            <>
              <div className={styles.entryHeader}>
                <h2 className={styles.entryTitle} id="playground-entry-title">
                  {entry.name}
                </h2>
                <span className={styles.entryKind}>{entry.kind}</span>
                <span className={styles.entryCount}>{entry.properties.length} props</span>
              </div>

              <div className={styles.card}>
                <ArgTable properties={entry.properties} related={docs.related} />
              </div>

              <details className={styles.json}>
                <summary className={styles.jsonSummary}>Raw JSON</summary>
                <pre className={styles.jsonCode}>{JSON.stringify(docs, null, 2)}</pre>
              </details>
            </>
          ) : (
            <p>No entry was generated for {selectedExample.typeName}.</p>
          )}
        </section>
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
