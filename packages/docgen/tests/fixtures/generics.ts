/**
 * A select option with a generic value.
 */
export interface SelectOption<T> {
  /** Display label. */
  label: string;
  /** The actual value. */
  value: T;
  /** Whether the option is disabled. */
  disabled?: boolean;
}

/**
 * Props for a generic Select component.
 */
export interface SelectProps<T extends string | number = string> {
  /** Available options. */
  options: SelectOption<T>[];
  /** Currently selected value. */
  selected?: T;
  /**
   * Called when the value changes.
   */
  onChange(value: T): void;
}

/**
 * Wrapper type with a generic constraint.
 */
export type Wrapper<T extends object> = {
  /** The wrapped data. */
  data: T;
  /** Metadata as a record. */
  meta: Record<string, unknown>;
};
