/**
 * Control tone enum.
 */
export enum ControlTone {
  /**
   * Neutral tone.
   */
  Neutral,
  Accent = 4,
  Danger = "danger",
  Computed = 1 + 2,
}

/**
 * Callback-heavy save handler.
 */
export type SaveHandler = (
  event: { kind: "submit"; target: { id: string } },
  ...changes: Array<{ path: string; value: string | number }>
) => Promise<{ ok: boolean }>;
