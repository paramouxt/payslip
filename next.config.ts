import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';
import type { webpack } from 'next/dist/compiled/webpack/webpack';
import withSerwistInit from '@serwist/next';
import { withSentryConfig } from '@sentry/nextjs';

const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
});

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  headers: () => Promise.resolve([{ source: '/(.*)', headers: securityHeaders }]),
  webpack(config, { isServer }) {
    config.experiments = { ...config.experiments, asyncWebAssembly: true };

    if (isServer) {
      config.output.webassemblyModuleFilename = '../static/wasm/[modulehash].wasm';
      config.plugins.push({
        apply(compiler: webpack.Compiler) {
          compiler.hooks.afterEmit.tap('CopyPrismaWasmForTrace', () => {
            const outputPath = compiler.options.output.path;
            if (!outputPath) return;

            const emittedDirectory = resolve(outputPath, '../static/wasm');
            const tracedDirectory = resolve(outputPath, '../../static/wasm');
            if (existsSync(emittedDirectory)) {
              cpSync(emittedDirectory, tracedDirectory, { recursive: true });
            }
          });
        },
      });
    }

    return config;
  },
};

const sentryBuildConfigured = Boolean(
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
);

export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  telemetry: false,
  sourcemaps: { disable: !sentryBuildConfigured },
  webpack: { treeshake: { removeDebugLogging: true, removeTracing: true } },
});
