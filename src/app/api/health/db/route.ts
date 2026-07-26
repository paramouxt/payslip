import { NextResponse } from 'next/server';
import type * as CloudflareSockets from 'cloudflare:sockets';
import { Client } from 'pg';
import { env } from '@/lib/env';
import { prisma } from '@/server/db';
import { connectionStringForRuntime } from '@/server/prisma-client';

interface PgSslStatus {
  ssl: boolean;
}

interface ProbeResult {
  ok: boolean;
  elapsedMs: number;
  ssl?: boolean;
  error?: {
    name: string;
    code?: string;
    message: string;
  };
}
interface SocketProbeResult {
  ok: boolean;
  elapsedMs: number;
  tcpOpened: boolean;
  sslResponse?: string;
  tlsOpened: boolean;
  startupMessageType?: string;
  authenticationCode?: number;
  serverErrorCode?: string;
  error?: ProbeResult['error'];
}

function safeError(error: unknown): ProbeResult['error'] {
  if (!(error instanceof Error)) {
    return { name: 'UnknownError', message: 'Unknown database error' };
  }

  const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  const message = error.message
    .replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted-database-url]')
    .slice(0, 300);

  return { name: error.name, ...(code ? { code } : {}), message };
}

function connectionSummary(connectionString: string | undefined) {
  if (!connectionString) {
    return { configured: false };
  }

  try {
    const url = new URL(connectionString);
    return {
      configured: true,
      validUrl: true,
      poolerHost: url.hostname.endsWith('.pooler.supabase.com'),
      port: url.port || '5432',
      transactionPooler: url.port === '6543',
      projectScopedUser: decodeURIComponent(url.username).startsWith('postgres.'),
      passwordPresent: url.password.length > 0,
      passwordLooksPlaceholder: /YOUR-PASSWORD|\[[^\]]*PASSWORD[^\]]*\]/iu.test(
        decodeURIComponent(url.password)
      ),
      sslmode: url.searchParams.get('sslmode') ?? 'runtime-default',
    };
  } catch {
    return { configured: true, validUrl: false };
  }
}

