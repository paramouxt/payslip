import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
  {
    variants: {
      variant: {
        default: 'bg-muted text-muted-foreground ring-border',
        success: 'bg-success/10 text-success ring-success/30',
        warning: 'bg-warning/10 text-warning ring-warning/30',
        destructive: 'bg-destructive/10 text-destructive ring-destructive/30',
        primary: 'bg-primary/10 text-primary ring-primary/30',
      },
    },
    defaultVariants: { variant: 'default' },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
