import { z } from 'zod';

/**
 * Explanation trees are the product (constitution §2.4): engines return these,
 * never bare numbers. Every node is human-renderable and JSON-serialisable;
 * `amountPence` is present wherever a figure is shown in the UI.
 */
export interface ExplanationNode {
  label: string;
  amountPence?: number;
  /** The arithmetic, spelled out: "10h × £15.06/h = £150.60". */
  detail?: string;
  children?: ExplanationNode[];
}

/** For re-hydrating stored trees (ExpectedPay.lines) at the UI boundary. */
export const explanationNodeSchema: z.ZodType<ExplanationNode> = z.lazy(() =>
  z.object({
    label: z.string(),
    amountPence: z.number().int().optional(),
    detail: z.string().optional(),
    children: z.array(explanationNodeSchema).optional(),
  })
);

export function explanationTotal(node: ExplanationNode): number {
  return node.amountPence ?? 0;
}
