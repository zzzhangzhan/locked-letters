import { createLetterCanvas, drawLetter } from './texture.js';

export async function mountReader(scene, id) {
  const hint = document.getElementById('hint');
  const missing = document.getElementById('missing');
  document.title = 'A locked letter for you';
  scene.setMode('reader');
  scene.onUnfold(() => hint.classList.add('faded'));

  let payload;
  try {
    const response = await fetch(`/api/letters/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error('missing');
    payload = await response.json();
  } catch {
    missing.hidden = false;
    return;
  }

  if (!['trifold', 'gate', 'locked', 'pagu'].includes(payload.fold)) {
    missing.hidden = false;
    return;
  }

  let image = null;
  if (payload.backgroundUrl) {
    try {
      image = await loadImage(payload.backgroundUrl);
    } catch {
      missing.hidden = false;
      return;
    }
  }

  const canvas = createLetterCanvas();
  const backColor = drawLetter(canvas, {
    text: payload.text,
    preset: payload.preset,
    image,
    fold: payload.fold,
  });
  scene.setProgress(1);
  scene.setLetter({ canvas, backColor, fold: payload.fold });
  hint.hidden = false;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('image'));
    image.src = url;
  });
}
