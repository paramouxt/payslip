import { NextResponse } from 'next/server';
import { getIngestionService } from '@/server/container';

// Auth mode: HMAC + timestamp (constitution §13). No session, no cookies.
const MAX_BODY_BYTES = 3_900_000;

export async function POST(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: { code: 'PAYLOAD_TOO_LARGE' } }, { status: 413 });
  }

  const result = await getIngestionService().receivePush({
    headers: {
      'x-shiftsync-timestamp': request.headers.get('x-shiftsync-timestamp') ?? undefined,
      'x-shiftsync-signature': request.headers.get('x-shiftsync-signature') ?? undefined,
    },
    rawBody,
    receivedAt: new Date(),
  });

  switch (result.status) {
    case 'REJECTED':
      return NextResponse.json({ error: { code: result.reason } }, { status: result.httpStatus });
    case 'DUPLICATE':
      // Idempotent success: retries must always be safe (§13).
      return NextResponse.json({ duplicate: true, emailId: result.emailId }, { status: 200 });
    case 'ACCEPTED':
      return NextResponse.json(
        {
          emailId: result.emailId,
          classification: result.classification,
          parseStatus: result.parseStatus,
        },
        { status: 200 }
      );
  }
}
