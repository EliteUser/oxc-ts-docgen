/**
 * Available button sizes.
 */
export type ButtonSize = "xs" | "s" | "m" | "l" | "xl";

/**
 * Available variants.
 */
export type ButtonVariant = "primary" | "secondary" | "ghost";

/**
 * Base props shared across components.
 */
export interface BaseProps {
  /** Unique identifier. */
  id?: string;
  /** CSS class name. */
  className?: string;
}
