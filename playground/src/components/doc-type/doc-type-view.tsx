import type { DocType } from "@synthfall/oxc-ts-docgen";
import type { ReactNode } from "react";

import type { OpenTypePopover, ReferenceDocType, RelatedIndex } from "../arg-table/arg-table-model";

import { Popover } from "../popover/popover";
import { formatDocType } from "./doc-type-format";
import styles from "./doc-type-view.module.css";
import { findRelatedEntry } from "./related-index";

type RenderDocTypeOptions = {
  /**
   * Structured type to render.
   */
  docType: DocType;
  /**
   * Source-aware related entry index.
   */
  relatedIndex: RelatedIndex;
  /**
   * Popover opener for clickable references and object literals.
   */
  onTypeClick: OpenTypePopover;
};

export const renderDocType = (options: RenderDocTypeOptions): ReactNode => {
  const { docType, relatedIndex, onTypeClick } = options;

  switch (docType.kind) {
    case "reference": {
      const args = docType.typeArguments;
      if (!args?.length) {
        return renderRefName({
          ref: docType,
          relatedIndex,
          onTypeClick,
        });
      }

      return (
        <>
          {renderRefName({
            ref: docType,
            relatedIndex,
            onTypeClick,
          })}
          {"<"}
          {args.map((arg, index) => (
            <span key={index}>
              {index > 0 ? ", " : null}
              {renderDocType({
                docType: arg,
                relatedIndex,
                onTypeClick,
              })}
            </span>
          ))}
          {">"}
        </>
      );
    }
    case "union":
      return docType.members.map((member, index) => (
        <span key={index}>
          {index > 0 ? " | " : null}
          {renderDocType({
            docType: member,
            relatedIndex,
            onTypeClick,
          })}
        </span>
      ));
    case "intersection":
      return docType.members.map((member, index) => (
        <span key={index}>
          {index > 0 ? " & " : null}
          {renderDocType({
            docType: member,
            relatedIndex,
            onTypeClick,
          })}
        </span>
      ));
    case "array":
      return (
        <>
          {renderDocType({
            docType: docType.elementType,
            relatedIndex,
            onTypeClick,
          })}
          {"[]"}
        </>
      );
    case "tuple":
      return (
        <>
          [
          {docType.elements.map((element, index) => (
            <span key={index}>
              {index > 0 ? ", " : null}
              {renderDocType({
                docType: element,
                relatedIndex,
                onTypeClick,
              })}
            </span>
          ))}
          ]
        </>
      );
    case "function": {
      const params = docType.parameters.map((param, index) => (
        <span key={index}>
          {index > 0 ? ", " : null}
          {param.name}:{" "}
          {renderDocType({
            docType: param.type,
            relatedIndex,
            onTypeClick,
          })}
        </span>
      ));

      return (
        <>
          ({params}) =&gt;{" "}
          {renderDocType({
            docType: docType.returnType,
            relatedIndex,
            onTypeClick,
          })}
        </>
      );
    }
    case "object":
      if (docType.properties.length === 0) {
        return "{}";
      }

      return (
        <TypeLinkButton
          onClick={() =>
            onTypeClick({
              title: "{ ... }",
              kind: "object",
              type: docType,
              properties: docType.properties,
              description: "",
            })
          }
        >
          {"{ ... }"}
        </TypeLinkButton>
      );
    default:
      return formatDocType(docType);
  }
};

type RenderRefNameOptions = {
  /**
   * Reference type to render.
   */
  ref: ReferenceDocType;
  /**
   * Source-aware related entry index.
   */
  relatedIndex: RelatedIndex;
  /**
   * Popover opener for clickable references.
   */
  onTypeClick: OpenTypePopover;
};

const renderRefName = (options: RenderRefNameOptions): ReactNode => {
  const { ref, relatedIndex, onTypeClick } = options;
  const entry = findRelatedEntry(ref, relatedIndex);

  if (!entry) {
    return ref.name;
  }

  return (
    <TypeLinkButton
      onClick={() =>
        onTypeClick({
          title: entry.name,
          kind: entry.kind,
          type: entry.type,
          properties: entry.properties,
          description: entry.description,
        })
      }
    >
      {ref.name}
    </TypeLinkButton>
  );
};

type TypeLinkButtonProps = {
  /**
   * Clickable inline content.
   */
  children: ReactNode;
  /**
   * Opens a popover for the clicked type.
   */
  onClick: () => void;
};

const TypeLinkButton = (props: TypeLinkButtonProps) => {
  const { children, onClick } = props;

  return (
    <Popover.Trigger
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={styles.link}
      toggleOnClick={false}
    >
      {children}
    </Popover.Trigger>
  );
};
