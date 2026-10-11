const TEX = 1400;

export const PRESETS = [
  { id: 'cream', name: 'Cream', back: '#e4d8c4' },
  { id: 'lined', name: 'Lined', back: '#efe4d0' },
  { id: 'kraft', name: 'Kraft', back: '#b08958' },
  { id: 'airmail', name: 'Airmail', back: '#d4e3f3' },
];

const presetCache = new Map();

export function sheetAspect(fold) {
  return fold === 'locked' ? 1 : 8.5 / 11;
}

export function createLetterCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = TEX;
  canvas.height = TEX;
  return canvas;
}

export function drawLetter(canvas, { text, preset, image, fold }) {
  const aspect = sheetAspect(fold);
  const width = TEX;
  const height = Math.round(TEX / aspect);
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, width, height);

  if (image) {
    drawCover(ctx, image, width, height);
  } else {
    const paper = cachedPreset(preset || 'cream', width, height);
    ctx.drawImage(paper, 0, 0);
  }

  const message = (text || '').trim();
  if (message) {
    paintMessage(ctx, width, height, message, Boolean(image));
  } else {
    paintHint(ctx, width, height);
  }
  if (image) return sampleBack(image);
  return PRESETS.find((item) => item.id === preset)?.back || PRESETS[0].back;
}

function cachedPreset(preset, width, height) {
  const key = `${preset}:${width}x${height}`;
  const cached = presetCache.get(key);
  if (cached) return cached;
  const paper = document.createElement('canvas');
  paper.width = width;
  paper.height = height;
  paintPreset(paper.getContext('2d'), width, height, preset);
  presetCache.set(key, paper);
  return paper;
}

function paintPreset(ctx, width, height, preset) {
  if (preset === 'lined') {
    ctx.fillStyle = '#f7f1e4';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = 'rgba(120, 162, 196, 0.55)';
    ctx.lineWidth = 2;
    const gap = Math.round(height / 28);
    for (let y = Math.round(height * 0.1); y < height - gap; y += gap) {
      ctx.beginPath();
      ctx.moveTo(width * 0.08, y);
      ctx.lineTo(width * 0.94, y);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(196, 92, 92, 0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width * 0.14, height * 0.05);
    ctx.lineTo(width * 0.14, height * 0.96);
    ctx.stroke();
    return;
  }

  if (preset === 'kraft') {
    ctx.fillStyle = '#c4a06a';
    ctx.fillRect(0, 0, width, height);
    grain(ctx, width, height, 28);
    return;
  }

  if (preset === 'airmail') {
    ctx.fillStyle = '#e7f2fb';
    ctx.fillRect(0, 0, width, height);
    const stripe = Math.round(height * 0.018);
    const bands = 7;
    for (let i = 0; i < bands; i += 1) {
      ctx.fillStyle = i % 2 === 0 ? '#d24b4b' : '#234e86';
      ctx.fillRect(0, i * stripe, width, stripe);
      ctx.fillRect(0, height - (i + 1) * stripe, width, stripe);
    }
    const inset = bands * stripe + Math.round(height * 0.02);
    ctx.fillStyle = '#f4f8fc';
    ctx.fillRect(inset * 0.7, inset, width - inset * 1.4, height - inset * 2);
    return;
  }

  ctx.fillStyle = '#f3ead7';
  ctx.fillRect(0, 0, width, height);
  grain(ctx, width, height, 14);
}

function grain(ctx, width, height, strength) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * strength;
    data[i] = clampByte(data[i] + n);
    data[i + 1] = clampByte(data[i + 1] + n);
    data[i + 2] = clampByte(data[i + 2] + n);
  }
  ctx.putImageData(image, 0, 0);
}

function clampByte(value) {
  return Math.max(0, Math.min(255, value));
}

function drawCover(ctx, image, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const dw = image.width * scale;
  const dh = image.height * scale;
  ctx.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
}

function sampleBack(image) {
  const sample = document.createElement('canvas');
  sample.width = 4;
  sample.height = 4;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, 4, 4);
  const data = ctx.getImageData(0, 0, 4, 4).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const count = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const hex = (value) => Math.round(value / count).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function contentBox(width, height) {
  const padX = width * 0.09;
  const padY = height * 0.07;
  return {
    x: padX,
    y: padY,
    w: width - padX * 2,
    h: height - padY * 2,
    gutters: [],
  };
}

function paintHint(ctx, width, height) {
  const box = contentBox(width, height);
  ctx.fillStyle = 'rgba(62, 48, 36, 0.38)';
  ctx.font = `italic ${Math.round(width * 0.034)}px "Iowan Old Style", Palatino, Georgia, serif`;
  ctx.textBaseline = 'top';
  ctx.fillText('Your words will sit here', box.x, box.y);
}

function paintMessage(ctx, width, height, text, veil) {
  const box = contentBox(width, height);
  const fitted = fitText(ctx, text, box);
  if (veil) {
    ctx.fillStyle = 'rgba(247, 241, 230, 0.78)';
    const blockH = Math.min(box.h, fitted.usedHeight + fitted.lineHeight);
    roundRect(ctx, box.x - 18, box.y - 16, box.w + 36, blockH + 28, 18);
    ctx.fill();
  }
  ctx.fillStyle = '#2c241c';
  ctx.font = fitted.font;
  ctx.textBaseline = 'top';
  let y = box.y;
  for (let i = 0; i < fitted.lines.length; i += 1) {
    y = skipGutters(y, fitted.lineHeight, box.gutters);
    if (y + fitted.lineHeight > box.y + box.h) break;
    ctx.fillText(fitted.lines[i], box.x, y);
    y += fitted.lineHeight;
  }
}

function fitText(ctx, text, box) {
  let size = Math.floor(Math.min(box.w * 0.2, box.h * 0.08));
  const min = 18;
  let lines = [];
  let lineHeight = size;
  while (size >= min) {
    ctx.font = `${size}px "Iowan Old Style", Palatino, Georgia, serif`;
    lines = wrapText(ctx, text, box.w);
    lineHeight = Math.round(size * 1.38);
    if (layoutHeight(lines.length, lineHeight, box) <= box.h) break;
    size -= 2;
  }
  return {
    font: `${Math.max(size, min)}px "Iowan Old Style", Palatino, Georgia, serif`,
    lines,
    lineHeight,
    usedHeight: layoutHeight(lines.length, lineHeight, box),
  };
}

function layoutHeight(lineCount, lineHeight, box) {
  let y = box.y;
  for (let i = 0; i < lineCount; i += 1) {
    y = skipGutters(y, lineHeight, box.gutters);
    y += lineHeight;
  }
  return y - box.y;
}

function skipGutters(y, lineHeight, gutters) {
  for (const gutter of gutters) {
    if (y + lineHeight > gutter.start && y < gutter.end) return gutter.end;
  }
  return y;
}

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }
    const words = paragraph.split(/\s+/);
    let line = '';
    for (const word of words) {
      const piece = breakWord(ctx, word, maxWidth);
      for (const part of piece) {
        const test = line ? `${line} ${part}` : part;
        if (line && ctx.measureText(test).width > maxWidth) {
          lines.push(line);
          line = part;
        } else {
          line = test;
        }
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function breakWord(ctx, word, maxWidth) {
  if (ctx.measureText(word).width <= maxWidth) return [word];
  const parts = [];
  let current = '';
  for (const char of word) {
    const test = current + char;
    if (current && ctx.measureText(test).width > maxWidth) {
      parts.push(current);
      current = char;
    } else {
      current = test;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
