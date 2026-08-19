import { describe, expect, it } from "vitest";
import {
  PresenceTracker,
  RealtimeEventCenter,
  type PresenceSnapshot,
  type RealtimeClock,
  type RealtimeDelivery,
  type RealtimeEventType,
  type TypingSnapshot,
} from "./index.js";

const flushDeliveries = () => new Promise<void>((resolve) => setImmediate(resolve));

class ManualClock implements RealtimeClock {
  private currentTime: number;
  private nextTimerId = 1;
  private readonly timers = new Map<number, { callback: () => void; dueAt: number }>();

  constructor(initialTime = 0) {
    this.currentTime = initialTime;
  }

  now = () => this.currentTime;

  setTimeout = (callback: () => void, delayMs: number): number => {
    const timerId = this.nextTimerId++;
    this.timers.set(timerId, { callback, dueAt: this.currentTime + delayMs });
    return timerId;
  };

  clearTimeout = (timerId: unknown): void => {
    this.timers.delete(timerId as number);
  };

  advanceBy(milliseconds: number): void {
    const targetTime = this.currentTime + milliseconds;

    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.dueAt <= targetTime)
        .sort((left, right) => left[1].dueAt - right[1].dueAt || left[0] - right[0])[0];
      if (!next) break;

      const [timerId, timer] = next;
      this.currentTime = timer.dueAt;
      this.timers.delete(timerId);
      timer.callback();
    }

    this.currentTime = targetTime;
  }
}

