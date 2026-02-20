import { AsyncEventEmitter } from '../Structures/AsyncEventEmitter.ts';
import type { ClusterManager, Cluster, evalOptions } from '@ovencord/hybrid-sharding';
import type { RawMessage } from '../Structures/IPCMessage.ts';
import { IPCMessage, BaseMessage } from '../Structures/IPCMessage.ts';
import type { CrossHostMessage, ClientEvents } from '../types/shared.ts';
import { messageType } from '../types/shared.ts';
import type { Socket } from 'bun';

export interface ClientOptions {
    /**
     * The port to connect to.
     */
    port: number;
    /**
     * The host to connect to.
     */
    host?: string;
    /**
     * A authentication token to be able to verify the connection to the Bridge.
     */
    authToken: string;
    /**
     * A custom settable agent name. BroadcastEvals are just executed on Agents with the name 'bot'
     */
    agent: string;
    /**
     * If Rolling Restart should be enabled.
     */
    rollingRestarts?: boolean;
    /**
     * Reconnection interval in milliseconds.
     */
    reconnectInterval?: number;
}

export class Client extends AsyncEventEmitter {
    authToken: string;
    agent: string;
    rollingRestarts: boolean;
    reconnectInterval: number;
    shardList: number[];
    totalShards: number;
    manager?: ClusterManager & { netipc?: Client };
    clusterList: number[];
    private socket?: Socket<unknown>;
    private options: ClientOptions;
    private heartbeatTimer?: Timer;
    private reconnectTimer?: Timer;
    private connected = false;

    constructor(options: ClientOptions) {
        super();
        this.options = options;
        this.authToken = options.authToken;
        if (!this.authToken) throw new Error('CLIENT_MISSING_OPTION - authToken must be provided - String');

        this.agent = options.agent;
        if (!this.agent) throw new Error('CLIENT_MISSING_OPTION - agent must be provided - Default: bot');

        this.rollingRestarts = options.rollingRestarts ?? false;
        this.reconnectInterval = options.reconnectInterval ?? 5000;

        this.shardList = [];
        this.clusterList = [];
        this.totalShards = -1;

        this.on('ready', this._handleReady.bind(this));
    }

    public async connect(): Promise<void> {
        this._debug(`[Connect] Connecting to Bridge at ${this.options.host || 'localhost'}:${this.options.port}`);
        
        try {
            this.socket = await Bun.connect({
                hostname: this.options.host || 'localhost',
                port: this.options.port,
                socket: {
                    open: (socket) => {
                        this.connected = true;
                        this._debug(`[Connect] Connection established`);
                        // Send initial handshake
                        socket.write(JSON.stringify({
                            authToken: this.authToken,
                            agent: this.agent,
                            _type: messageType.HEARTBEAT
                        }));
                        this.startHeartbeat();
                        this.emit('ready', { url: `tcp://${this.options.host || 'localhost'}:${this.options.port}` });
                    },
                    data: (socket, data) => {
                        try {
                            const message = JSON.parse(data.toString());
                            this._handleMessage(message);
                        } catch (e) {
                            this._debug(`[Error] Failed to parse message: ${e}`);
                        }
                    },
                    close: () => {
                        this._handleDisconnect();
                    },
                    error: (socket, error) => {
                        this.emit('error', error);
                        this._handleDisconnect();
                    }
                }
            });
        } catch (e) {
            this._debug(`[Connect Error] ${e}`);
            this._handleDisconnect();
        }
    }

    private _handleReady() {
        this._debug(`[Ready] Client connected to Bridge`);
    }

