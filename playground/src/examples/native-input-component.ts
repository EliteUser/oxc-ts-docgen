import type { AriaAttributes, ChangeEvent, InputHTMLAttributes, ReactNode } from "react";

import type { ComponentDOMProps, ComponentFieldBaseProps } from "./shared";

export type ComponentInputChangeHandler = (
  value: boolean,
  event: ChangeEvent<HTMLInputElement>,
) => void;

export type ComponentInputProps = ComponentDOMProps &
  Pick<ComponentFieldBaseProps, "label" | "required" | "disabled" | "hint" | "validationState"> &
  Pick<AriaAttributes, "aria-label" | "aria-labelledby" | "aria-describedby"> &
  Omit<
    InputHTMLAttributes<HTMLInputElement>,
    "value" | "defaultValue" | "onChange" | "size" | "disabled" | "required"
  > & {
    /**
     * Controlled boolean value.
     *
     * @default false
     */
    value?: boolean;

    /**
     * Initial boolean value for uncontrolled usage.
     *
     * @default false
     */
    defaultValue?: boolean;

    /**
     * Intermediate visual state for partially selected groups.
     *
     * @default false
     */
    mixed?: boolean;

    /**
     * Secondary content displayed below the label.
     */
    description?: ReactNode;

    /**
     * Form value submitted by the native input.
     */
    nativeValue?: string;

    /**
     * Called when the boolean value changes.
     */
    onChange?: ComponentInputChangeHandler;
  };
