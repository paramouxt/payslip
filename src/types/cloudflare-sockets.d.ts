declare module 'cloudflare:sockets' {
  interface SocketAddress {
    hostname: string;
    port: number;
  }

  interface SocketOptions {
    secureTransport?: 'off' | 'on' | 'starttls';
    allowHalfOpen?: boolean;
  }

  interface Socket {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
    opened: Promise<unknown>;
    closed: Promise<void>;
    startTls(): Socket;
    close(): Promise<void>;
  }

  export function connect(address: SocketAddress, options?: SocketOptions): Socket;
}
