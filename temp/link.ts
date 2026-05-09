import type { ReactNode } from "react";

import type { DOMProps, PolymorphicComponentProps } from "./shared";

export type LinkSize = "l" | "m" | "s";
export type LinkVariant = "primary" | "secondary" | "success" | "error" | "info" | "warning";
export type LinkComponent = "a" | "button";

type LinkIconsProps =
  | {
      /**
       * Icon displayed before the link text.
       *
       * @default undefined
       */
      startIcon?: ReactNode;

      /**
       * Icon displayed after the link text.
       *
       * @default undefined
       */
      endIcon?: never;
    }
  | {
      startIcon?: never;
      endIcon?: ReactNode;
    };

/**
 * Shared link props.
 */
export type LinkBaseProps = DOMProps &
  LinkIconsProps & {
    /**
     * Rendered content.
     */
    children: ReactNode;

    /**
     * Link URL.
     */
    href?: string;

    /**
     * Link size.
     *
     * @default "m"
     */
    size?: LinkSize;

    /**
     * Link visual variant.
     *
     * @default "primary"
     */
    variant?: LinkVariant;
  };

export type LinkProps<T extends LinkComponent = "a"> = PolymorphicComponentProps<LinkBaseProps, T>;
