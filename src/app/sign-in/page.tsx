import { redirect } from 'next/navigation';
import { Zap } from 'lucide-react';
import { auth, signIn } from '@/server/auth/config';
import { devAuthEnabled, env } from '@/lib/env';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export const metadata = { title: 'Sign in' };

export default async function SignInPage() {
  const session = await auth();
  if (session?.user) redirect('/dashboard');
  const googleConfigured = Boolean(env.AUTH_GOOGLE_ID && env.AUTH_GOOGLE_SECRET);

  return (
    <main className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-5 p-8 text-center">
          <div className="flex items-center gap-2">
            <Zap className="size-6 text-primary" aria-hidden />
            <h1 className="text-lg font-semibold tracking-tight">ShiftSync</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Payroll intelligence for shift workers. Your rotas, your expected pay, and the evidence
            when a payslip is wrong.
          </p>
          {googleConfigured ? (
            <form
              action={async () => {
                'use server';
                await signIn('google', { redirectTo: '/dashboard' });
              }}
              className="w-full"
            >
              <Button className="w-full" type="submit">
                Continue with Google
              </Button>
            </form>
          ) : (
            <p className="text-sm text-warning">
              Google sign-in is not configured (set AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET).
            </p>
          )}
          {devAuthEnabled && (
            <form action="/api/dev/login" method="post" className="w-full">
              <Button variant="outline" className="w-full" type="submit">
                Dev sign-in ({env.DEV_AUTH_EMAIL})
              </Button>
            </form>
          )}
          <p className="text-xs text-muted-foreground">
            Sign-in uses basic Google scopes only — ShiftSync never asks for mailbox access.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
