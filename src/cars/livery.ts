/**
 * Livery painting.
 *
 * The car body is UV-mapped with a planar projection from directly above,
 * which is exactly the angle the player sees it from. That lets us paint the
 * whole car - base colour, stripes, decals and the race number - onto a single
 * top-view canvas and get crisp, readable results in the 2.5D camera.
 */

import * as THREE from 'three';
import type { CarCustomization, CarDesign, DecalId } from './types';

const TEX_W = 512;
const TEX_H = 256;

const withAlpha = (hex: string, alpha: number): string => {
  const c = new THREE.Color(hex);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
};

const drawStripes = (
  ctx: CanvasRenderingContext2D,
  design: CarDesign,
  custom: CarCustomization,
): void => {
  const cx = TEX_H / 2;
  ctx.fillStyle = custom.secondary;
  switch (design.stripe) {
    case 'center':
      ctx.fillRect(0, cx - 22, TEX_W, 44);
      ctx.fillStyle = withAlpha(custom.primary, 1);
      ctx.fillRect(0, cx - 7, TEX_W, 14);
      break;
    case 'dual':
      ctx.fillRect(0, cx - 40, TEX_W, 24);
      ctx.fillRect(0, cx + 16, TEX_W, 24);
      break;
    case 'wedge': {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(TEX_W * 0.62, 0);
      ctx.lineTo(TEX_W * 0.34, TEX_H);
      ctx.lineTo(0, TEX_H);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
};

const drawDecal = (ctx: CanvasRenderingContext2D, decal: DecalId, custom: CarCustomization): void => {
  ctx.save();
  switch (decal) {
    case 'stripes': {
      ctx.fillStyle = withAlpha(custom.secondary, 0.85);
      for (let i = 0; i < 4; i++) {
        ctx.fillRect(TEX_W * 0.06 + i * 16, TEX_H * 0.08, 7, TEX_H * 0.84);
      }
      break;
    }
    case 'arrow': {
      ctx.fillStyle = withAlpha(custom.secondary, 0.9);
      ctx.beginPath();
      ctx.moveTo(TEX_W * 0.1, TEX_H * 0.5);
      ctx.lineTo(TEX_W * 0.32, TEX_H * 0.14);
      ctx.lineTo(TEX_W * 0.4, TEX_H * 0.28);
      ctx.lineTo(TEX_W * 0.24, TEX_H * 0.5);
      ctx.lineTo(TEX_W * 0.4, TEX_H * 0.72);
      ctx.lineTo(TEX_W * 0.32, TEX_H * 0.86);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'blocks': {
      ctx.fillStyle = withAlpha(custom.secondary, 0.92);
      const cols = 10;
      const rows = 4;
      for (let x = 0; x < cols; x++) {
        for (let y = 0; y < rows; y++) {
          if ((x + y) % 2 !== 0) continue;
          const size = 14 - Math.abs(y - rows / 2) * 2;
          ctx.fillRect(
            TEX_W * 0.52 + x * 17,
            TEX_H * 0.16 + y * 42,
            size,
            size,
          );
        }
      }
      break;
    }
    case 'flames': {
      ctx.fillStyle = withAlpha(custom.secondary, 0.85);
      for (let i = 0; i < 5; i++) {
        const y = TEX_H * (0.16 + i * 0.17);
        ctx.beginPath();
        ctx.moveTo(TEX_W * 0.08, y);
        ctx.quadraticCurveTo(TEX_W * 0.26, y - 16, TEX_W * 0.44, y - 3);
        ctx.quadraticCurveTo(TEX_W * 0.28, y + 6, TEX_W * 0.08, y + 9);
        ctx.closePath();
        ctx.fill();
      }
      break;
    }
    case 'carbon': {
      // Fine weave over the bonnet and engine cover.
      ctx.globalAlpha = 0.5;
      for (let x = 0; x < TEX_W; x += 6) {
        for (let y = 0; y < TEX_H; y += 6) {
          const dark = ((x / 6 + y / 6) % 2) === 0;
          ctx.fillStyle = dark ? 'rgba(12,14,18,0.8)' : 'rgba(40,44,52,0.7)';
          if (x < TEX_W * 0.34 || x > TEX_W * 0.7) ctx.fillRect(x, y, 5, 5);
        }
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'halftone': {
      ctx.fillStyle = withAlpha(custom.secondary, 0.8);
      for (let x = 0; x < 22; x++) {
        for (let y = 0; y < 11; y++) {
          const t = x / 22;
          const r = Math.max(0, 5.5 - t * 5.5);
          if (r <= 0.3) continue;
          ctx.beginPath();
          ctx.arc(TEX_W * 0.02 + x * 22, 12 + y * 23, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
};

const drawRaceNumber = (ctx: CanvasRenderingContext2D, custom: CarCustomization): void => {
  const text = String(Math.max(1, Math.min(99, Math.round(custom.raceNumber))));
  // Roof roundel.
  const rx = TEX_W * 0.5;
  const ry = TEX_H * 0.5;
  ctx.save();
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = '#f4f6fa';
  ctx.beginPath();
  ctx.arc(rx, ry, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#12151c';
  ctx.font = 'bold 40px "Barlow Condensed", Impact, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, rx, ry + 2);

  // Door numbers, rotated to read along the car.
  ctx.font = 'bold 30px "Barlow Condensed", Impact, sans-serif';
  ctx.fillStyle = '#f4f6fa';
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, TEX_W * 0.56, 24);
  ctx.fillText(text, TEX_W * 0.56, TEX_H - 22);
  ctx.restore();
};

/** Builds the top-view livery texture for a car. */
export const buildLiveryTexture = (
  design: CarDesign,
  custom: CarCustomization,
): THREE.CanvasTexture => {
  const canvas = document.createElement('canvas');
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = custom.primary;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  drawStripes(ctx, design, custom);
  drawDecal(ctx, custom.decal, custom);
  drawRaceNumber(ctx, custom);

  // Shut lines: bonnet, doors and engine cover read as real panel gaps.
  ctx.strokeStyle = 'rgba(0,0,0,0.32)';
  ctx.lineWidth = 2;
  const gaps = [0.26, 0.42, 0.68, 0.82];
  for (const g of gaps) {
    ctx.beginPath();
    ctx.moveTo(TEX_W * g, 0);
    ctx.lineTo(TEX_W * g, TEX_H);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(TEX_W * 0.42, TEX_H * 0.18);
  ctx.lineTo(TEX_W * 0.82, TEX_H * 0.18);
  ctx.moveTo(TEX_W * 0.42, TEX_H * 0.82);
  ctx.lineTo(TEX_W * 0.82, TEX_H * 0.82);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
};

/** Material parameters for each paint finish. */
export const finishParams = (
  finish: CarCustomization['finish'],
): { roughness: number; metalness: number; clearcoat: number; clearcoatRoughness: number } => {
  switch (finish) {
    case 'matte':
      return { roughness: 0.68, metalness: 0.1, clearcoat: 0.12, clearcoatRoughness: 0.6 };
    case 'metallic':
      return { roughness: 0.3, metalness: 0.72, clearcoat: 0.6, clearcoatRoughness: 0.18 };
    case 'pearl':
      return { roughness: 0.16, metalness: 0.32, clearcoat: 1, clearcoatRoughness: 0.05 };
    case 'gloss':
    default:
      return { roughness: 0.24, metalness: 0.18, clearcoat: 0.9, clearcoatRoughness: 0.1 };
  }
};

/** Small canvas thumbnail of the livery, used on garage cards. */
export const liveryThumbnail = (custom: CarCustomization): string => {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = custom.primary;
  ctx.fillRect(0, 0, 96, 48);
  ctx.fillStyle = custom.secondary;
  ctx.fillRect(0, 18, 96, 12);
  return canvas.toDataURL();
};
