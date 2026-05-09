/**
 * Public design token scale.
 */
export type TokenScale = "space.100" | "space.200" | "space.300";

/**
 * Design token dictionary.
 */
export interface DesignTokens {
  /**
   * Space tokens.
   */
  space: Record<TokenScale, string>;
  /**
   * Radius tokens.
   */
  radius: {
    sm: string;
    md: string;
  };
}