describe("RealtimeEventCenter", () => {
  it("broadcasts only to the addressed user and supports every domain event type", async () => {
    const center = new RealtimeEventCenter();
    const aliceEvents: RealtimeDelivery[] = [];
    const bobEvents: RealtimeDelivery[] = [];
    const eventTypes: RealtimeEventType[] = [
      "message.created",
      "message.read",
      "typing.changed",
      "presence.changed",
      "conversation.updated",
      "notification.created",
    ];
    center.subscribe("alice", (event) => aliceEvents.push(event));
    center.subscribe("bob", (event) => bobEvents.push(event));

    for (const type of eventTypes) {
      center.publish("alice", type, { type });
    }
    center.publish("bob", "notification.created", { id: "bob-notification" });
    await flushDeliveries();

    expect(aliceEvents.map((event) => event.type)).toEqual(eventTypes);
    expect(aliceEvents.every((event) => event.userId === "alice")).toBe(true);
    expect(bobEvents).toHaveLength(1);
    expect(bobEvents[0]).toMatchObject({
      type: "notification.created",
      userId: "bob",
      data: { id: "bob-notification" },
    });
  });

  it("assigns increasing sequence IDs and replays events after Last-Event-ID", async () => {
    const center = new RealtimeEventCenter({ historySize: 5, now: () => 1234 });
    const first = center.publish("alice", "message.created", { id: "m1" });
    const second = center.publish("bob", "message.created", { id: "other-user" });
    const third = center.publish("alice", "message.read", { id: "m1" });
    const replayed: RealtimeDelivery[] = [];

    center.subscribe("alice", (event) => replayed.push(event), {
      lastEventId: String(first.id),
    });
    await flushDeliveries();

    expect([first.id, second.id, third.id]).toEqual([1, 2, 3]);
    expect(replayed).toEqual([third]);
    expect(third.occurredAt).toBe(1234);
  });

  it("keeps replay before live events published synchronously while replay starts", async () => {
    const center = new RealtimeEventCenter();
    center.publish("alice", "message.created", { id: "m1" });
    center.publish("alice", "message.created", { id: "m2" });
    const receivedEventIds: number[] = [];

    center.subscribe("alice", (event) => {
      receivedEventIds.push(event.id);
      if (event.id === 1) {
        center.publish("alice", "message.created", { id: "m3" });
      }
    }, { lastEventId: 0 });
    await flushDeliveries();

    expect(receivedEventIds).toEqual([1, 2, 3]);
  });

  it("sends resync instead of partial history when Last-Event-ID has expired", async () => {
    const center = new RealtimeEventCenter({ historySize: 2 });
    const expired = center.publish("alice", "message.created", { id: "m1" });
    center.publish("alice", "message.created", { id: "m2" });
    const oldestAvailable = center.publish("alice", "message.created", { id: "m3" });
    const latest = center.publish("alice", "message.created", { id: "m4" });
    const replayed: RealtimeDelivery[] = [];

    center.subscribe("alice", (event) => replayed.push(event), {
      lastEventId: expired.id,
    });
    await flushDeliveries();

    expect(replayed).toEqual([{
      id: latest.id,
      type: "resync",
      userId: "alice",
      occurredAt: expect.any(Number),
      data: {
        reason: "history-expired",
        requestedLastEventId: expired.id,
        oldestAvailableEventId: oldestAvailable.id,
        latestEventId: latest.id,
      },
    }]);
  });

  it("requests a resync when a client reconnects with an event id after the server stream was reset", async () => {
    const restartedCenter = new RealtimeEventCenter({ now: () => 4321 });
    const replayed: RealtimeDelivery[] = [];

    restartedCenter.subscribe("alice", (event) => replayed.push(event), { lastEventId: 87 });
    await flushDeliveries();

    expect(replayed).toEqual([{
      id: 0,
      type: "resync",
      userId: "alice",
      occurredAt: 4321,
      data: {
        reason: "stream-reset",
        requestedLastEventId: 87,
        oldestAvailableEventId: 0,
        latestEventId: 0,
      },
    }]);
  });

  it("lets fast subscribers continue while another subscriber is slow", async () => {
    const center = new RealtimeEventCenter();
    const slowEventIds: number[] = [];
    const fastEventIds: number[] = [];
    let releaseSlow: (() => void) | undefined;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    center.subscribe("alice", async (event) => {
      slowEventIds.push(event.id);
      await slowGate;
    });
    center.subscribe("alice", (event) => fastEventIds.push(event.id));

    center.publish("alice", "message.created", { id: "m1" });
    center.publish("alice", "message.created", { id: "m2" });
    await flushDeliveries();

    expect(slowEventIds).toEqual([1]);
    expect(fastEventIds).toEqual([1, 2]);

    releaseSlow?.();
    await flushDeliveries();
    expect(slowEventIds).toEqual([1, 2]);
  });

  it("contains subscriber exceptions and keeps all subscriptions usable", async () => {
    const reportedErrors: unknown[] = [];
    const center = new RealtimeEventCenter({
      onSubscriberError: (error) => reportedErrors.push(error),
    });
    const failingEventIds: number[] = [];
    const healthyEventIds: number[] = [];
    center.subscribe("alice", (event) => {
      failingEventIds.push(event.id);
      throw new Error(`failed ${event.id}`);
    });
    center.subscribe("alice", (event) => healthyEventIds.push(event.id));

    center.publish("alice", "message.created", { id: "m1" });
    center.publish("alice", "message.read", { id: "m1" });
    await flushDeliveries();

    expect(failingEventIds).toEqual([1, 2]);
    expect(healthyEventIds).toEqual([1, 2]);
    expect(reportedErrors).toHaveLength(2);
  });

  it("preserves sequence order for every subscriber during nested publishing", async () => {
    const center = new RealtimeEventCenter();
    const firstSubscriberIds: number[] = [];
    const secondSubscriberIds: number[] = [];
    center.subscribe("alice", (event) => {
      firstSubscriberIds.push(event.id);
      if (event.id === 1) {
        center.publish("alice", "message.read", { id: "m1" });
      }
    });
    center.subscribe("alice", (event) => secondSubscriberIds.push(event.id));

    center.publish("alice", "message.created", { id: "m1" });
    await flushDeliveries();

    expect(firstSubscriberIds).toEqual([1, 2]);
    expect(secondSubscriberIds).toEqual([1, 2]);
  });

  it("unsubscribes idempotently without affecting a user's other subscribers", async () => {
    const center = new RealtimeEventCenter();
    const removedEvents: number[] = [];
    const remainingEvents: number[] = [];
    const unsubscribe = center.subscribe("alice", (event) => removedEvents.push(event.id));
    center.subscribe("alice", (event) => remainingEvents.push(event.id));

    unsubscribe();
    unsubscribe();
    center.publish("alice", "conversation.updated", { id: "c1" });
    await flushDeliveries();

    expect(removedEvents).toEqual([]);
    expect(remainingEvents).toEqual([1]);
  });
});

