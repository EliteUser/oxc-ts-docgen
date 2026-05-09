import type {
  ParamPattern,
  TSEnumDeclaration,
  TSSignature,
  TSType,
  TSLiteral,
  TSTupleElement,
} from "oxc-parser";

type TypeAnnotationLike = {
  /**
   * Wrapped type annotation used by several OXC TS nodes.
   */
  typeAnnotation?: TSType;
};

export type ParamLike = {
  /**
   * OXC node discriminator.
   */
  type: string;
  /**
   * Identifier name when this parameter is a plain identifier.
   */
  name?: string;
  /**
   * Rest element argument.
   */
  argument?: {
    /**
     * OXC node discriminator.
     */
    type: string;
    /**
     * Identifier name.
     */
    name?: string;
    /**
     * Argument type annotation.
     */
    typeAnnotation?: TypeAnnotationLike | null;
  };
  /**
   * Parameter property inner parameter.
   */
  parameter?: {
    /**
     * OXC node discriminator.
     */
    type: string;
    /**
     * Identifier name.
     */
    name?: string;
    /**
     * Parameter type annotation.
     */
    typeAnnotation?: TypeAnnotationLike;
    /**
     * Optional marker.
     */
    optional?: boolean;
  };
  /**
   * Parameter type annotation.
   */
  typeAnnotation?: TypeAnnotationLike | null;
  /**
   * Optional marker.
   */
  optional?: boolean;
  /**
   * Assignment pattern left side.
   */
  left?: {
    /**
     * OXC node discriminator.
     */
    type: string;
    /**
     * Identifier name.
     */
    name?: string;
    /**
     * Left-side type annotation.
     */
    typeAnnotation?: TypeAnnotationLike | null;
  };
};

export type TypeNameLike = {
  /**
   * OXC node discriminator.
   */
  type: string;
  /**
   * Identifier name for simple references.
   */
  name?: string;
  /**
   * Left side of a qualified name.
   */
  left?: TypeNameLike;
  /**
   * Right side of a qualified name.
   */
  right?: {
    /**
     * Identifier name for the qualified right side.
     */
    name: string;
  };
};

export type LiteralLike = {
  /**
   * Literal runtime value reported by OXC.
   */
  value?: unknown;
  /**
   * Original literal source when available.
   */
  raw?: string | null;
};

export type UnaryExpressionLike = {
  /**
   * Unary operator text.
   */
  operator: string;
  /**
   * Unary expression argument.
   */
  argument?: {
    /**
     * Literal argument value when available.
     */
    value?: unknown;
  };
};

export type TupleElementLike = {
  /**
   * OXC node discriminator.
   */
  type: string;
  /**
   * Wrapped type annotation for rest/optional tuple elements.
   */
  typeAnnotation?: TSType;
  /**
   * Wrapped element for named tuple members.
   */
  elementType?: TSTupleElement;
};

export type IndexSignatureLike = {
  /**
   * Index signature parameters.
   */
  parameters: Array<{
    /**
     * Parameter name.
     */
    name: string;
    /**
     * Parameter type annotation.
     */
    typeAnnotation?: TypeAnnotationLike;
  }>;
  /**
   * Indexed value type annotation.
   */
  typeAnnotation?: TypeAnnotationLike;
  /**
   * Whether the indexed property is readonly.
   */
  readonly?: boolean;
  /**
   * Source start offset.
   */
  start: number;
};

export type CallSignatureLike = {
  /**
   * Call signature parameters.
   */
  params?: ParamPattern[];
  /**
   * Call signature return type annotation.
   */
  returnType?: TypeAnnotationLike;
  /**
   * Source start offset.
   */
  start: number;
};

export type EnumInitializerLike =
  | {
      /**
       * Literal node discriminator.
       */
      type: "Literal";
      /**
       * Literal runtime value.
       */
      value?: unknown;
      /**
       * Original literal source.
       */
      raw?: string;
      /**
       * Source start offset.
       */
      start: number;
      /**
       * Source end offset.
       */
      end: number;
    }
  | {
      /**
       * OXC expression node discriminator.
       */
      type: string;
      /**
       * Literal runtime value when available.
       */
      value?: unknown;
      /**
       * Original literal source when available.
       */
      raw?: string;
      /**
       * Unary or binary operator.
       */
      operator?: string;
      /**
       * Unary expression argument.
       */
      argument?: EnumInitializerLike;
      /**
       * Binary expression left side.
       */
      left?: EnumInitializerLike;
      /**
       * Binary expression right side.
       */
      right?: EnumInitializerLike;
      /**
       * Source start offset.
       */
      start: number;
      /**
       * Source end offset.
       */
      end: number;
    };

export type EnumMemberLike = {
  /**
   * OXC node discriminator.
   */
  type: string;
  /**
   * Enum member id node.
   */
  id: {
    /**
     * OXC id node discriminator.
     */
    type: string;
    /**
     * Identifier name when present.
     */
    name?: string;
    /**
     * Literal id value when present.
     */
    value?: unknown;
  };
  /**
   * Optional enum initializer.
   */
  initializer?: EnumInitializerLike | null;
  /**
   * Source start offset.
   */
  start: number;
};

export const getWrappedTypeAnnotation = (node: unknown): TSType | undefined => {
  return (node as TypeAnnotationLike).typeAnnotation;
};

export const getTypeArgumentParams = (node: unknown): TSType[] => {
  const compatible = node as {
    /**
     * Generic type arguments wrapper.
     */
    typeArguments?: {
      /**
       * Generic argument params.
       */
      params?: TSType[];
    } | null;
  };

  return compatible.typeArguments?.params ?? [];
};

export const getParamLike = (param: ParamPattern): ParamLike => {
  return param as ParamLike;
};

export const getTypeNameLike = (node: unknown): TypeNameLike => {
  return node as TypeNameLike;
};

export const getLiteralLike = (literal: TSLiteral): LiteralLike => {
  return literal as LiteralLike;
};

export const getUnaryExpressionLike = (literal: TSLiteral): UnaryExpressionLike => {
  return literal as UnaryExpressionLike;
};

export const getTupleElementLike = (element: TSTupleElement): TupleElementLike => {
  return element as TupleElementLike;
};

export const getTupleElementType = (element: TSTupleElement): TSType => {
  return element as unknown as TSType;
};

export const getIndexSignatureLike = (signature: TSSignature): IndexSignatureLike => {
  return signature as unknown as IndexSignatureLike;
};

export const getCallSignatureLike = (signature: TSSignature): CallSignatureLike => {
  return signature as unknown as CallSignatureLike;
};

export const getLiteralKeyValue = (key: unknown): unknown => {
  return (key as LiteralLike).value;
};

export const getEnumMembers = (decl: TSEnumDeclaration): EnumMemberLike[] => {
  const compatible = decl as unknown as {
    /**
     * Current OXC enum body shape.
     */
    body?: {
      /**
       * Enum members in declaration order.
       */
      members?: EnumMemberLike[];
    };
    /**
     * Older OXC enum members shape.
     */
    members?: EnumMemberLike[];
  };

  return compatible.body?.members ?? compatible.members ?? [];
};
