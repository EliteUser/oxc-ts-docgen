import type * as TypeScript from "typescript";

import type { DocgenConfig } from "../public/config";
import type {
  SemanticFallbackRequest,
  SemanticFallbackResolver,
} from "../resolver/resolution-controller";
import type { TypeResolver } from "../resolver/resolver";
import type { DocEntry, DocProperty, DocType } from "../schema/doc-schema";
import type { SemanticResolverContext } from "./semantic-doc-type-builder";

import { createUnionDocType } from "../model/doc-type-factory";
import { flattenUnion } from "../model/doc-type-utils";
import { isIgnoredTypeName } from "../resolver/ignored-types";
import { getSemanticService, updateSemanticFile } from "../resolver/resolver";
import { normalizePath } from "../utils/path-utils";
import { filterEntryProperties } from "../utils/prop-filter";
import { isSemanticObjectLikeType } from "./semantic-doc-type-builder";
import { buildSemanticProperty } from "./semantic-property-builder";
import { shouldKeepSemanticExternalProperty } from "./semantic-property-policy";

type TargetDeclaration =
  | TypeScript.InterfaceDeclaration
  | TypeScript.TypeAliasDeclaration
  | TypeScript.EnumDeclaration;

type FindTargetDeclarationOptions = {
  /**
   * TypeScript namespace used for declaration narrowing.
   */
  ts: typeof TypeScript;
  /**
   * Source file containing top-level candidate declarations.
   */
  sourceFile: TypeScript.SourceFile;
  /**
   * Requested exported type name to resolve.
   */
  typeName: string;
};

type GetDeclarationTypeOptions = {
  /**
   * TypeScript namespace for declaration kind checks.
   */
  ts: typeof TypeScript;
  /**
   * Checker used to read declaration-backed types.
   */
  checker: TypeScript.TypeChecker;
  /**
   * Resolved declaration target for semantic conversion.
   */
  declaration: TargetDeclaration;
};
type BuildSemanticPropertiesOptions = {
  /**
   * Semantic resolver context for TypeScript symbol conversion.
   */
  context: SemanticResolverContext;
  /**
   * TypeScript type whose properties should be converted.
   */
  type: TypeScript.Type;
};

export class TypeScriptSemanticFallbackResolver implements SemanticFallbackResolver {
  private readonly config: DocgenConfig;
  private readonly resolver: TypeResolver;

  constructor(config: DocgenConfig, resolver: TypeResolver) {
    this.config = config;
    this.resolver = resolver;
  }

  resolveEntry(request: SemanticFallbackRequest): DocEntry | undefined {
    if (request.sourceText !== undefined) {
      updateSemanticFile({
        resolver: this.resolver,
        filePath: request.filePath,
        source: request.sourceText,
      });
    }

    const service = getSemanticService(this.resolver, request.filePath);
    const program = service.getProgram();
    const checker = program?.getTypeChecker();

    if (!program || !checker) {
      return undefined;
    }

    const sourceFile = program.getSourceFile(normalizePath(request.filePath));

    if (!sourceFile) {
      return undefined;
    }

    const ts = service.getTypeScript();
    const declaration = findTargetDeclaration({
      ts,
      sourceFile,
      typeName: request.typeName,
    });

    if (!declaration) {
      return undefined;
    }

    const type = getDeclarationType({ ts, checker, declaration });

    if (!type) {
      return undefined;
    }

    const context: SemanticResolverContext = {
      ts,
      checker,
      rootFile: normalizePath(request.filePath),
      config: this.config,
    };

    if (!isSemanticObjectLikeType({ context, type })) {
      return undefined;
    }

    const rootFile = normalizePath(request.filePath);
    const staticPropertiesByName =
      request.staticEntry.type.kind === "union" && request.staticEntry.properties.length > 0
        ? new Map(request.staticEntry.properties.map((property) => [property.name, property]))
        : undefined;
    const filteredSemanticProperties = buildSemanticProperties({ context, type }).filter((prop) =>
      shouldKeepSemanticExternalProperty({
        prop,
        config: this.config,
        rootFile,
        owner: request.staticEntry,
      }),
    );
    const filteredProperties = staticPropertiesByName
      ? mergeStaticAndSemanticUnionProperties({
          staticProperties: request.staticEntry.properties,
          semanticProperties: filteredSemanticProperties,
        })
      : filteredSemanticProperties;

    return filterEntryProperties({
      entry: {
        ...request.staticEntry,
        properties: filteredProperties,
        type:
          request.staticEntry.type.kind === "union"
            ? request.staticEntry.type
            : { kind: "object", properties: filteredProperties },
      },
      config: this.config,
      rootFile,
    });
  }
}

