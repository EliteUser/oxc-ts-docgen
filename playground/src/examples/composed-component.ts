import type { ReactElement, ReactNode } from "react";

import type {
  ComponentDomainProps,
  ComponentDomainState,
  ComponentScalarValue,
} from "./domain-component";
import type {
  ComponentAnchorProps,
  ComponentDOMProps,
  ComponentItem,
  ComponentLayerOptions,
  ComponentOpenChangeHandler,
  ComponentRange,
  ComponentViewMode,
} from "./shared";

declare const ComponentOption: (props: ComponentComposedOption) => ReactElement | null;
declare const ComponentRangeView: (props: ComponentComposedRangeView) => ReactElement | null;

export type ComponentComposedAnchorProps = ComponentAnchorProps<{ node: HTMLElement | null }>;

export type ComponentComposedLayerOptions = Pick<
  ComponentLayerOptions,
  "container" | "offset" | "placement"
>;

export type ComponentComposedViewResolver<TMode extends ComponentViewMode = ComponentViewMode> =
  (options: {
    /**
     * Current composed view mode.
     */
    mode: TMode;

    /**
     * Anchor props used by layered mode.
     */
    anchor: ComponentComposedAnchorProps;

    /**
     * Current domain state.
     */
    state: ComponentDomainState;
  }) => ReactNode;

export type ComponentComposedProps = ComponentDOMProps & {
  /**
   * Disables user interaction.
   *
   * @default false
   */
  disabled?: boolean;

  /**
   * Placeholder content shown when no value is selected.
   */
  placeholder?: ReactNode;

  /**
   * Controlled open state.
   */
  open?: boolean;

  /**
   * Initial open state for uncontrolled usage.
   *
   * @default false
   */
  defaultOpen?: boolean;

  /**
   * Called when open state changes.
   */
  onOpenChange?: ComponentOpenChangeHandler;

  /**
   * Controlled selected range.
   */
  value?: ComponentRange<ComponentScalarValue> | null;

  /**
   * Initial selected range for uncontrolled usage.
   */
  defaultValue?: ComponentRange<ComponentScalarValue>;

  /**
   * Called when the selected range changes.
   */
  onChange?: (value: ComponentRange<ComponentScalarValue> | null) => void;

  /**
   * Child options or a nested range view.
   */
  children?:
    | ReactElement<ComponentComposedOption, typeof ComponentOption>
    | ReactElement<ComponentComposedOption, typeof ComponentOption>[]
    | ReactElement<ComponentComposedRangeView, typeof ComponentRangeView>;

  /**
   * Controls whether content renders inline or inside a layer.
   *
   * @default "layer"
   */
  viewMode?: ComponentViewMode;

  /**
   * Layer rendering options.
   */
  layerOptions?: ComponentComposedLayerOptions;

  /**
   * Root options used when content renders inline.
   */
  inlineRootOptions?: ComponentComposedInlineRootOptions;

  /**
   * Root options used when content renders inside a layer.
   */
  layerRootOptions?: ComponentComposedLayerRootOptions;

  /**
   * Anchor options used to resolve the layered view.
   */
  anchorProps?: ComponentComposedAnchorProps;

  /**
   * Resolves custom content for the current view mode.
   */
  resolveView?: ComponentComposedViewResolver;

  /**
   * Domain renderer inherited from the domain component model.
   */
  renderState?: ComponentDomainProps["renderState"];

  /**
   * Deferred renderer that receives the latest domain state lazily.
   */
  renderDeferredState?: (getState: () => ComponentDomainState) => ReactNode;
};

export type ComponentComposedInlineRootOptions = Pick<
  ComponentComposedProps,
  keyof ComponentDOMProps | "placeholder" | "viewMode"
>;

export type ComponentComposedLayerRootOptions = Pick<
  ComponentComposedProps,
  keyof ComponentDOMProps | "open" | "defaultOpen" | "onOpenChange" | "layerOptions"
>;

export type ComponentComposedOption = ComponentItem<ComponentRange<ComponentScalarValue>>;

export type ComponentComposedRangeView = Pick<
  ComponentDomainProps,
  "locale" | "range" | "renderState"
> & {
  /**
   * Optional nested range label.
   */
  children?: ReactNode;
};
