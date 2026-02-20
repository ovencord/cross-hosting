import { AsyncEventEmitter } from '../Structures/AsyncEventEmitter.ts';
import type { RawMessage } from '../Structures/IPCMessage.ts';
import { IPCMessage } from '../Structures/IPCMessage.ts';
import type { evalOptions} from '@ovencord/hybrid-sharding';
import { chunkArray, fetchRecommendedShards, shardIdForGuildId } from '@ovencord/hybrid-sharding';
import type { BridgeEvents, BroadcastEvalOptions} from '../types/shared.ts';
import { messageType } from '../types/shared.ts';
import type { Socket, SocketListener } from 'bun';

export interface BridgeSocket extends Socket<unknown> {
    id: string;
}

export interface BridgeOptions {
    /**
     * The port to listen on.
     */
    port: number;
    /**
     * The host to listen on.
     */
    host?: string;
    /**
     * A User chosen Token for basic Authorization.
     */
    authToken: string;
    /**
     * If the Package will be used in standalone mode
     */
    standAlone?: boolean;
    /**
     * The Total Amount of Shards per Clusters
     */
    shardsPerCluster?: number;
    /**
     * The Total Amount of Shards
     */
    totalShards?: number | 'auto';
    /**
     * The Total Amount of Machines
     */
    totalMachines: number;
    /**
     * Your Discord Bot token
     */
    token?: string;
    /**
     * The shardList, which will be hosted by all Machines
     */
    shardList?: number[];
}

export interface BridgeClient {
    id: string;
    socket: any;
    shardList: number[];
    agent: string;
    authToken: string;
    request(message: any, timeout?: number): Promise<any>;
    send(message: any): void;
    close(reason?: string): void;
}

export class Bridge extends AsyncEventEmitter {
    authToken: string;
    standAlone: boolean;
    shardsPerCluster: number;
    totalShards: number;
    totalMachines: number;
    token?: string;
    shardList: number[];
    shardClusterList: number[][];
    shardClusterListQueue: number[][];
    clients: Map<string, BridgeClient>;
    private server?: SocketListener<undefined>;
    private options: BridgeOptions;

    constructor(options: BridgeOptions) {
        super();
        this.options = options;
        this.authToken = options.authToken;
        if (!this.authToken) throw new Error('MACHINE_MISSING_OPTION - authToken must be provided - String');

        this.standAlone = options.standAlone ?? false;
        this.shardsPerCluster = options.shardsPerCluster ?? 1;
        this.totalShards = options.totalShards === 'auto' ? -1 : options.totalShards ?? -1;
        this.totalMachines = options.totalMachines;
        this.token = options.token ? options.token.replace(/^Bot\s*/i, '') : undefined;
        this.shardList = options.shardList ?? [];
        this.shardClusterList = [];
        this.shardClusterListQueue = [];
        this.clients = new Map();

        this.on('ready', this._handleReady.bind(this));
    }

    public listen() {
        this.server = Bun.listen({
            hostname: this.options.host || '0.0.0.0',
            port: this.options.port,
            socket: {
                open: (socket) => {
                    (socket as BridgeSocket).id = Math.random().toString(36).substring(2, 15);
                    this._debug(`[Connect] New connection: ${(socket as BridgeSocket).id}`);
                },
                data: (socket, data) => {
                    try {
                        const message = JSON.parse(data.toString());
                        this._handleSocketData(socket as BridgeSocket, message);
                    } catch (e) {
                        this._debug(`[Error] Failed to parse message: ${e}`);
                    }
                },
                close: (socket) => {
                    this._handleDisconnect(socket as BridgeSocket);
                },
                error: (socket, error) => {
                    this.emit('error', error);
                }
            }
        });

        this.emit('ready', `tcp://${this.options.host || '0.0.0.0'}:${this.options.port}`);
        return this;
    }

    public close() {
        if (this.server) {
            this.server.stop();
            this.server = undefined;
        }
    }

