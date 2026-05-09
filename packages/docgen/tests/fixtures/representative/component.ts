import type { AnchorIntrinsicProps, DesignTokens, PublicTokenScale, SaveHandler } from "./index";
import type { ControlTone } from "./index";

/**
 * Link props used by the representative fixture matrix.
 */
export interface LinkProps extends AnchorIntrinsicProps {
  /**
   * Visual tone.
   */
  tone?: ControlTone;
  /**
   * Design token scale.
   */
  token?: PublicTokenScale;
  /**
   * Token dictionary.
   */
  tokens?: DesignTokens;
  /**
   * Save callback.
   */
  onSave?: SaveHandler;
}
