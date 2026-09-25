/**
 * 2D top-view car thumbnails for the garage cards.
 *
 * Drawn from the same `CarDesign` the 3D builder uses, so a card silhouette
 * genuinely matches the car you get on track - proportions, wheel positions,
 * wing and livery all come from the shared descriptor.
 */

import type { CarCustomization, CarDefinition } from './types';

const cache = new Map<string, string>();

const roundedBody = (
  ctx: CanvasRenderingContext2D,
  def: CarDefinition,
  scale: number,
  cx: number,
  cy: number,
): void => {
  const d = def.design;
  const halfL = (d.length * scale) / 2;
  const halfW = (d.width * (1 + d.flare * 0.5) * scale) / 2;

  ctx.beginPath();
  // Nose
  ctx.moveTo(cx - halfL, cy - halfW * d.noseTaper);
  ctx.quadraticCurveTo(cx - halfL * 1.06, cy, cx - halfL, cy + halfW * d.noseTaper);
  // Left flank to the tail
  ctx.lineTo(cx - halfL * 0.5, cy + halfW);
  ctx.lineTo(cx + halfL * 0.55, cy + halfW);
  ctx.lineTo(cx + halfL, cy + halfW * d.tailTaper);
  // Tail
  ctx.quadraticCurveTo(cx + halfL * 1.04, cy, cx + halfL, cy - halfW * d.tailTaper);
  // Right flank back to the nose
  ctx.lineTo(cx + halfL * 0.55, cy - halfW);
  ctx.lineTo(cx - halfL * 0.5, cy - halfW);
  ctx.closePath();
};

export const carThumbnail = (
  def: CarDefinition,
  custom: CarCustomization,
  width = 320,
  height = 180,
): string => {
  const key = `${def.id}:${custom.primary}:${custom.secondary}:${custom.decal}:${custom.raceNumber}:${custom.spoiler}:${width}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);

  const d = def.design;
  const scale = Math.min((width * 0.82) / d.length, (height * 0.74) / d.width);
  const cx = width / 2;
  const cy = height / 2;

  // Soft ground shadow.
  ctx.save();
  ctx.filter = 'blur(10px)';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundedBody(ctx, def, scale * 1.04, cx, cy + 5);
  ctx.fill();
  ctx.restore();

  // Wheels first so the body overlaps them.
  const wheelR = d.wheelRadius * scale;
  const wheelW = d.wheelWidth * scale;
  const trackHalf = (d.width * 0.5 - d.wheelWidth * 0.42) * scale;
  ctx.fillStyle = '#101216';
  for (const axle of [-d.frontAxle, -d.rearAxle]) {
    for (const side of [-1, 1]) {
      const x = cx + axle * scale;
      const y = cy + side * trackHalf;
      ctx.beginPath();
      ctx.roundRect(x - wheelR, y - wheelW / 2, wheelR * 2, wheelW, 3);
      ctx.fill();
      ctx.fillStyle = custom.wheelColor;
      ctx.beginPath();
      ctx.roundRect(x - wheelR * 0.55, y - wheelW * 0.32, wheelR * 1.1, wheelW * 0.64, 2);
      ctx.fill();
      ctx.fillStyle = '#101216';
    }
  }

  // Rear wing.
  if (d.wing > 0 || custom.spoiler) {
    ctx.fillStyle = '#1a1d24';
    const wingW = d.wingWidth * scale;
    ctx.beginPath();
    ctx.roundRect(cx + d.length * 0.44 * scale, cy - wingW / 2, scale * 0.34, wingW, 3);
    ctx.fill();
  }

  // Body.
  const grad = ctx.createLinearGradient(cx, cy - d.width * scale * 0.5, cx, cy + d.width * scale * 0.5);
  grad.addColorStop(0, custom.primary);
  grad.addColorStop(0.45, shade(custom.primary, 1.18));
  grad.addColorStop(1, shade(custom.primary, 0.72));
  ctx.fillStyle = grad;
  roundedBody(ctx, def, scale, cx, cy);
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.42)';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // Livery.
  ctx.save();
  roundedBody(ctx, def, scale, cx, cy);
  ctx.clip();
  ctx.fillStyle = custom.secondary;
  switch (d.stripe) {
    case 'center':
      ctx.fillRect(cx - width, cy - scale * 0.16, width * 2, scale * 0.32);
      break;
    case 'dual':
      ctx.fillRect(cx - width, cy - scale * 0.32, width * 2, scale * 0.16);
      ctx.fillRect(cx - width, cy + scale * 0.16, width * 2, scale * 0.16);
      break;
    case 'wedge':
      ctx.beginPath();
      ctx.moveTo(cx - width, cy - height);
      ctx.lineTo(cx + scale * 0.4, cy - height);
      ctx.lineTo(cx - scale * 0.9, cy + height);
      ctx.lineTo(cx - width, cy + height);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      break;
  }
  ctx.restore();

  // Greenhouse.
  const cabZ = (d.cabinCenter - 0.5) * d.length * scale;
  ctx.fillStyle = 'rgba(16,22,32,0.88)';
  ctx.beginPath();
  ctx.roundRect(
    cx + cabZ - (d.cabinLength * scale) / 2,
    cy - (d.cabinWidth * scale) / 2,
    d.cabinLength * scale,
    d.cabinWidth * scale,
    scale * 0.22,
  );
  ctx.fill();
  // Roof panel.
  ctx.fillStyle = shade(custom.primary, 1.05);
  ctx.beginPath();
  ctx.roundRect(
    cx + cabZ - (d.cabinLength * scale) * 0.2,
    cy - (d.cabinWidth * scale) * 0.4,
    d.cabinLength * scale * 0.42,
    d.cabinWidth * scale * 0.8,
    scale * 0.12,
  );
  ctx.fill();

  // Race number on the roof.
  ctx.fillStyle = '#f2f5fa';
  ctx.beginPath();
  ctx.arc(cx + cabZ + scale * 0.05, cy, scale * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#12151c';
  ctx.font = `bold ${Math.round(scale * 0.42)}px "Barlow Condensed", Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(custom.raceNumber), cx + cabZ + scale * 0.05, cy + scale * 0.02);

  // Lights.
  ctx.fillStyle = 'rgba(226,238,255,0.92)';
  for (const side of [-1, 1]) {
    ctx.fillRect(
      cx - d.length * 0.47 * scale,
      cy + side * d.width * 0.28 * scale - scale * 0.07,
      scale * 0.22,
      scale * 0.14,
    );
  }
  ctx.fillStyle = 'rgba(255,60,44,0.9)';
  for (const side of [-1, 1]) {
    ctx.fillRect(
      cx + d.length * 0.44 * scale,
      cy + side * d.width * 0.28 * scale - scale * 0.06,
      scale * 0.16,
      scale * 0.12,
    );
  }

  const url = canvas.toDataURL();
  cache.set(key, url);
  return url;
};

const shade = (hex: string, factor: number): string => {
  const m = hex.replace('#', '');
  const full = m.length === 3 ? m.split('').map((c) => c + c).join('') : m;
  const r = Math.min(255, Math.round(parseInt(full.slice(0, 2), 16) * factor));
  const g = Math.min(255, Math.round(parseInt(full.slice(2, 4), 16) * factor));
  const b = Math.min(255, Math.round(parseInt(full.slice(4, 6), 16) * factor));
  return `rgb(${r}, ${g}, ${b})`;
};
