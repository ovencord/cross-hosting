# 𝗖 𝗥 𝗢 𝗦 𝗦 - 𝗛 𝗢 𝗦 𝗧 𝗜 𝗡 𝗚

<p align="left">
<img src="https://img.shields.io/github/sponsors/LuigiColantuono?style=social"></a> 
<a href="https://paypal.me/l0g4n7">
<img src="https://img.shields.io/badge/💖-Support-ff69b4"></a> 
<img src="https://img.shields.io/npm/v/@ovencord/cross-hosting"> 
<img src="https://img.shields.io/npm/dm/@ovencord/cross-hosting?label=downloads"> 
<img src="https://img.shields.io/npm/l/@ovencord/cross-hosting"> 
<img src="https://img.shields.io/github/repo-size/ovencord/cross-hosting"> 
<a href="https://github.com/ovencord/cross-hosting">
<img src="https://img.shields.io/badge/Bun-Networking-black?logo=bun"></a>
</p>

<p align="center">
<img width="300" height="200" alt="Ovencord-Cross-Hosting-Logo" src="https://github.com/user-attachments/assets/7fb6dc7b-7ed9-486f-95f7-798a484fe455" />
<p>
    
# Ovencord Cross Hosting

The ultimate cross-hosting library for Bun, optimized for ultra-low latency (<2ms) and native performance. Built to work seamlessly with `@ovencord/hybrid-sharding`.

# Features:

-   **Native Bun Networking:** Uses `Bun.listen` and `Bun.connect` for maximum performance and minimum overhead.
-   **Ultra Low Latency:** Designed for inter-VPS communication with <2ms latency targets.
-   **broadcastEval():** Execute code across all machines and clusters with ease.
-   **Dependency-Free:** Zero Node.js networking dependencies (`net-ipc`, etc. removed).
-   **Rolling Restarts:** Seamlessly update shard counts and machine configurations without downtime.
-   **Hybrid-Sharding Integration:** Specifically tailored for `@ovencord/hybrid-sharding`.

### 📦 Bundle Size Comparison: Cross-Hosting

| Package | Size (Unpacked) | Total Files | Dependencies | Install Weight (est.) |
| :--- | :--- | :--- | :--- | :--- |
| **discord-cross-hosting** | 153 kB | 48 | `net-ipc`, `lodash`, etc. | ~500 kB |
| **@ovencord/cross-hosting** | 52.8 kB | 14 | **NONE** (Native Bun) | **~53 kB** |

🚀 **Result: ~89% savings on total installation weight and zero external networking dependencies!**

# Installation

```cli
bun add @ovencord/cross-hosting
bun add @ovencord/hybrid-sharding
```

# Quick Start Guide:

## 1. Bridge (Coordinator)
The Bridge handles the coordination of shards across all machines.

```typescript
import { Bridge } from '@ovencord/cross-hosting';

const bridge = new Bridge({
    port: 4444,
    authToken: 'YOUR_SECURE_TOKEN',
    totalShards: 'auto',
    totalMachines: 2,
    shardsPerCluster: 10,
    token: 'YOUR_BOT_TOKEN',
});

bridge.on('debug', console.log);
bridge.listen();

bridge.on('ready', (addr) => {
    console.log(`Bridge listening on ${addr}`);
});
```

## 2. Client (Machine)
The Client runs on each VPS/Machine and connects to the Bridge.

```typescript
import { Client } from '@ovencord/cross-hosting';
import { Manager } from '@ovencord/hybrid-sharding';

const client = new Client({
    agent: 'bot',
    host: 'bridge-vps-ip',
    port: 4444,
    authToken: 'YOUR_SECURE_TOKEN',
    rollingRestarts: true,
});

const manager = new Manager('./bot.ts', { totalShards: 'auto' });

client.on('debug', console.log);
client.connect();

client.listen(manager);

client.requestShardData().then(data => {
    manager.totalShards = data.totalShards;
    manager.spawn();
});
```

## 3. Shard (Bot)
Access cross-hosting features directly from your bot instance.

```typescript
import { Shard } from '@ovencord/cross-hosting';
import { Client } from '@ovencord/hybrid-sharding';
import { Client as DiscordClient } from 'discord.js';

const client = new DiscordClient({ intents: [1] });
client.cluster = new Client(client);
client.crosshost = new Shard(client.cluster);

client.on('ready', async () => {
    const totalGuilds = await client.crosshost.broadcastEval('this.guilds.cache.size');
    console.log(`Total Guilds across all machines: ${totalGuilds.reduce((a, b) => a + b, 0)}`);
});

client.login('TOKEN');
```

# API References

Refer to the source code for detailed type definitions. The library is written in pure TypeScript and leverages Bun's native types for networking.

---
**Maintained by Luigi Colantuono**
