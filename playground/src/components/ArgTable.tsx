import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { flexRender, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import type { DocEntry, DocProperty, DocType } from "@oxc-ts-docgen/docgen";

interface ArgRow {
  name: string;
  docType: DocType;
  required: boolean;
  defaultValue: string;
  description: string;
}

function formatType(dt: DocType): string {
  switch (dt.kind) {
    case "primitive":
    case "intrinsic":
      return dt.name;
    case "literal":
      return dt.value;
    case "reference":
      if (dt.typeArguments?.length) {
        return `${dt.name}<${dt.typeArguments.map(formatType).join(", ")}>`;
      }
      return dt.name;
    case "union":
      return dt.members.map(formatType).join(" | ");
    case "intersection":
      return dt.members.map(formatType).join(" & ");
    case "array":
      return `${formatType(dt.elementType)}[]`;
    case "tuple":
      return `[${dt.elements.map(formatType).join(", ")}]`;
    case "function": {
      const params = dt.parameters.map((p) => `${p.name}: ${formatType(p.type)}`).join(", ");
      return `(${params}) => ${formatType(dt.returnType)}`;
    }
    case "object":
      if (dt.properties.length === 0) return "{}";
      return "{ ... }";
    case "keyof":
      return `keyof ${formatType(dt.type)}`;
    case "typeof":
      return `typeof ${dt.name}`;
    case "templateLiteral":
      return "`template`";
    case "mapped":
    case "conditional":
    case "indexedAccess":
    case "rest":
    case "infer":
    case "unresolved":
      return dt.kind;
  }
}

function renderDocType(
  dt: DocType,
  relatedByName: Map<string, DocEntry>,
  onRefClick: (entry: DocEntry, anchor: HTMLElement) => void,
): ReactNode {
  switch (dt.kind) {
    case "reference": {
      const args = dt.typeArguments;
      if (!args?.length) {
        return renderRefName(dt.name, relatedByName, onRefClick);
      }
      return (
        <>
          {renderRefName(dt.name, relatedByName, onRefClick)}
          {"<"}
          {args.map((a, i) => (
            <span key={i}>
              {i > 0 ? ", " : null}
              {renderDocType(a, relatedByName, onRefClick)}
            </span>
          ))}
          {">"}
        </>
      );
    }
    case "union":
      return dt.members.map((m, i) => (
        <span key={i}>
          {i > 0 ? " | " : null}
          {renderDocType(m, relatedByName, onRefClick)}
        </span>
      ));
    case "intersection":
      return dt.members.map((m, i) => (
        <span key={i}>
          {i > 0 ? " & " : null}
          {renderDocType(m, relatedByName, onRefClick)}
        </span>
      ));
    case "array":
      return (
        <>
          {renderDocType(dt.elementType, relatedByName, onRefClick)}
          {"[]"}
        </>
      );
    case "tuple":
      return (
        <>
          [
          {dt.elements.map((e, i) => (
            <span key={i}>
              {i > 0 ? ", " : null}
              {renderDocType(e, relatedByName, onRefClick)}
            </span>
          ))}
          ]
        </>
      );
    case "function": {
      const params = dt.parameters.map((p, i) => (
        <span key={i}>
          {i > 0 ? ", " : null}
          {p.name}: {renderDocType(p.type, relatedByName, onRefClick)}
        </span>
      ));
      return (
        <>
          ({params}) =&gt; {renderDocType(dt.returnType, relatedByName, onRefClick)}
        </>
      );
    }
    default:
      return formatType(dt);
  }
}

function renderRefName(
  name: string,
  relatedByName: Map<string, DocEntry>,
  onRefClick: (entry: DocEntry, anchor: HTMLElement) => void,
): ReactNode {
  const entry = relatedByName.get(name);
  if (!entry) {
    return name;
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onRefClick(entry, e.currentTarget);
      }}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        margin: 0,
        color: "#a5f3fc",
        textDecoration: "underline",
        textUnderlineOffset: "3px",
        cursor: "pointer",
        font: "inherit",
        fontFamily: "monospace",
      }}
    >
      {name}
    </button>
  );
}

function toRows(properties: DocProperty[]): ArgRow[] {
  return properties.map((prop) => ({
    name: prop.name,
    docType: prop.type,
    required: !prop.optional,
    defaultValue: prop.defaultValue ?? "-",
    description: prop.description,
  }));
}

const coreRowModel = getCoreRowModel<ArgRow>();

