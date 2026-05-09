export type DocSchema = {
  /**
   * Schema format version for downstream renderers.
   */
  version: 1;

  /**
   * Primary documented entries requested by the caller.
   */
  entries: DocEntry[];

  /**
   * Types referenced by the primary entry (aliases, enums, interfaces) resolved from the same
   * project. Omitted or empty when none; not used by the core docgen CLI output unless enabled.
   */
  related?: DocEntry[];
};

export type DocEntry = {
  /**
   * Declared type name.
   */
  name: string;

  /**
   * Top-level TypeScript declaration kind.
   */
  kind: "interface" | "typeAlias" | "enum";

  /**
   * Normalized leading JSDoc description.
   */
  description: string;

  /**
   * Parsed JSDoc tags keyed by lower-case tag name.
   */
  tags: Record<string, DocTagValue>;

  /**
   * Generic type parameters declared on this entry.
   */
  typeParameters: DocTypeParam[];

  /**
   * Object-like properties or enum members exposed by this entry.
   */
  properties: DocProperty[];

  /**
   * Structured type representation for this entry.
   */
  type: DocType;

  /**
   * Source location of the declaration that produced this entry.
   */
  source: DocSourceLocation;

  /**
   * Heritage references that were intentionally preserved instead of expanded.
   */
  heritage?: DocHeritageReference[];
};

export type DocHeritageReferenceReason =
  | "externalReference"
  | "ignored"
  | "unresolved"
  | "unsupported";

export type DocHeritageReference = {
  /**
   * Referenced heritage type name as authored or normalized for display.
   */
  name: string;

  /**
   * Why this heritage type was preserved instead of expanded into properties.
   */
  reason: DocHeritageReferenceReason;

  /**
   * Source location of the heritage clause.
   */
  source: DocSourceLocation;

  /**
   * Project or package declaration target when it can be resolved without expansion.
   */
  target?: DocTypeReferenceTarget;
};

export type DocProperty = {
  /**
   * Property, parameter-like member, signature, or enum member name.
   */
  name: string;

  /**
   * Structured type representation for the property value.
   */
  type: DocType;

  /**
   * Whether the property was declared optional or semantically optional.
   */
  optional: boolean;

  /**
   * Whether the property was declared readonly or made readonly by a utility type.
   */
  readonly: boolean;

  /**
   * Normalized leading JSDoc description for this property.
   */
  description: string;

  /**
   * Parsed JSDoc tags keyed by lower-case tag name.
   */
  tags: Record<string, DocTagValue>;

  /**
   * Parsed `@default` value when available.
   */
  defaultValue: string | undefined;

  /**
   * Source location of the declaration that produced this property.
   */
  source: DocSourceLocation;
};

export type DocTagValue =
  | string
  | number
  | boolean
  | null
  | DocTagValue[]
  | {
      [key: string]: DocTagValue;
    };

export type DocSourceLocation = {
  /**
   * Source file path associated with the schema node.
   */
  filePath: string;

  /**
   * One-based source line.
   */
  line: number;

  /**
   * Zero-based source column.
   */
  column: number;
};

export type DocTypeParam = {
  /**
   * Generic type parameter name.
   */
  name: string;

  /**
   * Generic constraint, such as `T extends string`, when present.
   */
  constraint: DocType | undefined;

  /**
   * Generic default type, such as `T = string`, when present.
   */
  default: DocType | undefined;
};

export type DocFnParam = {
  /**
   * Function parameter name.
   */
  name: string;

  /**
   * Structured type representation for the parameter value.
   */
  type: DocType;

  /**
   * Whether the function parameter is optional.
   */
  optional: boolean;

  /**
   * Whether the function parameter is a rest parameter.
   */
  rest: boolean;
};

export type DocTypeReferenceTarget = {
  /**
   * Referenced project type name.
   */
  name: string;

  /**
   * Source file where the referenced project type was resolved.
   */
  filePath: string;
};

export type DocType =
  | {
      /**
       * Type node discriminator.
       */
      kind: "primitive";

      /**
       * Primitive keyword name, such as `string` or `number`.
       */
      name: string;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "literal";

      /**
       * Literal display value, including quotes for string literals.
       */
      value: string;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "reference";

      /**
       * Referenced type name.
       */
      name: string;

      /**
       * Generic type arguments applied to the reference.
       */
      typeArguments?: DocType[];

      /**
       * Whether the reference points back to a currently resolving type.
       */
      circular?: boolean;

      /**
       * Project-local declaration target when it can be resolved.
       */
      target?: DocTypeReferenceTarget;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "union";

      /**
       * Union member types in source/checker order.
       */
      members: DocType[];
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "intersection";

      /**
       * Intersection member types in source/checker order.
       */
      members: DocType[];
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "array";

      /**
       * Array element type.
       */
      elementType: DocType;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "tuple";

      /**
       * Tuple element types in declaration order.
       */
      elements: DocType[];
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "object";

      /**
       * Object-like properties exposed by this type.
       */
      properties: DocProperty[];
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "function";

      /**
       * Function parameters in declaration order.
       */
      parameters: DocFnParam[];

      /**
       * Function return type.
       */
      returnType: DocType;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "mapped";

      /**
       * Mapped type parameter name.
       */
      parameter: string;

      /**
       * Constraint for the mapped key parameter.
       */
      constraint: DocType;

      /**
       * Value type produced for each mapped key.
       */
      type: DocType;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "conditional";

      /**
       * Conditional check type before `extends`.
       */
      checkType: DocType;

      /**
       * Conditional constraint type after `extends`.
       */
      extendsType: DocType;

      /**
       * Type produced by the true branch.
       */
      trueType: DocType;

      /**
       * Type produced by the false branch.
       */
      falseType: DocType;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "indexedAccess";

      /**
       * Object type being indexed.
       */
      objectType: DocType;

      /**
       * Index type used to access the object type.
       */
      indexType: DocType;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "templateLiteral";

      /**
       * Template literal text and type spans.
       */
      spans: TemplateLiteralSpan[];
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "keyof";

      /**
       * Type operand for the `keyof` operator.
       */
      type: DocType;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "typeof";

      /**
       * Identifier or qualified name used by the `typeof` query.
       */
      name: string;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "infer";

      /**
       * Inferred type parameter name.
       */
      name: string;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "rest";

      /**
       * Rest element type.
       */
      type: DocType;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "intrinsic";

      /**
       * Intrinsic TypeScript type name, such as `unknown`, `void`, or `never`.
       */
      name: string;
    }
  | {
      /**
       * Type node discriminator.
       */
      kind: "unresolved";

      /**
       * Human-readable fallback text for syntax that was intentionally not expanded.
       */
      text: string;
    };

export type TemplateLiteralSpan =
  | {
      /**
       * Type interpolation span.
       */
      type: DocType;
    }
  | {
      /**
       * Static template text span.
       */
      text: string;
    };
