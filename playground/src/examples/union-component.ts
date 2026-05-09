import type { PropsWithChildren } from "react";

import type { ComponentDOMProps, ComponentTone } from "./shared";

type ComponentUnionBaseProps = ComponentDOMProps &
  PropsWithChildren<{
    /**
     * Visual tone shared by all branches.
     *
     * @default "neutral"
     */
    tone?: ComponentTone;
  }>;

type ComponentSingleBranchProps = ComponentUnionBaseProps & {
  /**
   * Single-value mode flag.
   *
   * @default false
   */
  multiple?: false;

  /**
   * Controlled value for single-value mode.
   */
  value?: string | null;

  /**
   * Initial value for single-value mode.
   */
  defaultValue?: string;

  /**
   * Called when the single value changes.
   */
  onChange?: (value: string | null) => void;
};

type ComponentMultipleBranchProps = ComponentUnionBaseProps & {
  /**
   * Multiple-value mode flag.
   */
  multiple: true;

  /**
   * Controlled values for multiple-value mode.
   */
  value?: string[];

  /**
   * Initial values for multiple-value mode.
   */
  defaultValue?: string[];

  /**
   * Called when the multiple values change.
   */
  onChange?: (value: string[]) => void;
};

export type ComponentUnionProps = ComponentSingleBranchProps | ComponentMultipleBranchProps;