type MergeStaticAndSemanticUnionPropertiesOptions = {
  /**
   * Canonical properties produced by the static union resolver.
   */
  staticProperties: DocProperty[];
  /**
   * Semantic properties collected per union constituent.
   */
  semanticProperties: DocProperty[];
};

const buildSemanticProperties = (options: BuildSemanticPropertiesOptions): DocProperty[] => {
  const { context, type } = options;
  if (!type.isUnion()) {
    return buildSemanticPropertiesForType({ context, type });
  }

  const properties: DocProperty[] = [];
  for (const member of type.types) {
    mergeUnionProperties(properties, buildSemanticPropertiesForType({ context, type: member }));
  }

  return properties;
};

const buildSemanticPropertiesForType = (options: BuildSemanticPropertiesOptions): DocProperty[] => {
  const { context, type } = options;
  return context.checker
    .getPropertiesOfType(type)
    .filter((symbol) => !isIgnoredSemanticPropertyContainer({ context, symbol }))
    .map((symbol) =>
      buildSemanticProperty({
        context,
        symbol,
      }),
    );
};

const isIgnoredSemanticPropertyContainer = (options: {
  context: SemanticResolverContext;
  symbol: TypeScript.Symbol;
}): boolean => {
  const { context, symbol } = options;
  const declaration = symbol.valueDeclaration ?? symbol.declarations?.[0];
  const containerName = declaration ? findContainingTypeName({ context, declaration }) : undefined;
  return containerName ? isIgnoredTypeName({ config: context.config, name: containerName }) : false;
};

const findContainingTypeName = (options: {
  context: SemanticResolverContext;
  declaration: TypeScript.Declaration;
}): string | undefined => {
  const { context } = options;
  let current: TypeScript.Node | undefined = options.declaration;

  while (current) {
    if (
      (context.ts.isInterfaceDeclaration(current) || context.ts.isTypeAliasDeclaration(current)) &&
      current.name
    ) {
      return current.name.text;
    }
    current = current.parent;
  }

  return undefined;
};

const mergeStaticAndSemanticUnionProperties = (
  options: MergeStaticAndSemanticUnionPropertiesOptions,
): DocProperty[] => {
  const { staticProperties, semanticProperties } = options;
  const semanticPropertiesByName = new Map(
    semanticProperties.map((property) => [property.name, property]),
  );
  const staticNames = new Set(staticProperties.map((property) => property.name));
  const mergedStaticProperties = staticProperties.map((property) => {
    const semanticProperty = semanticPropertiesByName.get(property.name);
    if (!semanticProperty) {
      return normalizeUnionPropertyType(property);
    }

    return normalizeUnionPropertyType({
      ...semanticProperty,
      description: semanticProperty.description || property.description,
      tags: { ...property.tags, ...semanticProperty.tags },
      defaultValue: semanticProperty.defaultValue ?? property.defaultValue,
    });
  });
  const semanticOnlyProperties = semanticProperties.filter((property) => {
    return !staticNames.has(property.name);
  });

  return [...mergedStaticProperties, ...semanticOnlyProperties.map(normalizeUnionPropertyType)];
};

