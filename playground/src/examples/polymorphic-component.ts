import type { ElementType, ReactNode } from "react";

import type {
  ComponentDOMProps,
  ComponentPolymorphicProps as ComponentPolymorphicHelperProps,
  ComponentSize,
  ComponentTone,
} from "./shared";

export type ComponentPolymorphicElement = "a" | "button";

export type ComponentContent =
  | {
      /**
       * Text content displayed by the component.
       */
      label: string;

      /**
       * Rich children are not allowed when label is used.
       */
      children?: never;
    }
  | {
      /**
       * Text label is not allowed when rich children are used.
       */
      label?: never;

      /**
       * Rich content displayed by the component.
       */
      children: ReactNode;
    };

type ComponentPolymorphicBaseProps = ComponentDOMProps &
  ComponentContent & {
    /**
     * Visual size used by the component.
     *
     * @default "medium"
     */
    size?: ComponentSize;

    /**
     * Visual tone used by the component.
     *
     * @default "accent"
     */
    tone?: ComponentTone;

    /**
     * Shows a busy indicator while preserving layout.
     *
     * @default false
     */
    busy?: boolean;

    /**
     * Disables user interaction.
     *
     * @default false
     */
    disabled?: boolean;
  };

export type ComponentPolymorphicProps<T extends ElementType = ComponentPolymorphicElement> =
  ComponentPolymorphicHelperProps<ComponentPolymorphicBaseProps, T>;
