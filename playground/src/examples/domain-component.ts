import type { ReactNode } from "react";

import type { ComponentDOMProps, ComponentItem, ComponentRange, ComponentStatus } from "./shared";

export type ComponentScalarValue = string | number | Date;

export type ComponentResolvedValue = Required<
  Readonly<{
    /**
     * Current domain value.
     */
    value: ComponentScalarValue;

    /**
     * Current status for the value.
     */
    status: ComponentStatus;
  }>
>;

export type ComponentFormatter = (
  value: ComponentScalarValue,
  options?: { locale: string },
) => string;

export type ComponentDomainState = Required<Readonly<Pick<ComponentDomainProps, "locale">>> &
  Readonly<{
    /**
     * Current visible value range.
     */
    range?: ComponentRange<ComponentScalarValue>;
  }> & {
    /**
     * Current resolved value.
     */
    readonly current: ComponentResolvedValue | null;

    /**
     * All available items in the domain model.
     */
    readonly items: Array<ComponentItem<ComponentScalarValue>>;

    /**
     * Formats a value for display.
     */
    formatValue: ComponentFormatter;

    /**
     * Sets the current value.
     */
    setValue(value: ComponentScalarValue | null): void;

    /**
     * Returns true when an item can be selected.
     */
    isSelectable(item: ComponentItem<ComponentScalarValue>): boolean;
  };

export type ComponentDomainProps = ComponentDOMProps & {
  /**
   * Locale used by formatter callbacks.
   *
   * @default "en-US"
   */
  locale?: string;

  /**
   * Controlled value for the domain model.
   */
  value?: ComponentScalarValue | null;

  /**
   * Initial value for uncontrolled usage.
   */
  defaultValue?: ComponentScalarValue;

  /**
   * Available items in the domain model.
   */
  items?: Array<ComponentItem<ComponentScalarValue>>;

  /**
   * Optional visible value range.
   */
  range?: ComponentRange<ComponentScalarValue>;

  /**
   * Custom renderer for the current domain state.
   */
  renderState?: (state: ComponentDomainState) => ReactNode;

  /**
   * Called when the current value changes.
   */
  onChange?: (value: ComponentScalarValue | null) => void;
};
