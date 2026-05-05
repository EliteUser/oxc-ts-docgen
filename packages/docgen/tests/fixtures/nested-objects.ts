/**
 * Component with nested style properties.
 */
export interface StyledProps {
  /**
   * Inline style overrides.
   */
  style?: {
    /** Text color. */
    color?: string;
    /** Background color. */
    backgroundColor?: string;
    /** Padding in pixels. */
    padding?: number;
  };

  /**
   * Layout configuration.
   */
  layout: {
    /** Direction of layout. */
    direction: "row" | "column";
    /** Gap between items. */
    gap: number;
    /** Nested margin config. */
    margin: {
      top: number;
      right: number;
      bottom: number;
      left: number;
    };
  };
}
