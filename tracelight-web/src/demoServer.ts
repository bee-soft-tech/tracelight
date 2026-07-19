// Client-side mock of the Tracelight WebSocket backend, used only for the static live demo
// (GitHub Pages) where no real server exists. When enabled it replaces window.WebSocket with a
// fake that streams a realistic topology + simulated request traffic, so the graph pulses,
// counters tick and dots fly exactly as if connected to a running app. Enabled at build time via
// VITE_DEMO=true; a normal build never touches window.WebSocket.

import type { TLNode, TLEdge, TracelightEvent } from 'tracelight-react';

type NodeDef = Omit<TLNode, 'count'>;

// Three routes plus one exception node, mirroring the README's "POST /order" example.
const NODES: NodeDef[] = [
  { id: 'POST /order', label: 'POST /order', kind: 'entry' },
  { id: 'validateOrder', label: 'validateOrder', kind: 'point' },
  { id: 'checkInventory', label: 'checkInventory', kind: 'point' },
  { id: 'reserveStock', label: 'reserveStock', kind: 'point' },
  { id: 'chargePayment', label: 'chargePayment', kind: 'point' },
  { id: 'createShipment', label: 'createShipment', kind: 'point' },
  { id: 'Return POST /order', label: 'Return POST /order', kind: 'point' },
  {
    id: 'PaymentDeclined',
    label: 'PaymentDeclined',
    kind: 'error',
    message: 'CardDeclinedException: card ending 4242 was declined (insufficient funds)',
    stack: [
      'io.beesofttech.shop.PaymentService.charge(PaymentService.java:88)',
      'io.beesofttech.shop.OrderService.placeOrder(OrderService.java:57)',
      'io.beesofttech.shop.OrderController.create(OrderController.java:34)',
    ],
  },
  { id: 'GET /search', label: 'GET /search', kind: 'entry' },
  { id: 'parseQuery', label: 'parseQuery', kind: 'point' },
  { id: 'queryIndex', label: 'queryIndex', kind: 'point' },
  { id: 'rankResults', label: 'rankResults', kind: 'point' },
  { id: 'Return GET /search', label: 'Return GET /search', kind: 'point' },
  { id: 'GET /product/{id}', label: 'GET /product/{id}', kind: 'entry' },
  { id: 'loadProduct', label: 'loadProduct', kind: 'point' },
  { id: 'cacheLookup', label: 'cacheLookup', kind: 'point' },
  { id: 'Return GET /product/{id}', label: 'Return GET /product/{id}', kind: 'point' },
];

interface Route {
  entry: string;
  happy: string[];
  error?: string[];
  errorRate?: number;
}

const ROUTES: Route[] = [
  {
    entry: 'POST /order',
    happy: [
      'POST /order', 'validateOrder', 'checkInventory', 'reserveStock',
      'chargePayment', 'createShipment', 'Return POST /order',
    ],
    error: [
      'POST /order', 'validateOrder', 'checkInventory', 'reserveStock',
      'chargePayment', 'PaymentDeclined', 'Return POST /order',
    ],
    errorRate: 0.12,
  },
  {
    entry: 'GET /search',
    happy: ['GET /search', 'parseQuery', 'queryIndex', 'rankResults', 'Return GET /search'],
  },
  {
    entry: 'GET /product/{id}',
    happy: ['GET /product/{id}', 'loadProduct', 'cacheLookup', 'Return GET /product/{id}'],
  },
];

// Characteristic latency (ms) per edge; anything unlisted gets a small random cost.
const BASE_MS: Record<string, number> = {
  'POST /order->validateOrder': 3,
  'validateOrder->checkInventory': 6,
  'checkInventory->reserveStock': 9,
  'reserveStock->chargePayment': 14,
  'chargePayment->createShipment': 22,
  'chargePayment->PaymentDeclined': 18,
  'GET /search->parseQuery': 2,
  'parseQuery->queryIndex': 11,
  'queryIndex->rankResults': 7,
  'GET /product/{id}->loadProduct': 4,
  'loadProduct->cacheLookup': 5,
};

