/**
 * Props for the Button component.
 */
export interface ButtonProps {
  /**
   * Button size.
   *
   * @default m
   */
  size?: ButtonSize;

  /**
   * Visual variant of the button.
   */
  variant: "primary" | "secondary" | "ghost";

  /** Whether the button is disabled. */
  disabled?: boolean;

  /**
   * Click handler.
   */
  onClick?: (event: MouseEvent) => void;

  /** The content of the button. */
  children: React.ReactNode;
}

export type ButtonSize = "xs" | "s" | "m" | "l" | "xl";
