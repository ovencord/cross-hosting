/**
 * Lightweight AsyncEventEmitter — zero node:events dependency.
 * Drop-in replacement for EventEmitter with legacy aliases.
 */
export class AsyncEventEmitter {
    private _listeners = new Map<string | symbol, ((...args: any[]) => void)[]>();

    on(event: string | symbol, listener: (...args: any[]) => void): this {
        const listeners = this._listeners.get(event);
        if (listeners) {
            listeners.push(listener);
        } else {
            this._listeners.set(event, [listener]);
        }
        return this;
    }

    off(event: string | symbol, listener: (...args: any[]) => void): this {
        const listeners = this._listeners.get(event);
        if (!listeners) return this;
        const idx = listeners.indexOf(listener);
        if (idx !== -1) listeners.splice(idx, 1);
        if (listeners.length === 0) this._listeners.delete(event);
        return this;
    }

    once(event: string | symbol, listener: (...args: any[]) => void): this {
        const wrapper = (...args: any[]) => {
            this.off(event, wrapper);
            listener.apply(this, args);
        };
        return this.on(event, wrapper);
    }

    emit(event: string | symbol, ...args: any[]): boolean {
        const listeners = this._listeners.get(event);
        if (!listeners || listeners.length === 0) return false;
        // Snapshot to avoid mutation during iteration
        const snapshot = [...listeners];
        for (const fn of snapshot) {
            fn.apply(this, args);
        }
        return true;
    }

    listenerCount(event: string | symbol): number {
        return this._listeners.get(event)?.length ?? 0;
    }

    removeAllListeners(event?: string | symbol): this {
        if (event !== undefined) {
            this._listeners.delete(event);
        } else {
            this._listeners.clear();
        }
        return this;
    }

    /** Legacy alias for {@link on} */
    addListener(event: string | symbol, listener: (...args: any[]) => void): this {
        return this.on(event, listener);
    }

    /** Legacy alias for {@link off} */
    removeListener(event: string | symbol, listener: (...args: any[]) => void): this {
        return this.off(event, listener);
    }
}
