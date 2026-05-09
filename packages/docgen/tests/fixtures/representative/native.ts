/**
 * React-like intrinsic anchor props.
 */
export interface AnchorIntrinsicProps {
  /**
   * Anchor URL.
   */
  href: string;
  /**
   * Browser target.
   */
  target?: "_blank" | "_self";
  /**
   * Link relation.
   */
  rel?: string;
}
