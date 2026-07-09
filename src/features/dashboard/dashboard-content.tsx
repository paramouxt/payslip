import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/** Placeholder until Phase 9 wires the payroll projections into the UI. */
export function DashboardContent() {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {['This fortnight', 'This month', 'Tax year forecast'].map((label) => (
        <Card key={label}>
          <CardHeader>
            <CardTitle>{label}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Payroll projections arrive with Phase 8/9.
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
