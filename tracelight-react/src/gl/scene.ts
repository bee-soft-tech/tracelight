import { Application, Container, type FederatedPointerEvent, Graphics, Text } from 'pixi.js';
import {
  Pool,
  arrowhead,
  bezierControls,
  contentBounds,
  cubicBezier,
  edgeEndpoints,
  fitTransform,
  type Point,
} from './geometry';
import {
  ARROW_SIZE,
  NODE_MIN_DIST,
  REPLAY_HOP_BASE_MS,
  REPLAY_HOP_MAX_MS,
  REPLAY_LOOP_GAP_MS,
  REPLAY_MS_SCALE,
  SPACING_ITERATIONS,
  TRACE_TTL_MS,
  TRAIL_ALPHA_BASE,
  TRAIL_LENGTH,
} from './constants';
import {
  advance,
  createPlayback,
  enqueue,
  hopDuration,
  isDone,
  shouldEvict,
  type Hop,
  type HopGeom,
  type Playback,
} from './playback';
import { pushOutOne, relaxAll, type Center } from './spacing';
import type { ReplayHop, TLEdge, TLNode } from '../types';

export type ColorMode = 'light' | 'dark' | 'system';

interface Palette {
  bg: number;
  nodeFill: number;
  nodeBorder: number;
  nodeText: number;
  entryFill: number;
  entryText: number;
  countText: number;
  countBg: number;
  edge: number;
  flash: number;
  ledIdle: number;
  errorFill: number;
  errorBorder: number;
  errorText: number;
}

const LIGHT: Palette = {
  bg: 0xf1f5f9,
  nodeFill: 0xffffff,
  nodeBorder: 0xcbd5e1,
  nodeText: 0x0f172a,
  entryFill: 0x1e293b,
  entryText: 0xf8fafc,
  countText: 0x334155,
  countBg: 0xe2e8f0,
  edge: 0x94a3b8,
  flash: 0x22c55e,
  ledIdle: 0xef4444,
  errorFill: 0xfee2e2,
  errorBorder: 0xef4444,
  errorText: 0x991b1b,
};

const DARK: Palette = {
  bg: 0x0b1220,
  nodeFill: 0x1e293b,
  nodeBorder: 0x334155,
  nodeText: 0xe2e8f0,
  entryFill: 0x0b1220,
  entryText: 0xf8fafc,
  countText: 0xe2e8f0,
  countBg: 0x334155,
  edge: 0x64748b,
  flash: 0x22c55e,
  ledIdle: 0xef4444,
  errorFill: 0x450a0a,
  errorBorder: 0xef4444,
  errorText: 0xfecaca,
};

