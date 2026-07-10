// Vitest bootstrap: deterministic env for modules that read configuration at
// import time. Real deployments provide these via the environment.
process.env.APP_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');
