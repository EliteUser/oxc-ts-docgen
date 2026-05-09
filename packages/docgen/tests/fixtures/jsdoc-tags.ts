/**
 * A component with many JSDoc tags.
 *
 * @since 1.0.0
 *
 * @see https://example.com/docs
 */
export interface DocumentedProps {
  /**
   * The component's title.
   *
   * @example
   *   "Hello World";
   *
   * @example
   *   "Another example";
   */
  title: string;

  /**
   * A deprecated prop.
   *
   * @deprecated Use `title` instead.
   */
  name?: string;

  /**
   * Size of the component.
   *
   * @since 2.0.0
   *
   * @default medium
   */
  size?: "small" | "medium" | "large";

  /**
   * Internal-only prop.
   *
   * @internal
   */
  _debug?: boolean;

  /**
   * A prop with a custom tag.
   *
   * @category Layout
   */
  width?: number;
}
