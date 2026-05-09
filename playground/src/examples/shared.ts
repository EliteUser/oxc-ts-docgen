import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  CSSProperties,
  ElementType,
  JSX,
  ReactElement,
  ReactNode,
  Ref,
} from "react";

export type ComponentDOMProps = {
  /**
   * HTML style attribute passed through to the rendered element.
   */
  style?: CSSProperties;

  /**
   * HTML class attribute passed through to the rendered element.
   */
  className?: string;

  /**
   * Stable test id used by docs and examples.
   */
  "data-testid"?: string;
};

export type ComponentSize = "small" | "medium" | "large";

export type ComponentTone = "neutral" | "accent" | "danger";

export type ComponentStatus = "idle" | "active" | "disabled";

export type ComponentValidationState = "valid" | "invalid" | "pending";

export type ComponentValidationProps = {
  /**
   * Validation state displayed by field-like examples.
   */
  validationState?: ComponentValidationState;

  /**
   * Validation message displayed near the field.
   */
  validationMessage?: ReactNode;
};

export type ComponentFieldBaseProps = ComponentDOMProps &
  ComponentValidationProps & {
    /**
     * Accessible label content for the component.
     */
    label?: ReactNode;

    /**
     * Marks the component as required for form submission.
     *
     * @default false
     */
    required?: boolean;

    /**
     * Disables user interaction.
     *
     * @default false
     */
    disabled?: boolean;

    /**
     * Controls the visual density of the field.
     *
     * @default "medium"
     */
    size?: ComponentSize;

    /**
     * Helper content displayed below the field.
     */
    hint?: ReactNode;
  };

export type ComponentTag = keyof JSX.IntrinsicElements;

export type ComponentPolymorphicProps<
  BaseProps extends object,
  T extends ElementType = ElementType,
> = BaseProps & {
  /**
   * Overrides the rendered element type.
   */
  as?: T;
} & Omit<ComponentPropsWithoutRef<T>, keyof BaseProps | "as">;

export type ComponentPolymorphicRender<
  BaseProps extends object,
  Type extends ElementType = ElementType,
  DefaultType extends Type = Type,
> = {
  <T extends Type = DefaultType>(
    props: ComponentPolymorphicProps<BaseProps, T> & {
      /**
       * Ref forwarded to the rendered element.
       */
      ref?: ComponentPropsWithRef<T>["ref"];
    },
  ): ReactNode;
  /**
   * Debug display name used by React DevTools.
   */
  displayName?: string;
};

export type ComponentRange<T> = {
  /**
   * Inclusive range start value.
   */
  start: T;

  /**
   * Inclusive range end value.
   */
  end: T;
};

export type ComponentItem<TValue = string> = {
  /**
   * Stable item id.
   */
  id: string;

  /**
   * Human-readable item label.
   */
  label: ReactNode;

  /**
   * Domain value represented by the item.
   */
  value: TValue;

  /**
   * Disables the item without removing it from the collection.
   *
   * @default false
   */
  disabled?: boolean;
};

export type ComponentViewMode = "inline" | "layer";

export type ComponentOpenChangeHandler = (open: boolean) => void;

export type ComponentLayerOptions = {
  /**
   * DOM container for layered rendering.
   */
  container?: HTMLElement | null;

  /**
   * Layer offset from the anchor element.
   */
  offset?: number | { x?: number; y?: number };

  /**
   * Preferred placement around the anchor.
   */
  placement?: "top" | "right" | "bottom" | "left";
};

export type ComponentAnchorProps<T = unknown> = {
  /**
   * Anchor identifier used when multiple anchors exist.
   */
  anchorId?: string;

  /**
   * Resolves a DOM element from an external ref object.
   */
  getAnchorElement?: (refObject: T) => HTMLElement | null;

  /**
   * Element used as the interaction anchor.
   */
  children?: ReactElement<Record<string, unknown> | null> & { ref?: Ref<unknown> };
};
