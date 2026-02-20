import type { evalOptions } from '@ovencord/hybrid-sharding';
import type { IPCMessage } from '../Structures/IPCMessage.ts';

export interface ClientReadyEvent {
    url: string;
}

export interface BroadcastEvalOptions extends evalOptions {
    filter?(client: { agent: string }): boolean;
}

export enum messageType {
    'CUSTOM_REQUEST',
    'CUSTOM_MESSAGE',
    'CUSTOM_REPLY',
    'HEARTBEAT',
    'HEARTBEAT_ACK',
    'CLIENT_BROADCAST_REQUEST',
    'CLIENT_BROADCAST_RESPONSE',
    'SHARDLIST_DATA_REQUEST' = 21,
    'SHARDLIST_DATA_UPDATE',
    'CLIENT_SHARDLIST_DATA_CURRENT',
    'SERVER_BROADCAST_REQUEST',
    'SERVER_BROADCAST_RESPONSE',
    'GUILD_DATA_REQUEST',
    'GUILD_DATA_RESPONSE',
    'GUILD_EVAL_REQUEST',
    'GUILD_EVAL_RESPONSE',
    'CLIENT_DATA_REQUEST',
    'CLIENT_DATA_RESPONSE',
    'SERVER_CACHE_SET_REQUEST',
    'SERVER_CACHE_SET_RESPONSE',
    'SERVER_CACHE_GET_REQUEST',
    'SERVER_CACHE_GET_RESPONSE',
    'SERVER_CACHE_DELETE_REQUEST',
    'SERVER_CACHE_DELETE_RESPONSE',
    'SERVER_CACHE_CLEAR_REQUEST',
    'SERVER_CACHE_CLEAR_RESPONSE',
}

export interface CrossHostMessage {
    nonce?: string;
    _type?: number;
    timeout?: number;
    resolve?: boolean;
    internal?: boolean;
    [x: string]: any;
}

export interface BridgeEvents {
    debug: [message: string];
    ready: [address: string];
    connect: [client: BridgeConnection, initialData?: any];
    disconnect: [client: BridgeConnection, reason?: any];
    clientMessage: [message: IPCMessage, client: BridgeConnection];
    clientRequest: [message: IPCMessage, client: BridgeConnection];
    error: [error: any];
    message: [message: any, client: BridgeConnection];
    request: [request: any, res: (d: any) => Promise<void>, client: BridgeConnection];
}

export interface ClientEvents {
    ready: [data: ClientReadyEvent];
    error: [error: any];
    close: [reason?: any];
    bridgeMessage: [message: IPCMessage, client: BridgeConnection];
    bridgeRequest: [message: IPCMessage, client: BridgeConnection | any];
    debug: [message: string];
    request: [request: any, res: (d: any) => Promise<void>];
}

export interface BridgeConnection {
    id: string;
    agent: string;
    authToken: string;
    shardList: number[];
    send(data: any): void;
    request(data: any, timeout?: number): Promise<any>;
    close(reason?: string): void;
}
