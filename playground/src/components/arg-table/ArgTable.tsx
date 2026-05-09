import type { DocEntry, DocProperty, DocType } from "@synthfall/oxc-ts-docgen";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  ArgDescriptionTag,
  ArgRow,
  OpenTypePopover,
  RelatedIndex,
  TypePopoverContent,
} from "./arg-table-model";

import { formatDocType } from "../doc-type/doc-type-format";
import { renderDocType } from "../doc-type/doc-type-view";
import { buildRelatedIndex } from "../doc-type/related-index";
import { Popover } from "../popover/popover";
import { toRows } from "./arg-table-model";
import styles from "./arg-table.module.css";

type ArgTableProps = {
  /**
   * Properties displayed in the table.
   */
  properties: DocProperty[];
  /**
   * Related entries used for clickable reference popovers.
   */
  related?: DocEntry[];
};

export const ArgTable = (props: ArgTableProps) => {
  const { properties, related = [] } = props;
  const relatedIndex = useMemo(() => buildRelatedIndex(related), [related]);
  const [popover, setPopover] = useState<TypePopoverContent | null>(null);

  useEffect(() => {
    setPopover(null);
  }, [properties, related]);

  const onOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setPopover(null);
    }
  }, []);

  const onTypeClick = useCallback<OpenTypePopover>((content) => {
    setPopover(content);
  }, []);

  return (
    <Popover.Root modal={false} open={popover !== null} onOpenChange={onOpenChange}>
      <ArgTableRows properties={properties} relatedIndex={relatedIndex} onTypeClick={onTypeClick} />

      <Popover.Content
        aria-label={popover ? `Type ${popover.title}` : undefined}
        className={styles.popover}
      >
        {popover ? (
          <TypePopoverContentView
            key={`${popover.kind}:${popover.title}`}
            popover={popover}
            relatedIndex={relatedIndex}
          />
        ) : null}
      </Popover.Content>
    </Popover.Root>
  );
};

type ArgTableRowsProps = {
  /**
   * Properties displayed in the table.
   */
  properties: DocProperty[];
  /**
   * Related entries used for clickable reference popovers.
   */
  relatedIndex: RelatedIndex;
  /**
   * Popover opener for clickable types.
   */
  onTypeClick: OpenTypePopover;
};

type SortDirection = false | "asc" | "desc";

const toAriaSort = (sortDirection: SortDirection): "ascending" | "descending" | "none" => {
  if (sortDirection === "asc") {
    return "ascending";
  }

  if (sortDirection === "desc") {
    return "descending";
  }

  return "none";
};

const toSortIndicator = (sortDirection: SortDirection): string => {
  if (sortDirection === "asc") {
    return "asc";
  }

  if (sortDirection === "desc") {
    return "desc";
  }

  return "sort";
};

