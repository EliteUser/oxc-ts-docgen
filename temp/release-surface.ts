import type { ComponentPropsWithoutRef, ReactNode } from "react";

export type TokenScale = "space.100" | "space.200" | "space.300";

export interface DesignTokens {
  /**
   * Space token values.
   */
  space: Record<TokenScale, string>;

  /**
   * Radius token values.
   */
  radius: {
    sm: string;
    md: string;
  };
}

export declare enum ControlTone {
  Neutral,
  Accent = 4,
  Danger = "danger",
  Computed = 1 + 2,
}

export type SaveHandler = (
  payload: { id: string; tokens: DesignTokens },
  ...changes: Array<{ path: TokenScale; value: string | number }>
) => Promise<{ ok: boolean }>;

export interface BaseControlProps {
  /**
   * Stable control id.
   */
  id?: string;

  /**
   * Rendered label.
   */
  label: ReactNode;
}

export type ReleaseSurfaceProps = BaseControlProps &
  Omit<ComponentPropsWithoutRef<"button">, keyof BaseControlProps | "onSave" | "color"> & {
    /**
     * Visual tone.
     */
    tone?: ControlTone;

    /**
     * Token scale.
     */
    scale?: TokenScale;

    /**
     * Design token dictionary.
     */
    tokens?: DesignTokens;

    /**
     * Callback-heavy API.
     */
    onSave?: SaveHandler;
  };
