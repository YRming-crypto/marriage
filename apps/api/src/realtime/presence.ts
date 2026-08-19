export interface RealtimeClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface PresenceSnapshot {
  userId: string;
  online: boolean;
  connectionCount: number;
  lastActiveAt: number;
}

export interface TypingSnapshot {
  userId: string;
  conversationId: string;
  typing: boolean;
  expiresAt: number | null;
}

export interface PresenceConnection {
  readonly userId: string;
  touch(): void;
  setTyping(conversationId: string, typing: boolean): void;
  disconnect(): void;
}

export interface PresenceTrackerOptions {
  clock?: RealtimeClock;
  typingTtlMs?: number;
  onPresenceChanged?: (snapshot: PresenceSnapshot) => unknown;
  onTypingChanged?: (snapshot: TypingSnapshot) => unknown;
  onCallbackError?: (error: unknown) => unknown;
}

interface TypingState {
  expiresAt: number;
  timer: unknown;
}

interface ConnectionState {
  active: boolean;
  typing: Map<string, TypingState>;
}

interface UserPresenceState {
  connections: Map<symbol, ConnectionState>;
  lastActiveAt: number;
}

const defaultTypingTtlMs = 5_000;

const systemClock: RealtimeClock = {
  now: Date.now,
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class PresenceTracker {
  private readonly clock: RealtimeClock;
  private readonly typingTtlMs: number;
  private readonly onPresenceChanged?: PresenceTrackerOptions["onPresenceChanged"];
  private readonly onTypingChanged?: PresenceTrackerOptions["onTypingChanged"];
  private readonly onCallbackError?: PresenceTrackerOptions["onCallbackError"];
  private readonly users = new Map<string, UserPresenceState>();

  constructor(options: PresenceTrackerOptions = {}) {
    const typingTtlMs = options.typingTtlMs ?? defaultTypingTtlMs;
    if (!Number.isFinite(typingTtlMs) || typingTtlMs <= 0) {
      throw new RangeError("typingTtlMs must be greater than zero");
    }

    this.clock = options.clock ?? systemClock;
    this.typingTtlMs = typingTtlMs;
    this.onPresenceChanged = options.onPresenceChanged;
    this.onTypingChanged = options.onTypingChanged;
    this.onCallbackError = options.onCallbackError;
  }

  connect(userId: string): PresenceConnection {
    const connectionId = Symbol(userId);
    const connection: ConnectionState = { active: true, typing: new Map() };
    const now = this.clock.now();
    let user = this.users.get(userId);
    if (!user) {
      user = { connections: new Map(), lastActiveAt: now };
      this.users.set(userId, user);
    }
    user.lastActiveAt = now;
    user.connections.set(connectionId, connection);
    this.emitPresence(userId, user);

    return {
      userId,
      touch: () => this.touch(userId, connection),
      setTyping: (conversationId, typing) => {
        this.setTyping(userId, connection, conversationId, typing);
      },
      disconnect: () => this.disconnect(userId, connectionId, connection),
    };
  }

  getPresence(userId: string): PresenceSnapshot {
    const user = this.users.get(userId);
    if (!user) {
      return {
        userId,
        online: false,
        connectionCount: 0,
        lastActiveAt: 0,
      };
    }
    return this.snapshotPresence(userId, user);
  }

  isTyping(userId: string, conversationId: string): boolean {
    return this.getTypingExpiry(this.users.get(userId), conversationId) !== null;
  }

  private touch(userId: string, connection: ConnectionState): void {
    if (!connection.active) return;

    const user = this.users.get(userId);
    if (!user) return;
    user.lastActiveAt = this.clock.now();
    this.emitPresence(userId, user);
  }

  private setTyping(
    userId: string,
    connection: ConnectionState,
    conversationId: string,
    typing: boolean,
  ): void {
    if (!connection.active) return;

    const user = this.users.get(userId);
    if (!user) return;
    user.lastActiveAt = this.clock.now();

    const previousExpiry = this.getTypingExpiry(user, conversationId);
    const previous = connection.typing.get(conversationId);
    if (previous) this.clock.clearTimeout(previous.timer);

    if (typing) {
      const expiresAt = this.clock.now() + this.typingTtlMs;
      const typingState: TypingState = {
        expiresAt,
        timer: undefined,
      };
      typingState.timer = this.clock.setTimeout(() => {
        if (!connection.active || connection.typing.get(conversationId) !== typingState) return;

        const aggregateExpiry = this.getTypingExpiry(user, conversationId);
        connection.typing.delete(conversationId);
        this.emitTypingIfChanged(userId, user, conversationId, aggregateExpiry);
      }, this.typingTtlMs);
      connection.typing.set(conversationId, typingState);
    } else {
      connection.typing.delete(conversationId);
    }

    this.emitTypingIfChanged(userId, user, conversationId, previousExpiry);
  }

  private disconnect(
    userId: string,
    connectionId: symbol,
    connection: ConnectionState,
  ): void {
    if (!connection.active) return;

    connection.active = false;
    const user = this.users.get(userId);
    if (!user) return;

    const previousTyping = new Map<string, number | null>();
    for (const conversationId of connection.typing.keys()) {
      previousTyping.set(conversationId, this.getTypingExpiry(user, conversationId));
    }
    for (const typing of connection.typing.values()) {
      this.clock.clearTimeout(typing.timer);
    }
    connection.typing.clear();
    user.connections.delete(connectionId);
    user.lastActiveAt = this.clock.now();

    for (const [conversationId, previousExpiry] of previousTyping) {
      this.emitTypingIfChanged(userId, user, conversationId, previousExpiry);
    }
    this.emitPresence(userId, user);
  }

  private emitTypingIfChanged(
    userId: string,
    user: UserPresenceState,
    conversationId: string,
    previousExpiry: number | null,
  ): void {
    const expiresAt = this.getTypingExpiry(user, conversationId);
    if (expiresAt === previousExpiry) return;

    this.invokeCallback(this.onTypingChanged, {
      userId,
      conversationId,
      typing: expiresAt !== null,
      expiresAt,
    });
  }

  private getTypingExpiry(
    user: UserPresenceState | undefined,
    conversationId: string,
  ): number | null {
    if (!user) return null;

    let latestExpiry: number | null = null;
    for (const connection of user.connections.values()) {
      const expiresAt = connection.typing.get(conversationId)?.expiresAt;
      if (expiresAt !== undefined && (latestExpiry === null || expiresAt > latestExpiry)) {
        latestExpiry = expiresAt;
      }
    }
    return latestExpiry;
  }

  private emitPresence(userId: string, user: UserPresenceState): void {
    this.invokeCallback(this.onPresenceChanged, this.snapshotPresence(userId, user));
  }

  private snapshotPresence(userId: string, user: UserPresenceState): PresenceSnapshot {
    const connectionCount = user.connections.size;
    return {
      userId,
      online: connectionCount > 0,
      connectionCount,
      lastActiveAt: user.lastActiveAt,
    };
  }

  private invokeCallback<T>(callback: ((value: T) => unknown) | undefined, value: T): void {
    if (!callback) return;

    try {
      Promise.resolve(callback(value)).catch((error) => this.reportCallbackError(error));
    } catch (error) {
      this.reportCallbackError(error);
    }
  }

  private reportCallbackError(error: unknown): void {
    if (!this.onCallbackError) return;

    try {
      Promise.resolve(this.onCallbackError(error)).catch(() => undefined);
    } catch {
      // Error reporting must not alter presence state.
    }
  }
}
