export const realtimeEventTypes = [
  "message.created",
  "message.recalled",
  "message.read",
  "typing.changed",
  "presence.changed",
  "conversation.updated",
  "notification.created",
] as const;

export type RealtimeEventType = typeof realtimeEventTypes[number];

export interface RealtimeEvent<TData = unknown> {
  id: number;
  type: RealtimeEventType;
  userId: string;
  occurredAt: number;
  data: TData;
}

export interface ResyncEvent {
  id: number;
  type: "resync";
  userId: string;
  occurredAt: number;
  data: {
    reason: "history-expired" | "stream-reset";
    requestedLastEventId: number;
    oldestAvailableEventId: number;
    latestEventId: number;
  };
}

export type RealtimeDelivery<TData = unknown> = RealtimeEvent<TData> | ResyncEvent;

export type RealtimeSubscriber = (event: RealtimeDelivery) => unknown;

export interface SubscribeOptions {
  lastEventId?: number | string | null;
}
