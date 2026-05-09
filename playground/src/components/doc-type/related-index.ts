import type { DocEntry } from "@synthfall/oxc-ts-docgen";

import type { ReferenceDocType, RelatedIndex } from "../arg-table/arg-table-model";

export const buildRelatedIndex = (related: DocEntry[]): RelatedIndex => {
  const byTarget = new Map<string, DocEntry>();
  const byName = new Map<string, DocEntry>();
  const ambiguousNames = new Set<string>();

  for (const entry of related) {
    byTarget.set(relatedTargetKey(entry.source.filePath, entry.name), entry);

    if (byName.has(entry.name)) {
      ambiguousNames.add(entry.name);
    } else {
      byName.set(entry.name, entry);
    }
  }

  for (const name of ambiguousNames) {
    byName.delete(name);
  }

  return { byTarget, byName };
};

export const findRelatedEntry = (
  ref: ReferenceDocType,
  relatedIndex: RelatedIndex,
): DocEntry | undefined => {
  if (ref.target) {
    const targeted = relatedIndex.byTarget.get(
      relatedTargetKey(ref.target.filePath, ref.target.name),
    );

    if (targeted) {
      return targeted;
    }
  }

  return relatedIndex.byName.get(ref.name);
};

const relatedTargetKey = (filePath: string, typeName: string): string => {
  return `${filePath.replace(/\\/g, "/")}:${typeName}`;
};