    private _handleDisconnect() {
        if (!this.connected) return;
        this.connected = false;
        this.stopHeartbeat();
        this._debug(`[Disconnect] Connection to Bridge lost. Reconnecting in ${this.reconnectInterval}ms...`);
        
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectInterval);
        this.emit('close');
    }

    private startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatTimer = setInterval(() => {
            if (this.connected && this.socket) {
                this.send({ _type: messageType.HEARTBEAT });
            }
        }, 10000);
    }

    private stopHeartbeat() {
        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    }

    private _handleMessage(message: RawMessage) {
        if (message?._type === undefined && !message.nonce) return;

        // Handle responses to our requests
        if (message.nonce && this.listenerCount(`response:${message.nonce}`) > 0) {
            this.emit(`response:${message.nonce}` as any, message);
            return;
        }

        // Heartbeat ACK
        if (message._type === messageType.HEARTBEAT_ACK) return;

        // Rolling Restarts logic
        if (message._type === messageType.SHARDLIST_DATA_UPDATE) {
            if (!this.rollingRestarts) return;
            const checkIfClusterListIsUpToDate = message.shardClusterList.find(
                (x: number[]) => JSON.stringify(x) === JSON.stringify(this.shardList),
            );

            if (!checkIfClusterListIsUpToDate || this.totalShards !== message.totalShards) {
                this._debug(`[SHARDLIST_DATA_UPDATE] ShardData changed, waiting 5s until RollingRestart...`);
                Bun.sleep(5000).then(async () => {
                    if (!this.manager) return;
                    const response = await this.requestShardData();
                    this.manager.totalShards = response.totalShards;
                    this.manager.shardList = response.shardList || [];
                    this.manager.totalClusters = response.shardList?.length;
                    this.manager.shardClusterList = response.shardList || [];
                    this.manager.clusterList = response.clusterList || [];
                    this._debug(`[Start] RollingRestart`);
                    this.rollingRestart();
                });
            } else {
                this.send({ _type: messageType.CLIENT_SHARDLIST_DATA_CURRENT, shardList: this.shardList });
                this._debug(`[SHARDLIST_DATA_UPDATE] ShardData did not changed!`);
                return;
            }
        }

        // Check if it's a request from Bridge
        const res = message.nonce ? (data: any) => {
            return Promise.resolve(this.send({ ...data, nonce: message.nonce }));
        } : undefined;

        if (res) {
            this._handleRequest(message, res);
        } else {
            const emitMessage = new IPCMessage(this as any, message);
            this.emit('bridgeMessage', emitMessage, this as any);
        }
    }

    private _handleRequest(message: RawMessage, res: (data: any) => Promise<void>) {
        if (!this.manager) {
            this._debug(`[Request Error] No manager loaded to handle request type ${message._type}`);
            return;
        }

        // BroadcastEval
        if (message._type === messageType.SERVER_BROADCAST_REQUEST) {
            this.manager.broadcastEval(message.script, message.options)
                ?.then(e => res(e))
                .catch(e => res({ error: e.message || e }));
            return;
        }

        // Guild Data
        if (message._type === messageType.GUILD_DATA_REQUEST) {
            if (isNaN(message.options.shard)) return res({ error: 'No Shard has been provided!' });

            const findCluster = Array.from(this.manager.clusters.values()).find((i: Cluster) => {
                return i?.shardList?.includes(message.options.shard);
            });

            if (!findCluster) return res({ error: `Cluster for shard ${message.options.shard} not found!` });

            findCluster.request(message)
                .then(e => res(e))
                .catch(e => res({ error: e.message || e }));
            return;
        }

        // Guild Eval
        if (message._type === messageType.GUILD_EVAL_REQUEST) {
            this.manager.evalOnCluster(message.script, message.options)
                ?.then(e => res(e))
                .catch(e => res({ error: e.message || e }));
            return;
        }

        const emitMessage = new IPCMessage(this as any, message, res);
        this.emit('bridgeRequest', emitMessage, this);
    }

    public async requestShardData(options: { maxClusters?: number; timeout?: number } = {}) {
        const message = { _type: messageType.SHARDLIST_DATA_REQUEST, maxClusters: options.maxClusters };
        const response = await this.request(message, options.timeout);
        this._debug(`Given Shard Data: ${JSON.stringify(response)}`);
        if (!response) throw new Error(`No Response from Bridge`);
        if (response.error) throw new Error(response.error);
        
        this.clusterList = response.clusterList;
        this.shardList = response.shardList;
        this.totalShards = response.totalShards;
        return response;
    }

    public listen(manager: ClusterManager) {
        if (!manager) throw new Error(`A Cluster/Shard Manager has not been provided`);
        this.manager = manager;
        this.manager.netipc = this;
        return this.manager;
    }

    public async broadcastEval(script: string, options: evalOptions & { script?: string } = {}) {
        if (options.script) script = options.script;
        if (!script || (typeof script !== 'string' && typeof script !== 'function'))
            throw new Error('Script for BroadcastEvaling must be a valid String or Function!');
        
        const finalScript = typeof script === 'function' ? `(${script})(this, ${JSON.stringify(options.context)})` : script;
        const message = { script: finalScript, options, _type: messageType.CLIENT_BROADCAST_REQUEST };
        return this.request(message, options.timeout);
    }

    public send(message: RawMessage, options: CrossHostMessage = {}) {
        if (!this.connected || !this.socket) return;
        if (!message) throw new Error('Message has not been provided!');
        
        if (!options.internal) {
            message = new BaseMessage(message).toJSON();
        }
        
        this.socket.write(JSON.stringify(message));
    }

    public async request(message: RawMessage, options: number | { timeout?: number; internal?: boolean } = 30000): Promise<any> {
        const timeout = typeof options === 'number' ? options : options.timeout ?? 30000;
        if (!this.connected || !this.socket) throw new Error('Client is not connected to Bridge');
        
        const nonce = message.nonce || Math.random().toString(36).substring(2, 15);
        message.nonce = nonce;
        
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Request timed out')), timeout);
            const listener = (msg: any) => {
                if (msg.nonce === nonce) {
                    this.removeListener(`response:${nonce}` as any, listener);
                    clearTimeout(timer);
                    resolve(msg);
                }
            };
            this.on(`response:${nonce}` as any, listener);
            this.socket!.write(JSON.stringify(message));
        });
    }

    public async requestToGuild(message: RawMessage & { guildId: string }, options?: evalOptions) {
        if (!message.guildId) throw new Error('GuildID has not been provided!');
        message._type = message.eval ? messageType.GUILD_EVAL_REQUEST : messageType.GUILD_DATA_REQUEST;
        message.options = { ...options, ...message.options };
        return this.request(message, message.options.timeout);
    }

    public async requestToClient(message: RawMessage & { clientId: string }, options?: evalOptions) {
        if (!message.agent && !message.clientId) throw new Error('Agent or ClientID has not been provided!');
        message._type = messageType.CLIENT_DATA_REQUEST;
        message.options = { ...options, ...message.options };
        return this.request(message, message.options.timeout);
    }

    private rollingRestart() {
        if (!this.manager) return;
        if (!this.rollingRestarts) return;
        if (this.manager.recluster) {
            this.manager.recluster.start();
        }
    }

    private _debug(message: string) {
        const log = `[Client] ` + message;
        this.emit('debug', log);
        return log;
    }
}

export interface Client {
    on<K extends keyof ClientEvents>(event: K, listener: (...args: ClientEvents[K]) => void): this;
    emit<K extends keyof ClientEvents>(event: K, ...args: ClientEvents[K]): boolean;
}
