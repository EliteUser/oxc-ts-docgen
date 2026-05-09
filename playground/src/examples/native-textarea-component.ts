import type { ChangeEvent, ReactNode, TextareaHTMLAttributes } from "react";

import type { ComponentDOMProps, ComponentFieldBaseProps } from "./shared";

export type ComponentTextAreaChangeHandler = (
  value: string,
  event: ChangeEvent<HTMLTextAreaElement>,
) => void;

export interface ComponentTextAreaProps
  extends
    ComponentDOMProps,
    Omit<ComponentFieldBaseProps, "size">,
    Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "defaultValue" | "onChange"> {
  /**
   * Controlled text value.
   */
  value?: string;

  /**
   * Initial text value for uncontrolled usage.
   */
  defaultValue?: string;

  /**
   * Called when the text value changes.
   */
  onChange?: ComponentTextAreaChangeHandler;

  /**
   * Placeholder text shown when value is empty.
   */
  placeholder?: string;

  /**
   * Trailing content rendered inside the control.
   */
  trailingContent?: ReactNode;

  /**
   * Enables automatic height growth based on content.
   *
   * @default false
   */
  autosize?: boolean;

  /**
   * Minimum visible row count.
   *
   * @default 2
   */
  minRows?: number;

  /**
   * Maximum visible row count.
   *
   * @default 12
   */
  maxRows?: number;
}
