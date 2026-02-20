/**
 * Type stubs for transitive @ovencord dependencies.
 * cross-hosting only uses @ovencord/hybrid-sharding directly,
 * but hybrid-sharding imports these packages which ship raw .ts
 * source files. This stub prevents TypeScript from type-checking
 * the entire transitive dependency tree.
 */

declare module '@ovencord/discord.js' {
    const _default: any;
    export default _default;
    export type Client = any;
    export type Guild = any;
    export type GuildMember = any;
    export type Message = any;
    export type TextChannel = any;
    export type VoiceChannel = any;
    export type Interaction = any;
    export type CommandInteraction = any;
    export type Collection<K, V> = Map<K, V>;
    export const GatewayIntentBits: any;
    export const Partials: any;
    export const Events: any;
}

declare module '@ovencord/discord.js/*' {
    const _default: any;
    export = _default;
}

declare module '@ovencord/builders' {
    const _default: any;
    export default _default;
    export type SlashCommandBuilder = any;
    export type EmbedBuilder = any;
    export type ActionRowBuilder = any;
    export type ButtonBuilder = any;
}

declare module '@ovencord/builders/*' {
    const _default: any;
    export = _default;
}

declare module '@ovencord/rest' {
    const _default: any;
    export default _default;
    export type REST = any;
    export const Routes: any;
}

declare module '@ovencord/rest/*' {
    const _default: any;
    export = _default;
}

declare module '@ovencord/util' {
    const _default: any;
    export default _default;
}

declare module '@ovencord/util/*' {
    const _default: any;
    export = _default;
}
