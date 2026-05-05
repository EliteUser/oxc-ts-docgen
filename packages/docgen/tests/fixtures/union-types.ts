/**
 * Size values.
 */
export type Size = "xs" | "s" | "m" | "l" | "xl";

/**
 * A value that can be a string or a number.
 */
export type StringOrNumber = string | number;

/**
 * Nullable string.
 */
export type NullableString = string | null | undefined;

/**
 * Discriminated union.
 */
export type Shape =
  | { kind: "circle"; radius: number }
  | { kind: "square"; side: number }
  | { kind: "rectangle"; width: number; height: number };