async function rawPgProbe(connectionString: string): Promise<ProbeResult> {
  const startedAt = Date.now();
  const client = new Client({
    connectionString: connectionStringForRuntime(connectionString),
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    const result = await client.query<PgSslStatus>(
      'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()'
    );
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ssl: result.rows[0]?.ssl === true,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: safeError(error),
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

function postgresStartupMessage(url: URL): Uint8Array {
  const encoder = new TextEncoder();
  const nullTerminated = (value: string): Uint8Array => {
    const encoded = encoder.encode(value);
    const result = new Uint8Array(encoded.length + 1);
    result.set(encoded);
    return result;
  };
  const parts = [
    nullTerminated('user'),
    nullTerminated(decodeURIComponent(url.username)),
    nullTerminated('database'),
    nullTerminated(decodeURIComponent(url.pathname.slice(1) || 'postgres')),
    new Uint8Array([0]),
  ];
  const length = 8 + parts.reduce((total, part) => total + part.length, 0);
  const message = new Uint8Array(length);
  const view = new DataView(message.buffer);
  view.setUint32(0, length, false);
  view.setUint32(4, 196_608, false);
  let offset = 8;

  for (const part of parts) {
    message.set(part, offset);
    offset += part.length;
  }

  return message;
}

async function readPostgresFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<Uint8Array> {
  let received = new Uint8Array(0);
  let expectedLength: number | undefined;

  while (expectedLength === undefined || received.length < expectedLength) {
    const chunk = await reader.read();
    if (chunk.done) {
      throw new Error('Database closed before its first protocol response');
    }

    const combined = new Uint8Array(received.length + chunk.value.length);
    combined.set(received);
    combined.set(chunk.value, received.length);
    received = combined;

    if (expectedLength === undefined && received.length >= 5) {
      expectedLength =
        1 +
        new DataView(received.buffer, received.byteOffset, received.byteLength).getUint32(1, false);
      if (expectedLength > 65_536) {
        throw new Error('Database returned an oversized initial protocol frame');
      }
    }
  }

  return received.slice(0, expectedLength);
}

function postgresErrorCode(frame: Uint8Array): string | undefined {
  const decoder = new TextDecoder();
  let offset = 5;

  while (offset < frame.length && frame[offset] !== 0) {
    const fieldType = String.fromCharCode(frame[offset] ?? 0);
    offset += 1;
    let end = offset;
    while (end < frame.length && frame[end] !== 0) {
      end += 1;
    }
    if (fieldType === 'C') {
      return decoder.decode(frame.subarray(offset, end));
    }
    offset = end + 1;
  }

  return undefined;
}

async function socketProbe(
  connectionString: string,
  socketModule: string
): Promise<SocketProbeResult> {
  const startedAt = Date.now();
  const url = new URL(connectionString);
  const { connect } = (await import(
    /* webpackIgnore: true */ socketModule
  )) as typeof CloudflareSockets;
  const socket = connect(
    {
      hostname: url.hostname,
      port: Number(url.port || '5432'),
    },
    { secureTransport: 'starttls' }
  );
  let tcpOpened = false;
  let tlsOpened = false;

  try {
    await socket.opened;
    tcpOpened = true;
    const writer = socket.writable.getWriter();
    const reader = socket.readable.getReader();

    await writer.write(new Uint8Array([0, 0, 0, 8, 4, 210, 22, 47]));
    const first = await reader.read();
    const sslResponse =
      !first.done && first.value.length > 0 ? String.fromCharCode(first.value[0] ?? 0) : 'EOF';

    if (sslResponse !== 'S') {
      return {
        ok: false,
        elapsedMs: Date.now() - startedAt,
        tcpOpened,
        sslResponse,
        tlsOpened,
      };
    }

    writer.releaseLock();
    reader.releaseLock();
    const secureSocket = socket.startTls();
    try {
      await secureSocket.opened;
      tlsOpened = true;
      const secureWriter = secureSocket.writable.getWriter();
      const secureReader = secureSocket.readable.getReader();
      let startupFrame: Uint8Array;
      try {
        await secureWriter.write(postgresStartupMessage(url));
        startupFrame = await readPostgresFrame(secureReader);
      } finally {
        secureWriter.releaseLock();
        secureReader.releaseLock();
      }

      const startupMessageType = String.fromCharCode(startupFrame[0] ?? 0);
      const authenticationCode =
        startupMessageType === 'R' && startupFrame.length >= 9
          ? new DataView(
              startupFrame.buffer,
              startupFrame.byteOffset,
              startupFrame.byteLength
            ).getUint32(5, false)
          : undefined;
      return {
        ok: startupMessageType === 'R',
        elapsedMs: Date.now() - startedAt,
        tcpOpened,
        sslResponse,
        tlsOpened,
        startupMessageType,
        ...(authenticationCode === undefined ? {} : { authenticationCode }),
        ...(startupMessageType === 'E' ? { serverErrorCode: postgresErrorCode(startupFrame) } : {}),
      };
    } finally {
      await secureSocket.close().catch(() => undefined);
    }
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      tcpOpened,
      tlsOpened,
      error: safeError(error),
    };
  } finally {
    await socket.close().catch(() => undefined);
  }
}

async function prismaProbe(): Promise<ProbeResult> {
  const startedAt = Date.now();
  try {
    const rows = await prisma.$queryRaw<PgSslStatus[]>`
      SELECT ssl
      FROM pg_stat_ssl
      WHERE pid = pg_backend_pid()
    `;
    return {
      ok: true,
      elapsedMs: Date.now() - startedAt,
      ssl: rows[0]?.ssl === true,
    };
  } catch (error) {
    return {
      ok: false,
      elapsedMs: Date.now() - startedAt,
      error: safeError(error),
    };
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get('authorization');
  const diagnosticSecret = process.env.DB_DIAGNOSTIC_SECRET;
  const authorized = [env.CRON_SECRET, diagnosticSecret].some(
    (secret) => typeof secret === 'string' && authorization === `Bearer ${secret}`
  );

  if (!authorized) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED' } }, { status: 401 });
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return NextResponse.json(
      {
        ok: false,
        config: connectionSummary(connectionString),
        error: { code: 'DATABASE_URL_MISSING' },
      },
      { status: 503 }
    );
  }

  const socket = await socketProbe(
    connectionString,
    request.headers.get('x-db-socket-module') ?? 'cloudflare:sockets'
  );
  const rawPg = await rawPgProbe(connectionString);
  const prismaResult: ProbeResult = rawPg.ok
    ? await prismaProbe()
    : {
        ok: false,
        elapsedMs: 0,
        error: { name: 'Skipped', message: 'Raw pg probe failed' },
      };

  const ok = rawPg.ok && prismaResult.ok;
  return NextResponse.json(
    {
      ok,
      config: connectionSummary(connectionString),
      socket,
      rawPg,
      prisma: prismaResult,
    },
    { status: ok ? 200 : 503 }
  );
}
