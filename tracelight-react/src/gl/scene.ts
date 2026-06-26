import { Application, Container, type FederatedPointerEvent, Graphics, Text } from 'pixi.js';
import {
  Pool,
  bezierControls,
  contentBounds,
  cubicBezier,
  edgeEndpoints,
  fitTransform,
  type Point,
} from './geometry';
import type { TLEdge, TLNode } from '../types';

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
  c: Container;
  rect: Graphics;
  label: Text;
  count: Text;
  led: Graphics;
  ledFlash: Graphics;
  isEntry: boolean;
}

interface EdgeView {
  line: Graphics;
  labelC: Container;
  labelBg: Graphics;
  labelText: Text;
  from: string;
  to: string;
}

interface Dot {
  gfx: Graphics;
  from: string;
  to: string;
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
  t: number;
  dur: number;
}

export interface GLSceneOptions {
  nodeW: number;
  nodeH: number;
  flashMs: number;
  colorMode: ColorMode;
  showFps: boolean;
  showTimings: boolean;
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
  private readonly positions = new Map<string, Point>();
  private readonly dotPool: Pool<Dot>;

  private palette: Palette;
  private fitted = false;
  private fpsFrame = 0;
  private drag: { kind: 'pan' } | { kind: 'node'; id: string; offset: Point } | null = null;
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
    this.app.stage.addChild(this.world, this.hud);

