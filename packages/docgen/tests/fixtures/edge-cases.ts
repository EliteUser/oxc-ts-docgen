/**
 * Empty interface.
 */
export interface EmptyProps {}

/**
 * Interface with no JSDoc on members.
 */
export interface NoDocProps {
  foo: string;
  bar: number;
  baz?: boolean;
}

/**
 * Interface with method signatures.
 */
export interface WithMethods {
  /**
   * Simple getter.
   */
  getName(): string;
  /**
   * Setter with param.
   */
  setName(name: string): void;
  /**
   * Method with multiple params.
   */
  calculate(a: number, b: number, op?: string): number;
}

/**
 * String literal keys.
 */
export interface StringKeys {
  "data-testid": string;
  "aria-label"?: string;
}

/**
 * Numeric literal value.
 */
export type HttpStatus = 200 | 404 | 500;

/**
 * Boolean literal.
 */
export type True = true;

/**
 * Typeof usage.
 */
export declare const defaults: { color: string };
export type Defaults = typeof defaults;
