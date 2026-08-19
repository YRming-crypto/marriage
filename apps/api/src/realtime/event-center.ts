import type {
  RealtimeDelivery,
  RealtimeEvent,
  RealtimeEventType,
  RealtimeSubscriber,
  ResyncEvent,
  SubscribeOptions,
} from "./types.js";

export interface RealtimeEventCenterOptions {
  historySize?: number;
  now?: () => number;
  onSubscriberError?: (
    error: unknown,
    event: RealtimeDelivery,
    userId: string,
  ) => unknown;
}

interface UserEventStream {
  droppedThroughId?: number;
  history: RealtimeEvent[];
}

interface SubscriberState {
  active: boolean;
  delivering: boolean;
  handler: RealtimeSubscriber;
  queue: RealtimeDelivery[];
  userId: string;
}

const defaultHistorySize = 100;

export class RealtimeEventCenter {
  private readonly historySize: number;
  private readonly now: () => number;
  private readonly onSubscriberError?: RealtimeEventCenterOptions["onSubscriberError"];
  private readonly streams = new Map<string, UserEventStream>();
  private readonly subscribers = new Map<string, Set<SubscriberState>>();
  private sequence = 0;

  constructor(options: RealtimeEventCenterOptions = {}) {
    const historySize = options.historySize ?? defaultHistorySize;
    if (!Number.isSafeInteger(historySize) || historySize < 1) {
      throw new RangeError("historySize must be a positive safe integer");
    }

    this.historySize = historySize;
    this.now = options.now ?? Date.now;
    this.onSubscriberError = options.onSubscriberError;
  }

  publish<TData>(userId: string, type: RealtimeEventType, data: TData): RealtimeEvent<TData> {
    const event: RealtimeEvent<TData> = {
      id: ++this.sequence,
      type,
      userId,
      occurredAt: this.now(),
      data,
    };
    const stream = this.getOrCreateStream(userId);
    stream.history.push(event as RealtimeEvent);

    if (stream.history.length > this.historySize) {
      const dropped = stream.history.shift();
      if (dropped) stream.droppedThroughId = dropped.id;
    }

    for (const subscriber of this.subscribers.get(userId) ?? []) {
      this.enqueue(subscriber, event);
    }

    return event;
  }

  subscribe(
    userId: string,
    subscriber: RealtimeSubscriber,
    options: SubscribeOptions = {},
  ): () => void {
    const state: SubscriberState = {
      active: true,
      delivering: false,
      handler: subscriber,
      queue: [],
      userId,
    };
    const lastEventId = this.parseLastEventId(options.lastEventId);
    const replay = lastEventId === undefined ? [] : this.getReplay(userId, lastEventId);

    let userSubscribers = this.subscribers.get(userId);
    if (!userSubscribers) {
      userSubscribers = new Set();
      this.subscribers.set(userId, userSubscribers);
    }
    userSubscribers.add(state);

    state.queue.push(...replay);
    if (state.queue.length > 0) {
      this.scheduleDrain(state);
    }

    return () => {
      if (!state.active) return;

      state.active = false;
      state.queue.length = 0;
      const currentSubscribers = this.subscribers.get(userId);
      currentSubscribers?.delete(state);
      if (currentSubscribers?.size === 0) this.subscribers.delete(userId);
    };
  }

  private getReplay(userId: string, lastEventId: number): RealtimeDelivery[] {
    const stream = this.streams.get(userId);
    if (!stream) {
      if (lastEventId === 0) return [];
      const resync: ResyncEvent = {
        id: this.sequence,
        type: "resync",
        userId,
        occurredAt: this.now(),
        data: {
          reason: "stream-reset",
          requestedLastEventId: lastEventId,
          oldestAvailableEventId: this.sequence,
          latestEventId: this.sequence,
        },
      };
      return [resync];
    }

    if (stream.droppedThroughId !== undefined && lastEventId < stream.droppedThroughId) {
      const oldestAvailable = stream.history[0];
      const latest = stream.history[stream.history.length - 1];
      if (!oldestAvailable || !latest) return [];

      const resync: ResyncEvent = {
        id: latest.id,
        type: "resync",
        userId,
        occurredAt: this.now(),
        data: {
          reason: "history-expired",
          requestedLastEventId: lastEventId,
          oldestAvailableEventId: oldestAvailable.id,
          latestEventId: latest.id,
        },
      };
      return [resync];
    }

    return stream.history.filter((event) => event.id > lastEventId);
  }

  private enqueue(state: SubscriberState, event: RealtimeDelivery): void {
    if (!state.active) return;

    state.queue.push(event);
    this.scheduleDrain(state);
  }

  private scheduleDrain(state: SubscriberState): void {
    if (state.delivering) return;

    state.delivering = true;
    queueMicrotask(() => void this.drain(state));
  }

  private async drain(state: SubscriberState): Promise<void> {
    try {
      while (state.active) {
        const event = state.queue.shift();
        if (!event) break;

        try {
          await state.handler(event);
        } catch (error) {
          this.reportSubscriberError(error, event, state.userId);
        }
      }
    } finally {
      if (!state.active) state.queue.length = 0;
      state.delivering = false;
    }
  }

  private reportSubscriberError(
    error: unknown,
    event: RealtimeDelivery,
    userId: string,
  ): void {
    if (!this.onSubscriberError) return;

    try {
      Promise.resolve(this.onSubscriberError(error, event, userId)).catch(() => undefined);
    } catch {
      // Error reporting must not break event delivery.
    }
  }

  private getOrCreateStream(userId: string): UserEventStream {
    let stream = this.streams.get(userId);
    if (!stream) {
      stream = { history: [] };
      this.streams.set(userId, stream);
    }
    return stream;
  }

  private parseLastEventId(value: SubscribeOptions["lastEventId"]): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;

    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new RangeError("lastEventId must be a non-negative safe integer");
    }
    return parsed;
  }
}