export function ArgTable({
  properties,
  related = [],
}: {
  properties: DocProperty[];
  related?: DocEntry[];
}) {
  const relatedByName = useMemo(() => new Map(related.map((e) => [e.name, e])), [related]);

  const [popover, setPopover] = useState<{
    entry: DocEntry;
    left: number;
    top: number;
  } | null>(null);

  const closePopover = useCallback(() => setPopover(null), []);

  useEffect(() => {
    if (!popover) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePopover();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [popover, closePopover]);

  const onRefClick = useCallback((entry: DocEntry, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect();
    const pad = 8;
    const popW = 360;
    const left = Math.max(
      pad,
      Math.min(r.left, (typeof window !== "undefined" ? window.innerWidth : 800) - popW - pad),
    );
    setPopover({
      entry,
      left,
      top: r.bottom + 6,
    });
  }, []);

  const data = useMemo(() => toRows(properties), [properties]);

  const columns = useMemo((): ColumnDef<ArgRow>[] => {
    return [
      {
        accessorKey: "name",
        header: "Name",
        cell: (info) => info.getValue<string>(),
      },
      {
        accessorKey: "docType",
        header: "Type",
        cell: (info) => renderDocType(info.getValue<DocType>(), relatedByName, onRefClick),
      },
      {
        accessorKey: "required",
        header: "Required",
        cell: (info) => (info.getValue<boolean>() ? "Yes" : "No"),
      },
      {
        accessorKey: "defaultValue",
        header: "Default",
        cell: (info) => info.getValue<string>(),
      },
      {
        accessorKey: "description",
        header: "Description",
        cell: (info) => info.getValue<string>(),
      },
    ];
  }, [relatedByName, onRefClick]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: coreRowModel,
  });

  return (
    <div style={{ overflowX: "auto", position: "relative" }}>
      {popover && (
        <>
          <div
            role="presentation"
            onClick={closePopover}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100,
              background: "transparent",
            }}
          />
          <div
            role="dialog"
            aria-label={`Type ${popover.entry.name}`}
            style={{
              position: "fixed",
              left: popover.left,
              top: popover.top,
              zIndex: 101,
              minWidth: 280,
              maxWidth: 360,
              padding: "12px 14px",
              background: "#1e1b4b",
              border: "1px solid #6366f1",
              borderRadius: 8,
              boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
                marginBottom: 8,
              }}
            >
              <code style={{ color: "#c4b5fd", fontSize: 14, fontWeight: 600 }}>
                {popover.entry.name}
              </code>
              <button
                type="button"
                onClick={closePopover}
                aria-label="Close"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#888",
                  cursor: "pointer",
                  fontSize: 18,
                  lineHeight: 1,
                  padding: "0 4px",
                }}
              >
                ×
              </button>
            </div>
            <span
              style={{
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                color: "#818cf8",
              }}
            >
              {popover.entry.kind}
            </span>
            <pre
              style={{
                margin: "10px 0 0",
                padding: "10px 12px",
                background: "#0f0d1a",
                borderRadius: 6,
                fontSize: 12,
                lineHeight: 1.5,
                color: "#67e8f9",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {formatType(popover.entry.type)}
            </pre>
            {popover.entry.description ? (
              <p
                style={{
                  margin: "10px 0 0",
                  fontSize: 13,
                  color: "#a8a29e",
                  lineHeight: 1.45,
                }}
              >
                {popover.entry.description}
              </p>
            ) : null}
            {popover.entry.kind === "enum" && popover.entry.properties.length > 0 ? (
              <ul
                style={{
                  margin: "10px 0 0",
                  paddingLeft: 18,
                  fontSize: 12,
                  color: "#d6d3d1",
                }}
              >
                {popover.entry.properties.map((m) => (
                  <li key={m.name} style={{ marginBottom: 4 }}>
                    <code style={{ color: "#a5b4fc" }}>{m.name}</code>
                    {m.description ? ` — ${m.description}` : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      )}

      <table
        style={{
          width: "100%",
          borderCollapse: "collapse",
          fontSize: 14,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((header) => (
                <th
                  key={header.id}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderBottom: "2px solid #333",
                    color: "#a78bfa",
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                  }}
                >
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} style={{ borderBottom: "1px solid #222" }}>
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  style={{
                    padding: "8px 12px",
                    verticalAlign: "top",
                    ...(cell.column.id === "name"
                      ? { fontWeight: 600, color: "#c4b5fd", fontFamily: "monospace" }
                      : cell.column.id === "docType"
                        ? { color: "#67e8f9", fontSize: 13 }
                        : cell.column.id === "required"
                          ? { color: cell.getValue() ? "#f87171" : "#4ade80" }
                          : {}),
                  }}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