function resolvePalette(mode: ColorMode): Palette {
  const dark =
    mode === 'dark' ||
    (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  return dark ? DARK : LIGHT;
}

/** Sub-millisecond precision below 10 ms, whole ms above — matches the React Flow renderer. */
function fmtMs(ms: number): string {
  return ms < 10 ? ms.toFixed(1) : Math.round(ms).toString();
}

interface NodeView {
  id: string;
  c: Container;
  rect: Graphics;
  label: Text;
  count: Text;
  led: Graphics;
  ledFlash: Graphics;
  isEntry: boolean;
  isError: boolean;
  width: number;
}

/** A laid-out node position with its computed width (nodes are sized to their content). */
interface NodePos {
  x: number;
  y: number;
  width: number;
}

interface EdgeView {
  line: Graphics;
  labelC: Container;
  labelBg: Graphics;
  labelText: Text;
  from: string;
  to: string;
}

/** Pooled visuals of one request: a head dot plus a few fading trail circles behind it. */
interface TraceView {
  head: Graphics;
  trail: Graphics[];
}

/** One request being played back: its hop queue/tween state plus its pooled visuals. */
interface RequestAnim {
  pb: Playback;
  view: TraceView;
  /** Most recent head positions, newest first — the trail circles lie on these. */
  recent: Point[];
}

export interface GLSceneOptions {
  nodeW: number;
  nodeH: number;
  /** LED flash fade-out, ms. Dot travel time is distance-scaled (see gl/constants.ts). */
  flashMs: number;
  colorMode: ColorMode;
  showFps: boolean;
  showTimings: boolean;
  /** Called with the node id when an error node is clicked (no drag). */
  onErrorSelect?: (id: string) => void;
}

/**
 * Owns the PixiJS application and the whole imperative scene (nodes, edges, flying dots).
 * React never touches Pixi directly — it just calls {@link sync}, {@link pulse} and
 * {@link setColorMode}, and the animation runs on Pixi's own ticker.
 */
export class GLScene {
  private readonly world = new Container();
  private readonly edgesLayer = new Container();
  private readonly nodesLayer = new Container();
  private readonly dotsLayer = new Container();
  private readonly labelsLayer = new Container();
  private readonly hud = new Container();
  private readonly fpsText: Text;

  private readonly nodeViews = new Map<string, NodeView>();
  private readonly edgeViews = new Map<string, EdgeView>();
  private readonly positions = new Map<string, NodePos>();
  private readonly traceViewPool: Pool<TraceView>;
  /** Live playback per request, keyed by traceId (batch pulses get synthetic unique keys). */
  private readonly anims = new Map<string, RequestAnim>();
  private batchSeq = 0;
  /** When false (Review mode) live pulses are ignored and the graph holds still. */
  private live = true;
  /** The single request being replayed in slow motion, or null. Runs independently of `anims`. */
  private replay:
    | {
        pb: Playback;
        view: TraceView;
        recent: Point[];
        hops: ReplayHop[];
        rate: number;
        loop: boolean;
        /** While > 0, resting between loop iterations until this display-clock time. */
        restUntil: number;
      }
    | null = null;
  /** Highlight shown around the dragged node while the distance constraint is pushing it. */
  private readonly dragRing = new Graphics();

  private palette: Palette;
  private fitted = false;
  private fpsFrame = 0;
  private drag:
    | { kind: 'pan' }
    | { kind: 'node'; id: string; offset: Point; moved: boolean }
    | null = null;
  private lastGlobal: Point = { x: 0, y: 0 };

  private constructor(
    private readonly app: Application,
    private readonly opts: GLSceneOptions,
  ) {
    this.palette = resolvePalette(opts.colorMode);
    // Dots sit *under* nodes, so when an edge passes behind a node the node hides the dot too.
    // Edge-timing labels sit on top of everything so they stay readable.
    this.world.addChild(this.edgesLayer, this.dotsLayer, this.nodesLayer, this.labelsLayer);
    this.labelsLayer.visible = opts.showTimings;
    this.dragRing.visible = false;
    this.nodesLayer.addChild(this.dragRing);
    this.app.stage.addChild(this.world, this.hud);

    // Dots/trails are white circles tinted at draw time, so a palette change (recolor)
    // is a tint write instead of a geometry rebuild.
    this.traceViewPool = new Pool<TraceView>(() => {
      const head = new Graphics().circle(0, 0, 4).fill({ color: 0xffffff });
      head.visible = false;
      this.dotsLayer.addChild(head);
      const trail: Graphics[] = [];
      for (let i = 0; i < TRAIL_LENGTH; i++) {
        const g = new Graphics().circle(0, 0, 3).fill({ color: 0xffffff });
        g.visible = false;
        this.dotsLayer.addChild(g);
        trail.push(g);
      }
      return { head, trail };
    });

    this.fpsText = new Text({
      text: '',
      style: { fill: this.palette.edge, fontSize: 11, fontFamily: 'ui-monospace, monospace' },
    });
    this.fpsText.position.set(8, 8);
    this.fpsText.visible = opts.showFps;
    this.hud.addChild(this.fpsText);

    this.installPanZoom();
    this.app.ticker.add(() => this.tick(this.app.ticker.deltaMS));
  }

  static async create(container: HTMLElement, opts: GLSceneOptions): Promise<GLScene> {
    const app = new Application();
    await app.init({
      background: resolvePalette(opts.colorMode).bg,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      resizeTo: container,
    });
    container.appendChild(app.canvas);
    return new GLScene(app, opts);
  }

  /** Reconcile the scene with the current graph: create/position views, refresh counters. */
  sync(nodes: TLNode[], edges: TLEdge[], positions: Map<string, NodePos>): void {
    // Adopt a position only the first time we see it — never clobber an existing one, so a
    // hand-dragged node stays put across re-syncs.
    positions.forEach((p, id) => {
      if (!this.positions.has(id)) this.positions.set(id, p);
    });

    // Separate any nodes closer than the minimum distance (e.g. a freshly laid-out node
    // landing near a hand-dragged one) with the same radial relaxation used while dragging.
    // ELK spacing is derived from NODE_MIN_DIST, so on normal layouts this is a no-op.
    const centers = new Map<string, Center>();
    const h = this.opts.nodeH;
    this.positions.forEach((p, id) => centers.set(id, { x: p.x + p.width / 2, y: p.y + h / 2 }));
    if (relaxAll(centers, NODE_MIN_DIST, SPACING_ITERATIONS)) {
      centers.forEach((c, id) => {
        const p = this.positions.get(id)!;
        p.x = c.x - p.width / 2;
        p.y = c.y - h / 2;
      });
    }

    const presentNodes = new Set<string>();
    for (const n of nodes) {
      presentNodes.add(n.id);
      const pos = this.positions.get(n.id);
      let v = this.nodeViews.get(n.id);
      if (!v) {
        v = this.createNodeView(n, pos?.width ?? this.opts.nodeW);
        this.nodeViews.set(n.id, v);
        this.nodesLayer.addChild(v.c);
      }
      v.c.visible = true;
      if (pos) v.c.position.set(pos.x, pos.y);
      // The node may have been created with the fallback width before layout computed its real
      // one (e.g. an error node appearing instantly); adopt the laid-out width when it arrives.
      if (pos && pos.width !== v.width) {
        v.width = pos.width;
        this.paintNodeRect(v.rect, v.width, v.isEntry, v.isError);
      }
      v.count.text = String(n.count);
      v.count.x = v.width - 12 - v.count.width;
    }

    const presentEdges = new Set<string>();
    for (const e of edges) {
      presentEdges.add(e.id);
      let ev = this.edgeViews.get(e.id);
      if (!ev) {
        const line = new Graphics();
        this.edgesLayer.addChild(line);

        const labelText = new Text({
          text: '',
          style: { fontSize: 10, fill: this.palette.countText, fontFamily: 'ui-monospace, monospace' },
        });
        labelText.anchor.set(0.5);
        const labelBg = new Graphics();
        const labelC = new Container();
        labelC.visible = false;
        labelC.addChild(labelBg, labelText);
        this.labelsLayer.addChild(labelC);

        ev = { line, labelC, labelBg, labelText, from: e.from, to: e.to };
        this.edgeViews.set(e.id, ev);
      }
      ev.line.visible = true;
      this.drawEdge(ev);
      this.updateEdgeLabel(ev, e);
    }

    // Hide views whose node/edge dropped out of the graph (e.g. an error node reset to 0).
    // Views are kept (cheap to reuse) and simply toggled invisible until they reappear.
    for (const [id, v] of this.nodeViews) {
      if (!presentNodes.has(id)) v.c.visible = false;
    }
    for (const [id, ev] of this.edgeViews) {
      if (!presentEdges.has(id)) {
        ev.line.visible = false;
        ev.labelC.visible = false;
      }
    }

    if (!this.fitted && this.positions.size > 0) {
      this.fit();
      this.fitted = true;
    }
  }

  /**
   * A request crossed from→to: enqueue the hop on that request's playback queue. Nothing is
   * drawn here — the ticker drains each queue one hop at a time, so a burst of events still
   * plays back sequentially. Batch pulses (traceId '-') are aggregates with no request
   * identity; each becomes its own single-hop playback so unrelated edges never serialize.
   */
  pulse(traceId: string, from: string, to: string): void {
    if (!this.live) return;
    const now = performance.now();
    if (traceId === '-') {
      const anim = this.ensureAnim(`-#${this.batchSeq++}`, now);
      anim.pb.closing = true; // one hop, then evict
      enqueue(anim.pb, { from, to }, now);
      return;
    }
    enqueue(this.ensureAnim(traceId, now).pb, { from, to }, now);
  }

  /** The backend started monitoring a request: create its playback queue up front. */
  openTrace(traceId: string): void {
    if (!this.live) return;
    this.ensureAnim(traceId, performance.now());
  }

  /**
   * The request finished. Its terminal hop into the "Return <entry>" node already arrived
   * as a regular pulse before this frame; just mark the playback closing so its queue
   * drains fully and is then deleted from memory.
   */
  closeTrace(traceId: string): void {
    if (!this.live) return;
    this.ensureAnim(traceId, performance.now()).pb.closing = true;
  }

  /**
   * Toggle live monitoring. Turning it off (Review mode) drops all in-flight live dots so the
   * graph is static; live pulses are ignored until it is turned back on. Slow-motion replay runs
   * regardless of this flag.
   */
  setLive(live: boolean): void {
    if (this.live === live) return;
    this.live = live;
    if (!live) {
      for (const [key, anim] of this.anims) this.releaseAnim(key, anim);
    }
  }

  /**
   * Start replaying a recorded request in slow motion, looping. Builds a synthetic playback from
   * the recorded hops and drives it with per-hop durations derived from the real latencies (see
   * {@link replayDuration}). Replaces any current replay.
   */
  startReplay(hops: ReplayHop[], rate: number, loop = true): void {
    this.stopReplay();
    const now = performance.now();
    const pb = createPlayback(now);
    for (const h of hops) enqueue(pb, h, now);
    this.replay = { pb, view: this.traceViewPool.acquire(), recent: [], hops, rate, loop, restUntil: 0 };
  }

  /** Stop and clear any slow-motion replay. */
  stopReplay(): void {
    if (!this.replay) return;
    this.replay.view.head.visible = false;
    for (const g of this.replay.view.trail) g.visible = false;
    this.traceViewPool.release(this.replay.view);
    this.replay = null;
  }

  /** Per-hop replay duration: a visible base plus amplified real latency (clamped), slowed by rate. */
  private readonly replayDuration = (hop: Hop, dist: number): number => {
    const ms = (hop as ReplayHop).ms;
    const latency = ms != null && ms > 0 ? ms : hopDuration(dist) / REPLAY_MS_SCALE;
    const base = Math.min(REPLAY_HOP_MAX_MS, REPLAY_HOP_BASE_MS + latency * REPLAY_MS_SCALE);
    const rate = this.replay?.rate ?? 1;
    return base / rate;
  };

  private ensureAnim(key: string, nowMs: number): RequestAnim {
    let anim = this.anims.get(key);
    if (!anim) {
      anim = { pb: createPlayback(nowMs), view: this.traceViewPool.acquire(), recent: [] };
      this.anims.set(key, anim);
    }
    return anim;
  }

  /** Hides a trace's visuals and returns them to the pool. */
  private releaseAnim(key: string, anim: RequestAnim): void {
    anim.view.head.visible = false;
    for (const g of anim.view.trail) g.visible = false;
    this.traceViewPool.release(anim.view);
    this.anims.delete(key);
  }

  /**
   * Maps a hop to its trajectory at pop time. Hops touching the dragged node defer (their
   * frozen trajectory would drift off the moving edge — they resume after the drag); hops
   * with an unknown endpoint are dropped.
   */
  private readonly resolveHop = (hop: Hop): HopGeom | null | 'defer' => {
    if (this.drag?.kind === 'node' && (hop.from === this.drag.id || hop.to === this.drag.id)) {
      return 'defer';
    }
    const a = this.positions.get(hop.from);
    const b = this.positions.get(hop.to);
    if (!a || !b) return null;
    const { start, end } = edgeEndpoints(a, b, a.width, this.opts.nodeH);
    const { c1, c2 } = bezierControls(start, end);
    return { start, c1, c2, end, dist: Math.hypot(end.x - start.x, end.y - start.y) };
  };

  /** Arrival effect: flash the LED of the node the dot just reached (entry included). */
  private readonly onHopComplete = (hop: Hop): void => {
    const v = this.nodeViews.get(hop.to);
    if (v) v.ledFlash.alpha = 1;
  };

  setShowTimings(show: boolean): void {
    this.labelsLayer.visible = show;
  }

  setColorMode(mode: ColorMode): void {
    this.palette = resolvePalette(mode);
    this.app.renderer.background.color = this.palette.bg;
    this.fpsText.style.fill = this.palette.edge;
    this.recolor();
  }

  destroy(): void {
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.app.destroy(true, { children: true, texture: true });
  }

  // ---- internals ----

  /** Draws a node's rounded-rect background for the given width + kind (used on create, resize, recolor). */
  private paintNodeRect(rect: Graphics, w: number, isEntry: boolean, isError: boolean): void {
    const fill = isError ? this.palette.errorFill : isEntry ? this.palette.entryFill : this.palette.nodeFill;
    const border = isError ? this.palette.errorBorder : this.palette.nodeBorder;
    rect.clear().roundRect(0, 0, w, this.opts.nodeH, 10).fill({ color: fill }).stroke({ width: 1, color: border });
  }

  private createNodeView(n: TLNode, w: number): NodeView {
    const { nodeH: h } = this.opts;
    const isEntry = n.kind === 'entry';
    const isError = n.kind === 'error';
    const c = new Container();

    const textColor = isError ? this.palette.errorText : isEntry ? this.palette.entryText : this.palette.nodeText;

    const rect = new Graphics();
    this.paintNodeRect(rect, w, isEntry, isError);

    const label = new Text({
      text: n.label,
      style: {
        fill: textColor,
        fontSize: 13,
        fontWeight: '600',
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
      },
    });
    label.position.set(24, h / 2 - label.height / 2);

    const count = new Text({
      text: String(n.count),
      style: { fill: this.palette.countText, fontSize: 13, fontFamily: 'ui-monospace, monospace' },
    });
    count.y = h / 2 - count.height / 2;
    count.x = w - 12 - count.width;

    // Error nodes show a solid red LED; normal nodes use the idle LED + green flash overlay.
    const led = new Graphics().circle(12, 11, 4).fill({ color: isError ? this.palette.errorBorder : this.palette.ledIdle });
    const ledFlash = new Graphics().circle(12, 11, 4).fill({ color: this.palette.flash });
    ledFlash.alpha = 0;

    c.addChild(rect, led, ledFlash, label, count);
    c.eventMode = 'static';
    c.cursor = isError ? 'pointer' : 'grab';
    c.on('pointerdown', (e: FederatedPointerEvent) => this.startNodeDrag(e, n.id));
    return { id: n.id, c, rect, label, count, led, ledFlash, isEntry, isError, width: w };
  }

  private recolor(): void {
    for (const v of this.nodeViews.values()) {
      const textColor = v.isError ? this.palette.errorText : v.isEntry ? this.palette.entryText : this.palette.nodeText;
      this.paintNodeRect(v.rect, v.width, v.isEntry, v.isError);
      v.label.style.fill = textColor;
      v.count.style.fill = this.palette.countText;
      v.led.clear().circle(12, 11, 4).fill({ color: v.isError ? this.palette.errorBorder : this.palette.ledIdle });
      v.ledFlash.clear().circle(12, 11, 4).fill({ color: this.palette.flash });
    }
    for (const ev of this.edgeViews.values()) {
      this.drawEdge(ev);
      if (ev.labelC.visible) this.styleEdgeLabel(ev);
    }
  }

  private drawEdge(ev: EdgeView): void {
    const a = this.positions.get(ev.from);
    const b = this.positions.get(ev.to);
    if (!a || !b) return;
    const { start, end } = edgeEndpoints(a, b, a.width, this.opts.nodeH);
    const { c1, c2 } = bezierControls(start, end);
    // Direction into the target = the curve's tangent at t=1 (end − c2); horizontal in the
    // left→right layout, but derived so it stays correct if a node is dragged.
    const head = arrowhead(end, { x: end.x - c2.x, y: end.y - c2.y }, ARROW_SIZE);
    ev.line.clear()
      // Stroke ends at the arrowhead's base so the line sits under the head, not through its tip.
      .moveTo(start.x, start.y)
      .bezierCurveTo(c1.x, c1.y, c2.x, c2.y, head.base.x, head.base.y)
      .stroke({ width: 1.5, color: this.palette.edge })
      .poly([end.x, end.y, head.left.x, head.left.y, head.right.x, head.right.y])
      .fill({ color: this.palette.edge });
    const mid = cubicBezier(start, c1, c2, end, 0.5);
    ev.labelC.position.set(mid.x, mid.y);
  }

  /** Sets the edge's timing label (min/avg/max ms), hiding it until the edge has samples. */
  private updateEdgeLabel(ev: EdgeView, e: TLEdge): void {
    if (e.samples == null || e.samples <= 0 || e.min == null || e.avg == null || e.max == null) {
      ev.labelC.visible = false;
      return;
    }
    ev.labelText.text = `${fmtMs(e.min)} / ${fmtMs(e.avg)} / ${fmtMs(e.max)} ms`;
    this.styleEdgeLabel(ev);
    ev.labelC.visible = true;
  }

  private styleEdgeLabel(ev: EdgeView): void {
    ev.labelText.style.fill = this.palette.countText;
    const w = ev.labelText.width;
    const h = ev.labelText.height;
    ev.labelBg.clear().roundRect(-w / 2 - 4, -h / 2 - 1, w + 8, h + 2, 4).fill({ color: this.palette.countBg, alpha: 0.9 });
  }

  /** Draw a request's head dot at `point` plus its fading motion trail. */
  private paintDot(view: TraceView, recent: Point[], point: Point): void {
    const tint = this.palette.flash;
    view.head.tint = tint;
    view.head.visible = true;
    view.head.position.set(point.x, point.y);

    // Motion trail: the last few head positions with fading alpha — this is what keeps the
    // fastest hops readable as movement instead of flicker.
    recent.unshift(point);
    if (recent.length > TRAIL_LENGTH + 1) recent.length = TRAIL_LENGTH + 1;
    for (let i = 0; i < TRAIL_LENGTH; i++) {
      const g = view.trail[i];
      const p = recent[i + 1];
      if (!p) {
        g.visible = false;
        continue;
      }
      g.tint = tint;
      g.alpha = TRAIL_ALPHA_BASE * (1 - i / TRAIL_LENGTH);
      g.visible = true;
      g.position.set(p.x, p.y);
    }
  }

  /** Hide a request's dot + trail and drop its trail history (so it won't smear on resume). */
  private hideDot(view: TraceView, recent: Point[]): void {
    view.head.visible = false;
    for (const g of view.trail) g.visible = false;
    recent.length = 0;
  }

  private tick(dtMs: number): void {
    const now = performance.now();

    for (const [key, anim] of this.anims) {
      const res = advance(anim.pb, dtMs, this.resolveHop, now, this.onHopComplete);
      if (shouldEvict(anim.pb, now, TRACE_TTL_MS)) {
        this.releaseAnim(key, anim);
        continue;
      }
      if (!res) this.hideDot(anim.view, anim.recent);
      else this.paintDot(anim.view, anim.recent, res.point);
    }

    this.tickReplay(dtMs, now);

    const fade = dtMs / this.opts.flashMs;
    for (const v of this.nodeViews.values()) {
      if (v.ledFlash.alpha > 0) v.ledFlash.alpha = Math.max(0, v.ledFlash.alpha - fade);
    }

    if (this.opts.showFps && ++this.fpsFrame % 15 === 0) {
      this.fpsText.text = `${Math.round(this.app.ticker.FPS)} fps · ${this.anims.size} traces`;
    }
  }

  /** Advance the slow-motion replay (if any): draw the crawling dot; loop with a short rest. */
  private tickReplay(dtMs: number, now: number): void {
    const r = this.replay;
    if (!r) return;
    if (r.restUntil > 0) {
      this.hideDot(r.view, r.recent);
      if (now >= r.restUntil) {
        r.restUntil = 0;
        for (const h of r.hops) enqueue(r.pb, h, now);
      }
      return;
    }
    const res = advance(r.pb, dtMs, this.resolveHop, now, this.onHopComplete, this.replayDuration);
    if (res) this.paintDot(r.view, r.recent, res.point);
    else this.hideDot(r.view, r.recent);
    if (isDone(r.pb)) {
      if (r.loop) r.restUntil = now + REPLAY_LOOP_GAP_MS;
      else this.stopReplay();
    }
  }

  private fit(): void {
    const b = contentBounds(this.positions.values(), this.opts.nodeH);
    if (!b) return;
    const { scale, x, y } = fitTransform(b, this.app.screen.width, this.app.screen.height);
    this.world.scale.set(scale);
    this.world.position.set(x, y);
  }

  /** Re-fit the whole graph into view (the controls' "fit" button). */
  fitView(): void {
    this.fit();
  }

  /** Zoom by a factor around the canvas centre (the controls' +/− buttons). */
  zoomBy(factor: number): void {
    const cx = this.app.screen.width / 2;
    const cy = this.app.screen.height / 2;
    const wx = (cx - this.world.x) / this.world.scale.x;
    const wy = (cy - this.world.y) / this.world.scale.y;
    const ns = Math.min(4, Math.max(0.2, this.world.scale.x * factor));
    this.world.scale.set(ns);
    this.world.position.set(cx - wx * ns, cy - wy * ns);
  }

  private installPanZoom(): void {
    // Wheel-zoom stays on the DOM canvas; pan + node-drag go through Pixi's event system so a
    // node grab (which stops propagation) cleanly suppresses the background pan.
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    const stage = this.app.stage;
    stage.eventMode = 'static';
    stage.hitArea = this.app.screen;
    stage.on('pointerdown', this.onStageDown);
    stage.on('globalpointermove', this.onGlobalMove);
    stage.on('pointerup', this.onDragEnd);
    stage.on('pointerupoutside', this.onDragEnd);
  }

  private toWorld(global: Point): Point {
    return {
      x: (global.x - this.world.x) / this.world.scale.x,
      y: (global.y - this.world.y) / this.world.scale.y,
    };
  }

  private startNodeDrag(e: FederatedPointerEvent, id: string): void {
    e.stopPropagation(); // don't also start a background pan
    const pos = this.positions.get(id);
    if (!pos) return;
    const wp = this.toWorld(e.global);
    this.drag = { kind: 'node', id, offset: { x: wp.x - pos.x, y: wp.y - pos.y }, moved: false };
    this.cancelHopsForNode(id); // an in-flight hop's frozen trajectory would drift off the line
  }

  /**
   * Drops the active hop of any playback currently riding an edge of this node (queued hops
   * stay put — the resolver defers them until the drag ends).
   */
  private cancelHopsForNode(id: string): void {
    for (const anim of this.anims.values()) {
      const active = anim.pb.active;
      if (active && (active.hop.from === id || active.hop.to === id)) {
        anim.pb.active = null;
        anim.view.head.visible = false;
        for (const g of anim.view.trail) g.visible = false;
        anim.recent.length = 0;
      }
    }
  }

  private readonly onStageDown = (e: FederatedPointerEvent): void => {
    this.drag = { kind: 'pan' };
    this.lastGlobal = { x: e.global.x, y: e.global.y };
  };

  private readonly onGlobalMove = (e: FederatedPointerEvent): void => {
    if (!this.drag) return;
    if (this.drag.kind === 'pan') {
      this.world.x += e.global.x - this.lastGlobal.x;
      this.world.y += e.global.y - this.lastGlobal.y;
      this.lastGlobal = { x: e.global.x, y: e.global.y };
      return;
    }
    this.drag.moved = true;
    const wp = this.toWorld(e.global);
    const view = this.nodeViews.get(this.drag.id);
    if (!view) return;
    const pos = { x: wp.x - this.drag.offset.x, y: wp.y - this.drag.offset.y, width: view.width };

    // Minimum-distance constraint: the node follows the cursor but is projected out of every
    // neighbor's forbidden radius, so it slides along the boundary instead of overlapping.
    const centers = this.visibleCenters();
    const h = this.opts.nodeH;
    centers.set(this.drag.id, { x: pos.x + pos.width / 2, y: pos.y + h / 2 });
    const pushed = pushOutOne(centers, this.drag.id, NODE_MIN_DIST, SPACING_ITERATIONS);
    const c = centers.get(this.drag.id)!;
    pos.x = c.x - pos.width / 2;
    pos.y = c.y - h / 2;

    this.positions.set(this.drag.id, pos);
    view.c.position.set(pos.x, pos.y);
    this.updateDragRing(pos, pushed);
    for (const ev of this.edgeViews.values()) {
      if (ev.from === this.drag.id || ev.to === this.drag.id) this.drawEdge(ev);
    }
  };

  /** Centers of all currently visible nodes (hidden error nodes must not repel the drag). */
  private visibleCenters(): Map<string, Center> {
    const centers = new Map<string, Center>();
    const h = this.opts.nodeH;
    this.positions.forEach((p, id) => {
      if (this.nodeViews.get(id)?.c.visible) {
        centers.set(id, { x: p.x + p.width / 2, y: p.y + h / 2 });
      }
    });
    return centers;
  }

  /** Subtle ring around the dragged node while the constraint is actively pushing it. */
  private updateDragRing(pos: NodePos, active: boolean): void {
    if (!active) {
      this.dragRing.visible = false;
      return;
    }
    this.dragRing
      .clear()
      .roundRect(pos.x - 4, pos.y - 4, pos.width + 8, this.opts.nodeH + 8, 14)
      .stroke({ width: 2, color: this.palette.flash, alpha: 0.7 });
    this.dragRing.visible = true;
  }

  private readonly onDragEnd = (): void => {
    this.dragRing.visible = false;
    // A press-release with no movement on an error node is a click → open its stacktrace.
    if (this.drag?.kind === 'node' && !this.drag.moved) {
      const view = this.nodeViews.get(this.drag.id);
      if (view?.isError) this.opts.onErrorSelect?.(this.drag.id);
    }
    this.drag = null;
  };

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.app.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const wx = (px - this.world.x) / this.world.scale.x;
    const wy = (py - this.world.y) / this.world.scale.y;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const ns = Math.min(4, Math.max(0.2, this.world.scale.x * factor));
    this.world.scale.set(ns);
    this.world.position.set(px - wx * ns, py - wy * ns);
  };
}