const ArgTableRows = (props: ArgTableRowsProps) => {
  const { properties, relatedIndex, onTypeClick } = props;
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
        cell: (info) =>
          renderDocType({
            docType: info.getValue<DocType>(),
            relatedIndex,
            onTypeClick,
          }),
        enableSorting: false,
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
        cell: (info) => <DescriptionCell row={info.row.original} />,
      },
    ];
  }, [relatedIndex, onTypeClick]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel<ArgRow>(),
    getSortedRowModel: getSortedRowModel<ArgRow>(),
    initialState: {
      sorting: [
        {
          id: "name",
          desc: false,
        },
      ],
    },
  });

  return (
    <div className={styles.shell}>
      <table className={styles.table}>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sortDirection = header.column.getIsSorted();
                const ariaSort = toAriaSort(sortDirection);
                const sortIndicator = toSortIndicator(sortDirection);

                return (
                  <th
                    key={header.id}
                    className={styles.heading}
                    aria-sort={header.column.getCanSort() ? ariaSort : undefined}
                  >
                    {header.column.getCanSort() ? (
                      <button
                        type="button"
                        className={styles.headingButton}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <span>
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </span>
                        <span className={styles.sortIndicator} aria-hidden="true">
                          {sortIndicator}
                        </span>
                      </button>
                    ) : (
                      flexRender(header.column.columnDef.header, header.getContext())
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={styles.row}>
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cellClassName({
                    columnId: cell.column.id,
                    value: cell.getValue(),
                  })}
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
};

type DescriptionCellProps = {
  /**
   * Row whose description should be rendered.
   */
  row: ArgRow;
};

const DescriptionCell = (props: DescriptionCellProps) => {
  const { row } = props;

  if (!row.description && row.descriptionTags.length === 0) {
    return null;
  }

  return (
    <div className={styles.descriptionStack}>
      {row.description ? <p className={styles.descriptionText}>{row.description}</p> : null}
      {row.descriptionTags.map((tag) => (
        <DescriptionTagBlock key={tag.label} tag={tag} />
      ))}
    </div>
  );
};

type DescriptionTagBlockProps = {
  /**
   * Render-ready JSDoc tag metadata.
   */
  tag: ArgDescriptionTag;
};

const DescriptionTagBlock = (props: DescriptionTagBlockProps) => {
  const { tag } = props;

  return (
    <div className={styles.descriptionTag}>
      <span className={styles.descriptionTagLabel}>{tag.label}</span>
      {tag.value ? <span className={styles.descriptionTagBody}>{tag.value}</span> : null}
    </div>
  );
};

type TypePopoverContentViewProps = {
  /**
   * Active popover content.
   */
  popover: TypePopoverContent;
  /**
   * Related entry index used for nested clickable types.
   */
  relatedIndex: RelatedIndex;
};

const TypePopoverContentView = (props: TypePopoverContentViewProps) => {
  const { popover, relatedIndex } = props;
  const [nestedPopover, setNestedPopover] = useState<TypePopoverContent | null>(null);

  const onNestedTypeClick = useCallback<OpenTypePopover>((content) => {
    setNestedPopover(content);
  }, []);

  return (
    <>
      <div className={styles.popoverHeader}>
        <code className={styles.popoverTitle}>{popover.title}</code>
        <Popover.Close aria-label="Close" className={styles.popoverClose}>
          <span aria-hidden="true">&times;</span>
        </Popover.Close>
      </div>
      <span className={styles.popoverKind}>{popover.kind}</span>
      {popover.properties.length > 0 ? (
        <Popover.Root modal={false}>
          <ArgTableRows
            properties={popover.properties}
            relatedIndex={relatedIndex}
            onTypeClick={onNestedTypeClick}
          />

          <Popover.Content
            aria-label={nestedPopover ? `Type ${nestedPopover.title}` : undefined}
            className={styles.popover}
          >
            {nestedPopover ? (
              <TypePopoverContentView
                key={`${nestedPopover.kind}:${nestedPopover.title}`}
                popover={nestedPopover}
                relatedIndex={relatedIndex}
              />
            ) : null}
          </Popover.Content>
        </Popover.Root>
      ) : (
        <pre className={styles.popoverCode}>{formatDocType(popover.type)}</pre>
      )}
      {popover.description ? (
        <p className={styles.popoverDescription}>{popover.description}</p>
      ) : null}
    </>
  );
};

type CellClassNameOptions = {
  /**
   * Table column id.
   */
  columnId: string;
  /**
   * Current cell value.
   */
  value: unknown;
};

const cellClassName = (options: CellClassNameOptions): string => {
  const { columnId, value } = options;
  const classNames = [styles.cell];

  if (columnId === "name") {
    classNames.push(styles.nameCell);
  }

  if (columnId === "docType") {
    classNames.push(styles.typeCell);
  }

  if (columnId === "required") {
    classNames.push(value ? styles.requiredCell : styles.optionalCell);
  }

  return classNames.join(" ");
};
