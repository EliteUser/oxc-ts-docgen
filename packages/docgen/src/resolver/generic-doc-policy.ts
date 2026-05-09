import type { DocType, DocTypeParam } from "../schema/doc-schema";
export type GenericDocPolicy = ReadonlyMap<string, DocType>;
export const createGenericDocPolicy = (typeParameters: DocTypeParam[]): GenericDocPolicy => {
  const displayTypes = new Map<string, DocType>();
  for (const param of typeParameters) {
    const displayType = param.constraint ?? param.default;
    if (displayType) {
      displayTypes.set(param.name, displayType);
    }
  }
  return displayTypes;
};
export const resolveGenericDisplayType = (
  name: string,
  policy: GenericDocPolicy | undefined,
): DocType | undefined => {
  return policy?.get(name);
};