    private _handleSocketData(socket: BridgeSocket, message: RawMessage) {
        const id = socket.id;

        // AUTHENTICATION
        if (!this.clients.has(id)) {
            if (message.authToken !== this.authToken) {
                this._debug(`[Auth] Unauthorized connection attempt from ${id}`);
                socket.write(JSON.stringify({ error: 'ACCESS DENIED' }));
                socket.end();
                return;
            }

            const client: BridgeClient = {
                id,
                socket,
                shardList: [],
                agent: message.agent || 'none',
                authToken: message.authToken,
                send: (data: any) => socket.write(JSON.stringify(data)),
                request: (data: any, timeout = 30000) => {
                    return new Promise((resolve, reject) => {
                        const nonce = data.nonce || Math.random().toString(36).substring(2, 15);
                        data.nonce = nonce;
                        const timer = setTimeout(() => reject(new Error('Request timed out')), timeout);
                        const listener = (msg: any) => {
                            if (msg.nonce === nonce) {
                                this.removeListener(`response:${nonce}` as any, listener);
                                clearTimeout(timer);
                                resolve(msg);
                            }
                        };
                        this.on(`response:${nonce}` as any, listener);
                        socket.write(JSON.stringify(data));
                    });
                },
                close: (reason?: string) => {
                    if (reason) socket.write(JSON.stringify({ error: reason }));
                    socket.end();
                }
            };

            this.clients.set(id, client);
            this.emit('connect', client, message);
            this._debug(`[CM => Connected][${id}]`, { cm: true });

            // If it's a heartbeat, reply immediately
            if (message._type === messageType.HEARTBEAT) {
                client.send({ _type: messageType.HEARTBEAT_ACK, nonce: message.nonce });
            }
            return;
        }

        const client = this.clients.get(id)!;

        // Check if it's a response to a request from server
        if (message.nonce && this.listenerCount(`response:${message.nonce}`) > 0) {
            this.emit(`response:${message.nonce}` as any, message);
            return;
        }

        // Handle internal messages
        this._handleMessage(message, client);
    }

    private _handleReady(url: string) {
        this._debug(`[READY] Bridge operational on ${url}`);
        if (!this.standAlone) {
             Bun.sleep(5000).then(() => this.initializeShardData());
        }
    }

    private _handleDisconnect(socket: BridgeSocket) {
        const id = socket.id;
        const cachedClient = this.clients.get(id);
        if (!cachedClient) return;

        if (cachedClient.agent === 'bot' && cachedClient.shardList?.length) {
            if (!this.standAlone) this.shardClusterListQueue.push(cachedClient.shardList);
            this._debug(`[CM => Disconnected][${id}] New ShardListQueue: ${JSON.stringify(this.shardClusterListQueue)}`);
        } else {
            this._debug(`[CM => Disconnected][${id}]`);
        }

        this.clients.delete(id);
        this.emit('disconnect', cachedClient);
    }

    private _handleMessage(message: RawMessage, client: BridgeClient) {
        if (message?._type === undefined && !message.nonce) return;

        if (message._type === messageType.CLIENT_SHARDLIST_DATA_CURRENT) {
            if (!this.shardClusterListQueue[0]) return;
            client.shardList = message.shardList;

            const checkShardListPositionInQueue = this.shardClusterListQueue.findIndex(
                x => JSON.stringify(x) === JSON.stringify(message.shardList),
            );

            if (checkShardListPositionInQueue !== -1) {
                this.shardClusterListQueue.splice(checkShardListPositionInQueue, 1);
                this._debug(`[SHARDLIST_DATA_CURRENT][${client.id}] Current ShardListQueue: ${JSON.stringify(this.shardClusterListQueue)}`);
            }
            return;
        }

        // Check if it's a request (needs response)
        const res = message.nonce ? (data: any) => {
            return Promise.resolve(client.send({ ...data, nonce: message.nonce }));
        } : undefined;

        if (res) {
            this._handleRequest(message, res, client);
        } else {
            const emitMessage = new IPCMessage(client as any, message);
            this.emit('clientMessage', emitMessage, client);
        }
    }

    private _handleRequest(message: RawMessage, res: (data: any) => Promise<void>, client: BridgeClient) {
        // Heartbeat
        if (message._type === messageType.HEARTBEAT) {
            return res({ _type: messageType.HEARTBEAT_ACK });
        }

        // BroadcastEval
        if (message._type === messageType.CLIENT_BROADCAST_REQUEST) {
            const clients = Array.from(this.clients.values()).filter(
                message.options?.agent ? (c: any) => message.options.agent.includes(c.agent) : (c: any) => c.agent === 'bot',
            );

            message._type = messageType.SERVER_BROADCAST_REQUEST;
            const promises = clients.map(c => c.request(message, message.options?.timeout));
            
            Promise.all(promises)
                .then(e => res(e))
                .catch(e => res({ error: e.message }));
            return;
        }

        // Shard Data Request
        if (message._type === messageType.SHARDLIST_DATA_REQUEST) {
            if (!this.shardClusterListQueue[0]) return res([]);

            if (!message.maxClusters) {
                client.shardList = this.shardClusterListQueue[0];
                this.shardClusterListQueue.shift();
            } else {
                this.shardClusterListQueue.sort((a, b) => b.length - a.length);
                const position = this.shardClusterListQueue.findIndex(x => x.length < message.maxClusters + 1);
                if (position === -1) {
                    return res({ error: 'No Cluster List with less than ' + (message.maxClusters + 1) + ' found!' });
                } else {
                    client.shardList = this.shardClusterListQueue[position] as number[];
                    this.shardClusterListQueue.splice(position, 1);
                }
            }

            this._debug(`[SHARDLIST_DATA_RESPONSE][${client.id}] ShardList: ${JSON.stringify(client.shardList)}`, { cm: true });

            const clusterIds = this.shardClusterList.map(x => x.length);
            const shardListPosition = this.shardClusterList.findIndex(
                x => JSON.stringify(x) === JSON.stringify(client.shardList),
            );
            const clusterId = clusterIds.splice(0, shardListPosition);
            let r = clusterId.reduce((a, b) => a + b, 0);
            const clusterList = client.shardList.map(() => r++);
            
            res({ shardList: client.shardList, totalShards: this.totalShards, clusterList: clusterList, _type: messageType.CUSTOM_REPLY });
            return;
        }

        // Guild Data Request
        if (message._type === messageType.GUILD_DATA_REQUEST) {
            if (!message.guildId) return res({ error: 'Missing guildId for request to Guild' });
            this.requestToGuild(message as any)
                .then(e => res(e))
                .catch(e => res({ ...message, error: e.message }));
            return;
        }

        if (message._type === messageType.CLIENT_DATA_REQUEST) {
            if (!message.agent && !message.clientId)
                return res({ ...message, error: 'AGENT MISSING OR CLIENTID MISSING FOR FINDING TARGET CLIENT' });
            
            if (message.clientId) {
                const targetClient = this.clients.get(message.clientId);
                if (!targetClient) return res({ ...message, error: 'CLIENT NOT FOUND WITH PROVIDED CLIENT ID' });
                return targetClient
                    .request(message, message.options?.timeout)
                    .then(e => res(e))
                    .catch(e => res({ ...message, error: e.message }));
            }

            const targets = Array.from(this.clients.values()).filter(c => c.agent === String(message.agent));
            const promises = targets.map(c => c.request(message, message.options?.timeout));
            return Promise.all(promises)
                .then(e => res(e))
                .catch(e => res({ ...message, error: e.message }));
        }

        const emitMessage = new IPCMessage(client as any, message, res);
        this.emit('clientRequest', emitMessage, client);
    }

