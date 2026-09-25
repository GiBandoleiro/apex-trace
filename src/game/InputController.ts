/**
 * Unified pointer input.
 *
 * Touch first: one finger draws, two fingers pan and pinch-zoom. On desktop
 * the left button draws, the right button (or middle, or space-drag) pans and
 * the wheel zooms. Keyboard shortcuts are handled here too so the game screen
 * stays free of listener wiring.
 */

export interface StrokePoint {
  /** Normalised device coordinates, -1..1. */
  ndcX: number;
  ndcY: number;
  /** CSS pixels relative to the canvas. */
  px: number;
  py: number;
  /** Seconds since the stroke started. */
  t: number;
}

export interface InputHandlers {
  onStrokeStart?: (p: StrokePoint) => void;
  onStrokeMove?: (p: StrokePoint) => void;
  onStrokeEnd?: (p: StrokePoint) => void;
  onPan?: (dxPixels: number, dyPixels: number) => void;
  onZoom?: (factor: number) => void;
  onKey?: (key: string) => void;
  /** Called on the first real interaction, to unlock audio. */
  onFirstGesture?: () => void;
}

type PointerRecord = { id: number; x: number; y: number };

export class InputController {
  private readonly el: HTMLElement;
  private handlers: InputHandlers;
  private pointers = new Map<number, PointerRecord>();
  private drawingId: number | null = null;
  private panningId: number | null = null;
  private strokeStart = 0;
  private pinchDistance = 0;
  private pinchCenter = { x: 0, y: 0 };
  private spaceHeld = false;
  private gestureSeen = false;
  private enabled = true;

  /** When false, single-pointer drags pan instead of drawing. */
  drawMode = true;

  constructor(el: HTMLElement, handlers: InputHandlers) {
    this.el = el;
    this.handlers = handlers;

    el.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    el.addEventListener('pointermove', this.onPointerMove, { passive: false });
    el.addEventListener('pointerup', this.onPointerUp, { passive: false });
    el.addEventListener('pointercancel', this.onPointerUp, { passive: false });
    el.addEventListener('pointerleave', this.onPointerUp, { passive: false });
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
  }

  setHandlers(handlers: InputHandlers): void {
    this.handlers = handlers;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pointers.clear();
      this.drawingId = null;
      this.panningId = null;
    }
  }

  private toStrokePoint(x: number, y: number): StrokePoint {
    const rect = this.el.getBoundingClientRect();
    const px = x - rect.left;
    const py = y - rect.top;
    return {
      px,
      py,
      ndcX: (px / rect.width) * 2 - 1,
      ndcY: -(py / rect.height) * 2 + 1,
      t: (performance.now() - this.strokeStart) / 1000,
    };
  }

  private firstGesture(): void {
    if (this.gestureSeen) return;
    this.gestureSeen = true;
    this.handlers.onFirstGesture?.();
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) return;
    this.firstGesture();
    this.el.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });

    const isPanButton = e.button === 1 || e.button === 2 || this.spaceHeld || !this.drawMode;

    if (this.pointers.size === 2) {
      // Second finger: abandon any stroke and switch to pan/zoom.
      if (this.drawingId !== null) {
        this.handlers.onStrokeEnd?.(this.toStrokePoint(e.clientX, e.clientY));
        this.drawingId = null;
      }
      const pts = [...this.pointers.values()];
      this.pinchDistance = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      this.pinchCenter = {
        x: (pts[0].x + pts[1].x) / 2,
        y: (pts[0].y + pts[1].y) / 2,
      };
      this.panningId = null;
      e.preventDefault();
      return;
    }

    if (isPanButton) {
      this.panningId = e.pointerId;
    } else if (this.pointers.size === 1) {
      this.drawingId = e.pointerId;
      this.strokeStart = performance.now();
      this.handlers.onStrokeStart?.(this.toStrokePoint(e.clientX, e.clientY));
    }
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) return;
    const rec = this.pointers.get(e.pointerId);
    if (!rec) return;
    const prevX = rec.x;
    const prevY = rec.y;
    rec.x = e.clientX;
    rec.y = e.clientY;

    if (this.pointers.size >= 2) {
      const pts = [...this.pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const center = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      if (this.pinchDistance > 0 && dist > 0) {
        const factor = this.pinchDistance / dist;
        if (Math.abs(1 - factor) > 0.002) this.handlers.onZoom?.(factor);
      }
      this.handlers.onPan?.(center.x - this.pinchCenter.x, center.y - this.pinchCenter.y);
      this.pinchDistance = dist;
      this.pinchCenter = center;
      e.preventDefault();
      return;
    }

    if (e.pointerId === this.panningId) {
      this.handlers.onPan?.(e.clientX - prevX, e.clientY - prevY);
      e.preventDefault();
      return;
    }

    if (e.pointerId === this.drawingId) {
      this.handlers.onStrokeMove?.(this.toStrokePoint(e.clientX, e.clientY));
      e.preventDefault();
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    this.el.releasePointerCapture?.(e.pointerId);

    if (e.pointerId === this.drawingId) {
      this.handlers.onStrokeEnd?.(this.toStrokePoint(e.clientX, e.clientY));
      this.drawingId = null;
    }
    if (e.pointerId === this.panningId) this.panningId = null;
    if (this.pointers.size < 2) this.pinchDistance = 0;
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) return;
    this.firstGesture();
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.0016);
    this.handlers.onZoom?.(factor);
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    if (e.code === 'Space') this.spaceHeld = true;
    this.handlers.onKey?.(e.code);
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.code === 'Space') this.spaceHeld = false;
  };

  dispose(): void {
    const el = this.el;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('pointermove', this.onPointerMove);
    el.removeEventListener('pointerup', this.onPointerUp);
    el.removeEventListener('pointercancel', this.onPointerUp);
    el.removeEventListener('pointerleave', this.onPointerUp);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.onContextMenu);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.pointers.clear();
  }
}
