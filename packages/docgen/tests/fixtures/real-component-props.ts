export type ReactNode = string | number | boolean | null;

export interface QaProps {
  /**
   * Test automation marker.
   */
  qa?: string;
}

export interface AriaLabelingProps {
  /**
   * Accessible label.
   */
  "aria-label"?: string;
  /**
   * Referenced accessible label id.
   */
  "aria-labelledby"?: string;
}

export interface DOMProps {
  /**
   * DOM id.
   */
  id?: string;
  /**
   * CSS class name.
   */
  className?: string;
}

export interface ValidationProps {
  /**
   * Whether the field is invalid.
   */
  isInvalid?: boolean;
  /**
   * Validation state shown by the control.
   */
  validationState?: "valid" | "invalid";
}

export type StyleProp<T> = T | ((theme: "light" | "dark") => T);

export interface BoxProps extends DOMProps {
  /**
   * Inline display style.
   */
  display?: StyleProp<"block" | "inline-flex" | "none">;
}

export type ButtonView = "normal" | "outlined" | "raised" | "flat";
export type ButtonSize = "xs" | "s" | "m" | "l" | "xl";

export interface ButtonBaseProps extends QaProps, AriaLabelingProps {
  /**
   * Visual size.
   */
  size?: ButtonSize;
  /**
   * Visual view.
   */
  view?: ButtonView;
  /**
   * Disabled state.
   */
  disabled?: boolean;
  /**
   * Button content.
   */
  children?: ReactNode;
}

export type ButtonProps = ButtonBaseProps &
  Omit<BoxProps, "display"> & {
    /**
     * Loading state.
     */
    loading?: boolean;
    /**
     * Click handler.
     */
    onClick?: (event: { currentTarget: HTMLButtonElement }) => void;
  };

export interface TextFieldBaseProps extends AriaLabelingProps, ValidationProps {
  /**
   * Current value.
   */
  value?: string;
  /**
   * Placeholder text.
   */
  placeholder?: string;
  /**
   * Change handler.
   */
  onChange?: (value: string) => void;
}

export type TextFieldProps = TextFieldBaseProps &
  Pick<BoxProps, "id" | "className"> & {
    /**
     * Field label.
     */
    label?: ReactNode;
    /**
     * Optional description.
     */
    description?: ReactNode;
  };