const normalizeUnionPropertyType = (property: DocProperty): DocProperty => {
  return {
    ...property,
    type: normalizeMergedUnionDocType(property.type, property.optional),
  };
};

const normalizeMergedUnionDocType = (type: DocType, optional = false): DocType => {
  if (type.kind !== "union") {
    return type;
  }

  const membersWithoutBottomTypes = type.members.filter((member) => {
    if (isNeverDocType(member)) {
      return false;
    }
    if (optional && isUndefinedDocType(member)) {
      return false;
    }
    return true;
  });
  const hasNonNarrowingUtilityMember = membersWithoutBottomTypes.some((member) => {
    return !isNarrowingUtilityReference(member);
  });
  const members = hasNonNarrowingUtilityMember
    ? membersWithoutBottomTypes.filter((member) => !isNarrowingUtilityReference(member))
    : membersWithoutBottomTypes;
  const uniqueMembers = uniqueStructuralDocTypes(members);
  if (uniqueMembers.length === 0) {
    return type;
  }

  const uniqueUnion = createUnionDocType(uniqueMembers);
  if (uniqueUnion.kind === "union" && uniqueUnion.members.length === 1) {
    return uniqueUnion.members[0];
  }

  return uniqueUnion;
};

const isNeverDocType = (type: DocType): boolean => {
  return type.kind === "intrinsic" && type.name === "never";
};

const isUndefinedDocType = (type: DocType): boolean => {
  return type.kind === "intrinsic" && type.name === "undefined";
};

const isNarrowingUtilityReference = (type: DocType): boolean => {
  return type.kind === "reference" && (type.name === "Extract" || type.name === "Exclude");
};

const uniqueStructuralDocTypes = (types: DocType[]): DocType[] => {
  const unique: DocType[] = [];
  const seen = new Set<string>();
  for (const type of types) {
    const fingerprint = structuralDocTypeFingerprint(type);
    if (seen.has(fingerprint)) {
      continue;
    }
    seen.add(fingerprint);
    unique.push(type);
  }
  return unique;
};

const structuralDocTypeFingerprint = (type: DocType): string => {
  return JSON.stringify(type, (key: string, value: unknown) => {
    if (
      key === "target" ||
      key === "source" ||
      key === "description" ||
      key === "tags" ||
      key === "defaultValue"
    ) {
      return undefined;
    }
    return value;
  });
};

const mergeUnionProperties = (target: DocProperty[], additions: DocProperty[]): void => {
  for (const prop of additions) {
    const existingIndex = target.findIndex((candidate) => candidate.name === prop.name);
    if (existingIndex === -1) {
      target.push(prop);
      continue;
    }

    target[existingIndex] = mergeUnionProperty(target[existingIndex], prop);
  }
};

const mergeUnionProperty = (left: DocProperty, right: DocProperty): DocProperty => {
  return {
    ...left,
    type: normalizeMergedUnionDocType(
      createUnionDocType([...flattenUnion(left.type), ...flattenUnion(right.type)]),
      left.optional || right.optional,
    ),
    optional: left.optional || right.optional,
    readonly: left.readonly && right.readonly,
    description: left.description || right.description,
    tags: { ...right.tags, ...left.tags },
    defaultValue: left.defaultValue ?? right.defaultValue,
  };
};

const findTargetDeclaration = (
  options: FindTargetDeclarationOptions,
): TargetDeclaration | undefined => {
  const { ts, sourceFile, typeName } = options;

  for (const statement of sourceFile.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name.text === typeName
    ) {
      return statement;
    }
  }

  return undefined;
};

const getDeclarationType = (options: GetDeclarationTypeOptions): TypeScript.Type | undefined => {
  const { ts, checker, declaration } = options;

  if (ts.isTypeAliasDeclaration(declaration)) {
    return checker.getTypeFromTypeNode(declaration.type);
  }

  return checker.getTypeAtLocation(declaration.name);
};
