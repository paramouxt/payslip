import type { ExplanationNode } from '@/core/payroll/explanation';
import { formatPence } from '@/lib/utils';

/**
 * "Explain this number" (constitution §2.4): renders an engine explanation
 * tree as nested disclosure. Server component — trees are data, not state.
 */
export function ExplanationTree({ node, depth = 0 }: { node: ExplanationNode; depth?: number }) {
  const hasChildren = (node.children?.length ?? 0) > 0;
  const row = (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div className="min-w-0">
        <span className="text-sm">{node.label}</span>
        {node.detail && <p className="text-xs text-muted-foreground">{node.detail}</p>}
      </div>
      {node.amountPence !== undefined && (
        <span className="tnum shrink-0 text-sm font-medium">{formatPence(node.amountPence)}</span>
      )}
    </div>
  );
  if (!hasChildren) return <div className={depth > 0 ? 'border-l pl-3' : ''}>{row}</div>;
  return (
    <details className={depth > 0 ? 'border-l pl-3' : ''} open={depth < 1}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        {row}
      </summary>
      <div className="ml-1 flex flex-col">
        {node.children?.map((child, i) => (
          <ExplanationTree key={i} node={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}
