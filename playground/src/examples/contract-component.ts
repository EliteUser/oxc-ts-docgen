import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type ComponentTokenName = "space.100" | "space.200" | "space.300";

export type ComponentMetricTuple = [x: number, y: number, visible?: boolean];

export type ComponentMappedState = {
  /**
   * Component state generated from mapped keys.
   */
  [K in "state"]?: "idle" | "ready";
};

export type ComponentConditionalState<T> = T extends { enabled: true } ? "enabled" : "disabled";

export type ComponentTokenDictionary = {
  /**
   * Space token values keyed by token name.
   */
  space: Record<ComponentTokenName, string>;

  /**
   * Radius token values.
   */
  radius: {
    /**
     * Small radius token.
     */
    small: string;

    /**
     * Medium radius token.
     */
    medium: string;
  };
};

export declare enum ComponentContractTone {
  Neutral,
  Accent = 4,
  Danger = "danger",
  Computed = 1 + 2,
}

export type ComponentCommitHandler = (
  payload: { id: string; tokens: ComponentTokenDictionary },
  ...changes: Array<{ path: ComponentTokenName; value: string | number }>
) => Promise<{ ok: boolean }>;

export type ComponentContractBaseProps = {
  /**
   * Stable contract id.
   */
  id?: string;

  /**
   * Rendered contract label.
   */
  label: ReactNode;
};

export type ComponentContractProps = ComponentContractBaseProps &
  Omit<
    ComponentPropsWithoutRef<"button">,
    keyof ComponentContractBaseProps | "color" | "onCommit"
  > & {
    /**
     * Visual tone represented as an enum.
     */
    tone?: ComponentContractTone;

    /**
     * Token selected from the public token scale.
     */
    token?: ComponentTokenName;

    /**
     * Design token dictionary.
     */
    tokens?: ComponentTokenDictionary;

    /**
     * Tuple-like metrics preserved by semantic fallback.
     */
    metrics?: ComponentMetricTuple;

    /**
     * Mapped state annotation.
     */
    mappedState?: ComponentMappedState;

    /**
     * Conditional state annotation.
     */
    conditionalState?: ComponentConditionalState<{ enabled: true }>;

    /**
     * Callback-heavy contract API.
     */
    onCommit?: ComponentCommitHandler;
  };
