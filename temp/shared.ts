import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  CSSProperties,
  ElementType,
  JSX,
  MouseEventHandler,
  ReactElement,
  ReactNode,
  Ref,
} from "react";

export type DOMProps = {
  /**
   * HTML style attribute.
   */
  style?: CSSProperties;

  /**
   * HTML class attribute.
   */
  className?: string;
};

export type FieldLabelProps = {
  /**
   * Enables disabled label styles.
   *
   * @default false
   */
  disabled?: boolean;

  /**
   * Control label.
   */
  label?: ReactNode;

  /**
   * Accessible label id.
   */
  labelId?: string;

  /**
   * Whether the field is required.
   *
   * @default false
   */
  required?: boolean;

  /**
   * End slot for label-adjacent elements, such as a hint tooltip.
   */
  endSlot?: ReactNode;
};

export type ValidationStatus = "error" | "none";

export type ValidationProps = {
  /**
   * Control validation state.
   */
  validationStatus?: ValidationStatus;

  /**
   * Validation message.
   */
  validationMessage?: ReactNode;
};

export type FieldSize = "s" | "m";

export type FieldBaseProps = DOMProps &
  ValidationProps &
  Pick<FieldLabelProps, "label" | "required"> & {
    /**
     * End slot for elements displayed next to the label above the control.
     */
    labelEndSlot?: FieldLabelProps["endSlot"];

    /**
     * Field size.
     *
     * @default m
     */
    size?: FieldSize;

    /**
     * Whether the field is disabled.
     *
     * @default false
     */
    disabled?: boolean;

    /**
     * Hint displayed below the control.
     */
    hint?: ReactNode;
  };

export type ComponentTag = keyof JSX.IntrinsicElements;

export type PolymorphicComponent<
  BaseProps extends object,
  Type extends ElementType = ElementType,
  DefaultType extends Type = Type,
> = {
  <T extends Type = DefaultType>(
    props: PolymorphicComponentProps<BaseProps, T> & { ref?: ComponentPropsWithRef<T>["ref"] },
  ): ReactNode;
  displayName?: string;
};

export type PolymorphicComponentProps<
  BaseProps extends object,
  T extends ElementType = ElementType,
> = BaseProps & {
  /**
   * Overrides the rendered HTML tag.
   */
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof BaseProps | "as">;

export type FloatingViewMode = "bottom-sheet" | "popover";
export type FloatingContainer = HTMLElement | null;
export type FloatingOpenChangeCallback = (open: boolean) => void;
export type FloatingAfterOpenChangeCallback = (open: boolean) => void;
export type FloatingFocusManagerProps = {
  /**
   * Floating UI context.
   */
  context?: unknown;

  /**
   * Disables focus management.
   */
  disabled?: boolean;

  /**
   * Initial focus target.
   */
  initialFocus?: number;
};

export type FloatingAnchorProps<T = unknown> = {
  /**
   * Anchor element identifier used when multiple anchors are present.
   */
  anchorId?: string;

  /**
   * Resolves the current DOM node when the ref is customized with useImperativeHandle.
   */
  getAnchorReference?: (refObject: T) => HTMLElement | null;

  /**
   * Child element used as the anchor. It must accept a ref.
   */
  children?: ReactElement<Record<string, unknown> | null> & { ref?: Ref<unknown> };
};

export type FloatingTriggerProps = {
  /**
   * Trigger element identifier used when multiple triggers are present.
   */
  triggerId?: string;

  /**
   * Child element used as the trigger. It must accept a ref.
   */
  children?: ReactElement<Record<string, unknown> | null> & { ref?: Ref<unknown> };
};

export type Placement = "top" | "right" | "bottom" | "left";
export type Strategy = "absolute" | "fixed";
export type VirtualElement = { getBoundingClientRect: () => DOMRect };
export type OffsetType = number | { x?: number; y?: number };

export type ModalHeaderPlacement = "center" | "start";
export type ModalHeaderProps = {
  /**
   * Enables the panel close button.
   */
  enableClose?: boolean;

  /**
   * Enables the back button.
   */
  enableBackButton?: boolean;

  /**
   * Click handler for the close button.
   */
  onClose?: MouseEventHandler<HTMLButtonElement>;

  /**
   * Click handler for the back button.
   */
  onBackButtonClick?: MouseEventHandler<HTMLButtonElement>;
};

export type TransitionStatus = "closed" | "open" | "opening" | "closing";

export const useTransitionStatus = (): { status: TransitionStatus } => ({
  status: "closed",
});

export const useFocusManager = (): Record<string, unknown> => ({});

export type FloatingOffsetOptions = OffsetType;

export type RangeCalendar = Record<string, unknown>;

export const useMergeRefs = (): ((node: unknown) => void) => () => {};
