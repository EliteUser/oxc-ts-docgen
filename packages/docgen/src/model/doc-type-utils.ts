import type { DocType } from "../schema/doc-schema";
export const flattenUnion = (type: DocType): DocType[] => {
  return type.kind === "union" ? type.members : [type];
};
export const unionOrFallback = (members: DocType[], fallback: DocType): DocType => {
  if (members.length === 0) {
    return fallback;
  }
  return members.length === 1 ? members[0] : { kind: "union", members };
};
export const unionOrNever = (members: DocType[]): DocType => {
  return unionOrFallback(members, { kind: "intrinsic", name: "never" });
};
export const normalizeBooleanLiteralUnion = (type: DocType): DocType => {
  const members = flattenUnion(type);
  if (members.length !== 2) {
    return type;
  }
  const literalValues = new Set(
    members.filter((member) => member.kind === "literal").map((member) => member.value),
  );

  if (literalValues.has("false") && literalValues.has("true")) {
    return { kind: "primitive", name: "boolean" };
  }

  return type;
};
type RemoveIntrinsicUnionMembersOptions = {
  type: DocType;
  names: readonly string[];
  emptyFallback: DocType;
};

export const removeIntrinsicUnionMembers = (
  options: RemoveIntrinsicUnionMembersOptions,
): DocType => {
  const { type, names, emptyFallback } = options;
  const blocked = new Set(names);
  const members = flattenUnion(type).filter(
    (member) => !(member.kind === "intrinsic" && blocked.has(member.name)),
  );
  if (type.kind !== "union") {
    return members.length === 0 ? emptyFallback : type;
  }
  return unionOrFallback(members, emptyFallback);
};
export const docTypesEqual = (left: DocType, right: DocType): boolean => {
  return JSON.stringify(left) === JSON.stringify(right);
};
