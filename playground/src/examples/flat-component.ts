import type { PropsWithChildren, ReactNode } from "react";

import type { ComponentDOMProps, ComponentSize, ComponentTone } from "./shared";

export type ComponentFlatVariant = "filled" | "outlined" | "ghost";

export type ComponentFlatProps = ComponentDOMProps &
  PropsWithChildren<{
    /**
     * Visual size used by the component.
     *
     * @default "medium"
     */
    size?: ComponentSize;

    /**
     * Visual tone used by the component.
     *
     * @default "neutral"
     */
    tone?: ComponentTone;

    /**
     * Visual variant used by the component.
     *
     * @default "filled"
     */
    variant?: ComponentFlatVariant;

    /**
     * Optional leading content.
     */
    leadingContent?: ReactNode;

    /**
     * Some deprecated property.
     *
     * @deprecated Use another property
     */
    deprecatedProperty?: ReactNode;
  }>;
