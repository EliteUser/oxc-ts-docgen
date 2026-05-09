import type { DocEntry, DocProperty, DocTagValue, DocType } from "@synthfall/oxc-ts-docgen";

export type ArgDescriptionTag = {
  /**
   * Human-readable label for the rendered tag block.
   */
  label: string;
  /**
   * Optional tag body shown after the label.
   */
  value: string;
};

export type ArgRow = {
  /**
   * Displayed property name.
   */
  name: string;
  /**
   * Structured property type rendered in the type column.
   */
  docType: DocType;
  /**
   * Whether the property is required.
   */
  required: boolean;
  /**
   * Display-ready default value.
   */
  defaultValue: string;
  /**
   * Display-ready property description.
   */
  description: string;
  /**
   * JSDoc tags rendered as highlighted description blocks.
   */
  descriptionTags: ArgDescriptionTag[];
};

export type TypePopoverContent = {
  /**
   * Popover title.
   */
  title: string;
  /**
   * Human-readable type kind label.
   */
  kind: string;
  /**
   * Structured type shown when the popover has no nested properties.
   */
  type: DocType;
  /**
   * Nested properties rendered in a table.
   */
  properties: DocProperty[];
  /**
   * Optional description rendered below popover content.
   */
  description: string;
};

export type OpenTypePopover = (popover: TypePopoverContent) => void;

export type RelatedIndex = {
  /**
   * Related entries keyed by resolved source target.
   */
  byTarget: Map<string, DocEntry>;
  /**
   * Related entries keyed by unambiguous type name.
   */
  byName: Map<string, DocEntry>;
};

export type ReferenceDocType = Extract<DocType, { kind: "reference" }>;

type DescriptionTagRenderer = {
  /**
   * Human-readable label for this JSDoc tag.
   */
  label: string;
};

const DESCRIPTION_TAG_RENDERERS: Record<string, DescriptionTagRenderer> = {
  deprecated: {
    label: "Deprecated",
  },
};

export const toRows = (properties: DocProperty[]): ArgRow[] => {
  return properties.map((prop) => ({
    name: prop.name,
    docType: prop.type,
    required: !prop.optional,
    defaultValue: prop.defaultValue ?? "-",
    description: prop.description,
    descriptionTags: toDescriptionTags(prop.tags),
  }));
};

const toDescriptionTags = (tags: Record<string, DocTagValue>): ArgDescriptionTag[] => {
  const renderedTags: ArgDescriptionTag[] = [];

  for (const [tagName, renderer] of Object.entries(DESCRIPTION_TAG_RENDERERS)) {
    const value = tags[tagName];
    if (value === undefined) {
      continue;
    }

    renderedTags.push({
      label: renderer.label,
      value: formatTagValue(value),
    });
  }

  return renderedTags;
};

const formatTagValue = (value: DocTagValue): string => {
  if (value === true || value === null) {
    return "";
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(formatTagValue).filter(Boolean).join("\n");
  }

  return JSON.stringify(value);
};
