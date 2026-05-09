/**
 * Configuration for the theme.
 */
export type ThemeConfig = {
  /**
   * Primary color.
   *
   * @default #000000
   */
  primaryColor: string;

  /**
   * Font size in pixels.
   */
  fontSize: number;

  /**
   * Whether dark mode is enabled.
   */
  darkMode?: boolean;

  /**
   * Border radius.
   */
  readonly borderRadius: number;
};
