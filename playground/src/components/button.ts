/**
 * Available button sizes.
 */
export type ButtonSize = "xs" | "s" | "m" | "l" | "xl";

/** Button variants */
export type ButtonVariant = "primary" | "secondary" | "ghost";

/**
 * Props for the Button component.
 */
export interface ButtonProps {
  /**
   * The size of the button.
   *
   * @default m
   */
  size?: ButtonSize;

  /**
   * Visual variant.
   */
  variant: ButtonVariant;

  /**
   * Whether the button is disabled.
   *
   * @default false
   */
  disabled?: boolean;

  /**
   * Click handler.
   */
  onClick?: (event: MouseEvent) => void;

  /**
   * Button content.
   */
  children: string;
}