const edges = (() => {
  const set = new Map<string, TLEdge>();
  for (const r of ROUTES) {
    for (const path of [r.happy, r.error].filter(Boolean) as string[][]) {
      for (let i = 0; i < path.length - 1; i++) {
        const id = `${path[i]}->${path[i + 1]}`;
        if (!set.has(id)) set.set(id, { id, from: path[i], to: path[i + 1] });
      }
    }
  }
  return [...set.values()];
})();

const jitter = (base: number) => Math.max(0.4, base * (0.6 + Math.random() * 0.9));

class MockTracelightSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = MockTracelightSocket.CONNECTING;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: CloseEvent) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;

  private counts: Record<string, number> = {};
  private stats: Record<string, { min: number; max: number; sum: number; n: number }> = {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;

  constructor(_url: string) {
    setTimeout(() => {
      this.readyState = MockTracelightSocket.OPEN;
      this.onopen?.(new Event('open'));
      this.emit({
        type: 'snapshot',
        nodes: NODES.map((n) => ({ ...n, count: 0 })),
        edges: edges.map((e) => ({ ...e })),
      });
      // Kick a few requests immediately so the graph is alive on first paint, then keep going.
      for (let i = 0; i < 3; i++) setTimeout(() => this.fireRequest(), 150 * i);
      this.timer = setInterval(() => this.fireRequest(), 700);
    }, 120);
  }

  send(data: string) {
    if (data === 'reset') {
      this.counts = {};
      this.stats = {};
      this.emit({ type: 'reset' });
    }
  }

  close() {
    this.readyState = MockTracelightSocket.CLOSED;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.onclose?.(new CloseEvent('close'));
  }

  addEventListener() {}
  removeEventListener() {}

  private emit(ev: TracelightEvent) {
    this.onmessage?.({ data: JSON.stringify(ev) } as MessageEvent);
  }

  private fireRequest() {
    const route = ROUTES[Math.floor(Math.random() * ROUTES.length)];
    const path =
      route.error && Math.random() < (route.errorRate ?? 0) ? route.error : route.happy;
    const traceId = String(this.nextId++);

    this.emit({ type: 'open', traceId, entry: route.entry });
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i];
      const to = path[i + 1];
      const id = `${from}->${to}`;
      const ms = jitter(BASE_MS[id] ?? 3 + Math.random() * 20);
      const s = (this.stats[id] ??= { min: ms, max: ms, sum: 0, n: 0 });
      s.min = Math.min(s.min, ms);
      s.max = Math.max(s.max, ms);
      s.sum += ms;
      s.n += 1;
      this.counts[to] = (this.counts[to] ?? 0) + 1;
      this.emit({
        type: 'pulse',
        traceId,
        from,
        to,
        count: this.counts[to],
        ms,
        min: s.min,
        avg: s.sum / s.n,
        max: s.max,
        samples: s.n,
      });
    }
    this.emit({ type: 'close', traceId, from: path[path.length - 1], to: route.entry });
  }
}

/** Replace window.WebSocket with the mock and drop a small "live demo" badge into the page. */
export function installDemoServer() {
  (window as unknown as { WebSocket: unknown }).WebSocket =
    MockTracelightSocket as unknown as typeof WebSocket;

  const badge = document.createElement('div');
  badge.textContent = '● Live demo — simulated traffic (no backend)';
  badge.style.cssText =
    'position:fixed;left:12px;bottom:12px;z-index:9999;padding:6px 10px;border-radius:6px;' +
    'font:600 12px system-ui,sans-serif;color:#fff;background:rgba(20,20,28,.82);' +
    'box-shadow:0 2px 10px rgba(0,0,0,.3);pointer-events:none;letter-spacing:.2px';
  const show = () => document.body && document.body.appendChild(badge);
  if (document.body) show();
  else window.addEventListener('DOMContentLoaded', show);
}
