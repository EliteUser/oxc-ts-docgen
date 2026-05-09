import type { ButtonProps } from "./button";

/**
 * IconButton extends ButtonProps with an icon.
 */
export interface IconButtonProps extends ButtonProps {
  /**
   * Icon name to display.
   */
  icon: string;
  /**
   * Whether to show only the icon.
   */
  iconOnly?: boolean;
}