    public async initializeShardData() {
        if (this.totalShards === -1 && this.shardList?.length === 0) {
            if (!this.token) throw new Error('CLIENT_MISSING_OPTION - Token required for auto shard count');
            this.totalShards = await fetchRecommendedShards(this.token, 1000);
            this.shardList = Array.from(Array(this.totalShards).keys());
        } else if (isNaN(this.totalShards) && this.shardList) {
            this.totalShards = this.shardList.length;
        } else {
            this.shardList = Array.from(Array(this.totalShards).keys());
        }

        const clusterAmount = Math.ceil(this.shardList.length / this.shardsPerCluster);
        const ClusterList = chunkArray(this.shardList, Math.ceil(this.shardList.length / clusterAmount));

        this.shardClusterList = chunkArray(ClusterList, Math.ceil(ClusterList.length / this.totalMachines));
        this.shardClusterListQueue = [...this.shardClusterList];

        this._debug(`Created shardClusterList: ${JSON.stringify(this.shardClusterList)}`);

        const clients = Array.from(this.clients.values()).filter(c => c.agent === 'bot');
        const updateMessage = {
            totalShards: this.totalShards,
            shardClusterList: this.shardClusterList,
            _type: messageType.SHARDLIST_DATA_UPDATE,
        };
        for (const client of clients) client.send(updateMessage);
        
        return this.shardClusterList;
    }

    public async broadcastEval(script: string, options: BroadcastEvalOptions = {}) {
        if (!script || (typeof script !== 'string' && typeof script !== 'function'))
            throw new Error('Script for BroadcastEvaling must be a valid String or Function!');
        
        const finalScript = typeof script === 'function' ? `(${script})(this, ${JSON.stringify(options.context)})` : script;
        const message = { script: finalScript, options, _type: messageType.SERVER_BROADCAST_REQUEST };
        const targets = Array.from(this.clients.values()).filter(options.filter || (c => c.agent === 'bot'));
        
        return Promise.all(targets.map(c => c.request(message, options.timeout)));
    }

    public async requestToGuild(message: RawMessage & { guildId: string }, options?: evalOptions) {
        if (!message?.guildId) throw new Error('GuildID has not been provided!');
        const internalShard = shardIdForGuildId(message.guildId, this.totalShards);

        const targetClient = Array.from(this.clients.values()).find(x => x?.shardList?.flat()?.includes(internalShard));
        if (!targetClient) throw new Error('Internal Shard not found on any connected client!');

        message.options = { ...options, ...message.options, shard: internalShard };
        message._type = message.eval ? messageType.GUILD_EVAL_REQUEST : messageType.GUILD_DATA_REQUEST;

        return targetClient.request(message, message.options.timeout);
    }

    private _debug(message: string, options?: { cm: boolean }) {
        const log = (options?.cm ? `[Bridge => CM] ` : `[Bridge] `) + message;
        this.emit('debug', log);
        return log;
    }
}

export interface Bridge {
    on<K extends keyof BridgeEvents>(event: K, listener: (...args: BridgeEvents[K]) => void): this;
    emit<K extends keyof BridgeEvents>(event: K, ...args: BridgeEvents[K]): boolean;
}
