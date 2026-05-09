/**
 * A generic option with a generic value.
 */
export interface GenericOption<T> {
  /**
   * Display label.
   */
  label: string;
  /**
   * The actual value.
   */
  value: T;
  /**
   * Whether the option is disabled.
   */
  disabled?: boolean;
}

/**
 * Props for a generic collection component.
 */
export interface GenericCollectionProps<T extends string | number = string> {
  /**
   * Available options.
   */
  options: GenericOption<T>[];
  /**
   * Currently selected value.
   */
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
  /**
   * The wrapped data.
   */
  data: T;
  /**
   * Metadata as a record.
   */
  meta: Record<string, unknown>;
};
