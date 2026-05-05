import type { ButtonSize, ButtonVariant } from "./types";
import type { BaseProps } from "./types";

/**
 * Button component props.
 */
export interface ButtonProps extends BaseProps {
  /**
   * The size of the button.
   *
   * @default m
   */
  size?: ButtonSize;

  /**
   * Visual style variant.
   */
  variant: ButtonVariant;

  /** Whether the button is disabled. */
  disabled?: boolean;
}
