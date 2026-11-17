const MAX_CLIENTS = 8;
const HEARTBEAT_MS = 15_000;
export class EventHub {
    clients = new Set();
    heartbeat;
    get size() {
        return this.clients.size;
    }
    add(response) {
        if (this.clients.size >= MAX_CLIENTS) {
            response.statusCode = 503;
            response.setHeader('content-type', 'application/json');
            response.end(JSON.stringify({ ok: false, error: { code: 'rate_limited', message: 'Too many event streams' } }));
            return () => { };
        }
        response.statusCode = 200;
        response.setHeader('content-type', 'text/event-stream; charset=utf-8');
        response.setHeader('cache-control', 'no-cache, no-transform');
        response.setHeader('connection', 'keep-alive');
        response.setHeader('x-accel-buffering', 'no');
        response.flushHeaders?.();
        response.write(': connected\n\n');
        this.clients.add(response);
        this.startHeartbeat();
        let disposed = false;
        return () => {
            if (disposed)
                return;
            disposed = true;
            this.clients.delete(response);
            if (this.clients.size === 0)
                this.stopHeartbeat();
        };
    }
    send(type, data) {
        if (this.clients.size === 0)
            return;
        const payload = `data: ${JSON.stringify({ type, data, at: Date.now() })}\n\n`;
        for (const client of [...this.clients]) {
            if (client.writableEnded === true || client.destroyed === true) {
                this.clients.delete(client);
                continue;
            }
            try {
                client.write(payload);
            }
            catch {
                this.clients.delete(client);
            }
        }
        if (this.clients.size === 0)
            this.stopHeartbeat();
    }
    startHeartbeat() {
        if (this.heartbeat !== undefined)
            return;
        this.heartbeat = setInterval(() => {
            for (const client of [...this.clients]) {
                try {
                    client.write(': ping\n\n');
                }
                catch {
                    this.clients.delete(client);
                }
            }
            if (this.clients.size === 0)
                this.stopHeartbeat();
        }, HEARTBEAT_MS);
        this.heartbeat.unref?.();
    }
    stopHeartbeat() {
        if (this.heartbeat !== undefined) {
            clearInterval(this.heartbeat);
            this.heartbeat = undefined;
        }
    }
    dispose() {
        this.stopHeartbeat();
        for (const client of [...this.clients]) {
            try {
                client.end();
            }
            catch {
                // The page may already be gone.
            }
        }
        this.clients.clear();
    }
}
