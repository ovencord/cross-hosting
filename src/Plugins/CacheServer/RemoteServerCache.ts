import type { CacheServer } from './CacheServer.ts';

class Collection<K, V> extends Map<K, V> {
    maxSize?: number;
    constructor(entries?: readonly (readonly [K, V])[] | null, options?: { maxSize?: number }) {
        super(entries || []);
        this.maxSize = options?.maxSize;
    }

    override set(key: K, value: V) {
        if (this.maxSize && this.size >= this.maxSize && !this.has(key)) {
            const firstKey = this.keys().next().value;
            if (firstKey !== undefined) this.delete(firstKey);
        }
        return super.set(key, value);
    }
}

export class RemoteServerCache extends Collection<string, any> {
    server: CacheServer;
    path: string;
    constructor(server: CacheServer, options: { path: string; maxSize: number }) {
        super(null, options);
        this.server = server;
        this.path = options.path;
    }
}
