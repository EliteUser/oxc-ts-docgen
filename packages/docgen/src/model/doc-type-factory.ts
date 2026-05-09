import type { DocType } from "../schema/doc-schema";

import { docTypesEqual } from "./doc-type-utils";

export const createPrimitiveDocType = (name: string): DocType => {
  return { kind: "primitive", name };
};

export const createIntrinsicDocType = (name: string): DocType => {
  return { kind: "intrinsic", name };
};

export const createLiteralDocType = (value: string): DocType => {
  return { kind: "literal", value };
};

export const createUnresolvedDocType = (text: string): DocType => {
  return { kind: "unresolved", text };
};

type CreateReferenceDocTypeOptions = {
  /**
   * Referenced type name.
   */
  name: string;
  /**
   * Resolved type arguments for generic references.
   */
  typeArguments?: DocType[];
};

export const createReferenceDocType = (options: CreateReferenceDocTypeOptions): DocType => {
  const { name, typeArguments } = options;

  if (typeArguments && typeArguments.length > 0) {
    return { kind: "reference", name, typeArguments };
  }

  return { kind: "reference", name };
};

const uniqueDocTypes = (members: DocType[]): DocType[] => {
  const unique: DocType[] = [];

  for (const member of members) {
    if (!unique.some((candidate) => docTypesEqual(candidate, member))) {
      unique.push(member);
    }
  }

  return unique;
};

export const createUnionDocType = (members: DocType[]): DocType => {
  const flatMembers = members.flatMap((member) =>
    member.kind === "union" ? member.members : member,
  );
  return { kind: "union", members: uniqueDocTypes(flatMembers) };
};

export const createIntersectionDocType = (members: DocType[]): DocType => {
  const flatMembers = members.flatMap((member) =>
    member.kind === "intersection" ? member.members : member,
  );
  return { kind: "intersection", members: uniqueDocTypes(flatMembers) };
};

export const createArrayDocType = (elementType: DocType): DocType => {
  return { kind: "array", elementType };
};

export const createTupleDocType = (elements: DocType[]): DocType => {
  return { kind: "tuple", elements };
};
