import * as Sentry from '@sentry/nextjs';
import { scrubSentryEvent } from './src/lib/observability/sentry-privacy';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  enabled: Boolean(process.env.SENTRY_DSN),
  sendDefaultPii: false,
  release: process.env.SENTRY_RELEASE ?? process.env.VERCEL_GIT_COMMIT_SHA,
  tracesSampleRate: 0,
  beforeSend: scrubSentryEvent,
});
