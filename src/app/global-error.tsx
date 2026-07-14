'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en-GB">
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p>The error has been recorded. Please try again.</p>
        </main>
      </body>
    </html>
  );
}