    this.dotPool = new Pool<Dot>(() => {
      const gfx = new Graphics().circle(0, 0, 4).fill({ color: this.palette.flash });
      gfx.visible = false;
      this.dotsLayer.addChild(gfx);
      return {
        gfx,
        from: '',
        to: '',
        start: { x: 0, y: 0 },
        c1: { x: 0, y: 0 },
        c2: { x: 0, y: 0 },
        end: { x: 0, y: 0 },
        t: 0,
        dur: opts.flashMs,
      };
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
  sync(nodes: TLNode[], edges: TLEdge[], positions: Map<string, Point>): void {
    const { nodeW: w, nodeH: h } = this.opts;
    // Adopt a position only the first time we see it — never clobber an existing one, so a
    // hand-dragged node stays put across re-syncs.
    positions.forEach((p, id) => {
      if (!this.positions.has(id)) this.positions.set(id, p);
    });

    for (const n of nodes) {
      let v = this.nodeViews.get(n.id);
      if (!v) {
        v = this.createNodeView(n);
        this.nodeViews.set(n.id, v);
        this.nodesLayer.addChild(v.c);
      }
      const pos = this.positions.get(n.id);
      if (pos) v.c.position.set(pos.x, pos.y);
      v.count.text = String(n.count);
      v.count.x = w - 12 - v.count.width;
    }

    for (const e of edges) {
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
      this.drawEdge(ev);
      this.updateEdgeLabel(ev, e);
    }

    if (!this.fitted && this.positions.size > 0) {
      this.fit();
      this.fitted = true;
    }
  }

  /** A request crossed from→to: flash the edge + target LED and launch a dot along the hop. */
  pulse(from: string, to: string): void {
    const a = this.positions.get(from);
    const b = this.positions.get(to);
    if (!a || !b) return;
    const target = this.nodeViews.get(to);
    if (target) target.ledFlash.alpha = 1;

    // While a node is dragged its edges move every frame; a dot keeps its pre-computed
    // trajectory and would drift off the line, so don't launch dots on the dragged node's edges.
    if (this.drag?.kind === 'node' && (this.drag.id === from || this.drag.id === to)) return;

    const { start, end } = edgeEndpoints(a, b, this.opts.nodeW, this.opts.nodeH);
    const { c1, c2 } = bezierControls(start, end);
    const dot = this.dotPool.acquire();
    dot.from = from;
    dot.to = to;
    dot.start = start;
    dot.c1 = c1;
    dot.c2 = c2;
    dot.end = end;
    dot.t = 0;
    dot.dur = this.opts.flashMs;
    dot.gfx.visible = true;
    dot.gfx.position.set(start.x, start.y);
  }

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

  private createNodeView(n: TLNode): NodeView {
    const { nodeW: w, nodeH: h } = this.opts;
    const isEntry = n.kind === 'entry';
    const c = new Container();

    const rect = new Graphics()
      .roundRect(0, 0, w, h, 10)
      .fill({ color: isEntry ? this.palette.entryFill : this.palette.nodeFill })
      .stroke({ width: 1, color: this.palette.nodeBorder });

    const label = new Text({
      text: n.label,
      style: {
        fill: isEntry ? this.palette.entryText : this.palette.nodeText,
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

    const led = new Graphics().circle(12, 11, 4).fill({ color: this.palette.ledIdle });
    const ledFlash = new Graphics().circle(12, 11, 4).fill({ color: this.palette.flash });
    ledFlash.alpha = 0;

    c.addChild(rect, led, ledFlash, label, count);
    c.eventMode = 'static';
    c.cursor = 'grab';
    c.on('pointerdown', (e: FederatedPointerEvent) => this.startNodeDrag(e, n.id));
    return { c, rect, label, count, led, ledFlash, isEntry };
  }

  private recolor(): void {
    const { nodeW: w, nodeH: h } = this.opts;
    for (const v of this.nodeViews.values()) {
      v.rect.clear().roundRect(0, 0, w, h, 10)
        .fill({ color: v.isEntry ? this.palette.entryFill : this.palette.nodeFill })
        .stroke({ width: 1, color: this.palette.nodeBorder });
      v.label.style.fill = v.isEntry ? this.palette.entryText : this.palette.nodeText;
      v.count.style.fill = this.palette.countText;
      v.led.clear().circle(12, 11, 4).fill({ color: this.palette.ledIdle });
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
    const { start, end } = edgeEndpoints(a, b, this.opts.nodeW, this.opts.nodeH);
    const { c1, c2 } = bezierControls(start, end);
    ev.line.clear()
      .moveTo(start.x, start.y)
      .bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y)
      .stroke({ width: 1.5, color: this.palette.edge });
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

  private tick(dtMs: number): void {
    this.dotPool.forEachActive((d) => {
      d.t += dtMs / d.dur;
      if (d.t >= 1) {
        d.gfx.visible = false;
        this.dotPool.release(d);
      } else {
        const p = cubicBezier(d.start, d.c1, d.c2, d.end, d.t);
        d.gfx.position.set(p.x, p.y);
      }
    });

    const fade = dtMs / this.opts.flashMs;
    for (const v of this.nodeViews.values()) {
      if (v.ledFlash.alpha > 0) v.ledFlash.alpha = Math.max(0, v.ledFlash.alpha - fade);
    }

    if (this.opts.showFps && ++this.fpsFrame % 15 === 0) {
      this.fpsText.text = `${Math.round(this.app.ticker.FPS)} fps · ${this.dotPool.activeCount} dots`;
    }
  }

  private fit(): void {
    const b = contentBounds(this.positions.values(), this.opts.nodeW, this.opts.nodeH);
    if (!b) return;
    const { scale, x, y } = fitTransform(b, this.app.screen.width, this.app.screen.height);
    this.world.scale.set(scale);
    this.world.position.set(x, y);
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
    this.drag = { kind: 'node', id, offset: { x: wp.x - pos.x, y: wp.y - pos.y } };
    this.removeDotsForNode(id); // in-flight dots on this node's edges would drift off the line
  }

  private removeDotsForNode(id: string): void {
    const stale: Dot[] = [];
    this.dotPool.forEachActive((d) => {
      if (d.from === id || d.to === id) stale.push(d);
    });
    for (const d of stale) {
      d.gfx.visible = false;
      this.dotPool.release(d);
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
    const wp = this.toWorld(e.global);
    const view = this.nodeViews.get(this.drag.id);
    if (!view) return;
    const pos = { x: wp.x - this.drag.offset.x, y: wp.y - this.drag.offset.y };
    this.positions.set(this.drag.id, pos);
    view.c.position.set(pos.x, pos.y);
    for (const ev of this.edgeViews.values()) {
      if (ev.from === this.drag.id || ev.to === this.drag.id) this.drawEdge(ev);
    }
  };

  private readonly onDragEnd = (): void => {
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
