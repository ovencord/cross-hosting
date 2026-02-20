import type { Client } from '../../Manager/Client.ts';
import { messageType } from '../../types/shared.ts';

export type Serializable = string | number | boolean | object | any[] | null;

export class RemoteClientCache {
    options: { path: string; maxSize: number };
    client: Client;
    constructor(client: Client, options: { path: string; maxSize: number }) {
        this.options = options;
        this.client = client;
    }

    async set(key: string, value: Serializable) {
        return await this.client.request(
            {
                _type: messageType.SERVER_CACHE_SET_REQUEST,
                path: this.options.path,
                data: {
                    key,
                    value,
                },
            },
            30000,
        );
    }

    async get(key: string) {
        return await this.client.request(
            {
                _type: messageType.SERVER_CACHE_GET_REQUEST,
                path: this.options.path,
                data: {
                    key,
                },
            },
            30000,
        );
    }

    async delete(key: string) {
        return await this.client.request(
            {
                _type: messageType.SERVER_CACHE_DELETE_REQUEST,
                path: this.options.path,
                data: {
                    key,
                },
            },
            30000,
        );
    }

    async clear() {
        return await this.client.request(
            {
                _type: messageType.SERVER_CACHE_CLEAR_REQUEST,
                path: this.options.path,
            },
            30000,
        );
    }
}