describe("PresenceTracker", () => {
  it("keeps a user online until every connection has disconnected", () => {
    const clock = new ManualClock(1000);
    const changes: PresenceSnapshot[] = [];
    const tracker = new PresenceTracker({
      clock,
      onPresenceChanged: (snapshot) => changes.push(snapshot),
    });
    const firstConnection = tracker.connect("alice");
    clock.advanceBy(10);
    const secondConnection = tracker.connect("alice");

    firstConnection.disconnect();
    firstConnection.disconnect();

    expect(tracker.getPresence("alice")).toEqual({
      userId: "alice",
      online: true,
      connectionCount: 1,
      lastActiveAt: 1010,
    });

    clock.advanceBy(5);
    secondConnection.disconnect();
    expect(tracker.getPresence("alice")).toEqual({
      userId: "alice",
      online: false,
      connectionCount: 0,
      lastActiveAt: 1015,
    });
    expect(changes.map((change) => change.connectionCount)).toEqual([1, 2, 1, 0]);
  });

  it("updates last active time on explicit connection activity", () => {
    const clock = new ManualClock(2000);
    const tracker = new PresenceTracker({ clock });
    const connection = tracker.connect("alice");

    clock.advanceBy(25);
    connection.touch();

    expect(tracker.getPresence("alice").lastActiveAt).toBe(2025);
  });

  it("automatically expires typing with an injected deterministic timer", () => {
    const clock = new ManualClock(5000);
    const typingChanges: TypingSnapshot[] = [];
    const tracker = new PresenceTracker({
      clock,
      typingTtlMs: 50,
      onTypingChanged: (snapshot) => typingChanges.push(snapshot),
    });
    const connection = tracker.connect("alice");

    connection.setTyping("conversation-1", true);
    clock.advanceBy(49);
    expect(tracker.isTyping("alice", "conversation-1")).toBe(true);

    clock.advanceBy(1);
    expect(tracker.isTyping("alice", "conversation-1")).toBe(false);
    expect(typingChanges).toEqual([
      {
        userId: "alice",
        conversationId: "conversation-1",
        typing: true,
        expiresAt: 5050,
      },
      {
        userId: "alice",
        conversationId: "conversation-1",
        typing: false,
        expiresAt: null,
      },
    ]);
  });

  it("clears only the disconnected connection's typing resources", () => {
    const clock = new ManualClock(8000);
    const tracker = new PresenceTracker({ clock, typingTtlMs: 100 });
    const firstConnection = tracker.connect("alice");
    const secondConnection = tracker.connect("alice");
    firstConnection.setTyping("conversation-1", true);
    secondConnection.setTyping("conversation-1", true);

    firstConnection.disconnect();
    expect(tracker.isTyping("alice", "conversation-1")).toBe(true);

    secondConnection.disconnect();
    expect(tracker.isTyping("alice", "conversation-1")).toBe(false);

    clock.advanceBy(100);
    expect(tracker.isTyping("alice", "conversation-1")).toBe(false);
  });

  it("keeps aggregate typing unchanged when an earlier connection expires", () => {
    const clock = new ManualClock(9000);
    const typingChanges: TypingSnapshot[] = [];
    const tracker = new PresenceTracker({
      clock,
      typingTtlMs: 100,
      onTypingChanged: (snapshot) => typingChanges.push(snapshot),
    });
    const firstConnection = tracker.connect("alice");
    const secondConnection = tracker.connect("alice");
    firstConnection.setTyping("conversation-1", true);
    clock.advanceBy(50);
    secondConnection.setTyping("conversation-1", true);

    clock.advanceBy(50);
    expect(tracker.isTyping("alice", "conversation-1")).toBe(true);
    expect(typingChanges).toHaveLength(2);

    clock.advanceBy(50);
    expect(tracker.isTyping("alice", "conversation-1")).toBe(false);
    expect(typingChanges).toHaveLength(3);
    expect(typingChanges[2]).toMatchObject({ typing: false, expiresAt: null });
  });
});
