import { FOLDS } from './folds.js';
import { PRESETS, createLetterCanvas, drawLetter } from './texture.js';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountComposer(scene) {
  const composer = document.getElementById('composer');
  const message = document.getElementById('message');
  const papers = document.getElementById('papers');
  const folds = document.getElementById('folds');
  const upload = document.getElementById('upload');
  const uploadLabel = document.getElementById('upload-label');
  const watch = document.getElementById('watch');
  const seal = document.getElementById('seal');
  const status = document.getElementById('status');
  const share = document.getElementById('share');
  const link = document.getElementById('link');
  const copy = document.getElementById('copy');
  const another = document.getElementById('another');

  const canvas = createLetterCanvas();
  let preset = 'cream';
  let fold = 'trifold';
  let image = null;
  let objectUrl = null;
  let timer = 0;

  composer.hidden = false;
  scene.setMode('composer');

  PRESETS.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `swatch ${item.id}`;
    button.title = item.name;
    button.setAttribute('aria-label', item.name);
    button.setAttribute('aria-pressed', String(item.id === preset));
    button.addEventListener('click', () => {
      preset = item.id;
      clearUpload();
      markPapers();
      render();
    });
    papers.append(button);
  });

  FOLDS.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fold';
    button.setAttribute('aria-pressed', String(item.id === fold));
    button.innerHTML = `<strong>${item.name}</strong><small>${item.blurb}</small>`;
    button.addEventListener('click', () => {
      fold = item.id;
      markFolds();
      scene.setProgress(0);
      render();
    });
    folds.append(button);
  });

  message.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, 90);
  });

  upload.addEventListener('change', () => {
    const file = upload.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      status.textContent = 'That image is larger than 5 MB.';
      upload.value = '';
      return;
    }
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      image = next;
      uploadLabel.textContent = file.name;
      upload.closest('.upload').classList.add('has-file');
      markPapers();
      status.textContent = '';
      render();
    };
    next.onerror = () => {
      status.textContent = 'That image could not be read.';
    };
    next.src = objectUrl;
  });

  watch.addEventListener('click', async () => {
    setBusy(true);
    status.textContent = '';
    scene.setProgress(0);
    await scene.playTo(1, reduceMotion ? 0 : 2800);
    setBusy(false);
  });

  seal.addEventListener('click', async () => {
    const text = message.value.trim();
    if (!text) {
      status.textContent = 'Write a message before sealing.';
      message.focus();
      return;
    }
    setBusy(true);
    status.textContent = 'Sealing…';
    share.hidden = true;
    const pending = saveLetter(text, fold, preset, upload.files?.[0]);
    scene.setProgress(0);
    const [saved] = await Promise.all([
      pending,
      scene.playTo(1, reduceMotion ? 0 : 2800),
    ]);
    setBusy(false);
    if (!saved.ok) {
      status.textContent = saved.error;
      return;
    }
    status.textContent = '';
    link.value = `${window.location.origin}${saved.url}`;
    share.hidden = false;
    link.focus();
    link.select();
  });

  copy.addEventListener('click', async () => {
    link.select();
    try {
      await navigator.clipboard.writeText(link.value);
      copy.textContent = 'Copied';
    } catch {
      document.execCommand('copy');
      copy.textContent = 'Copied';
    }
    window.setTimeout(() => {
      copy.textContent = 'Copy';
    }, 1400);
  });

  another.addEventListener('click', () => {
    share.hidden = true;
    status.textContent = '';
    scene.setProgress(0);
    message.focus();
  });

  render();

  function render() {
    const backColor = drawLetter(canvas, {
      text: message.value,
      preset,
      image,
      fold,
    });
    scene.setLetter({ canvas, backColor, fold });
  }

  function markPapers() {
    const usingUpload = Boolean(image);
    papers.querySelectorAll('.swatch').forEach((button, index) => {
      button.setAttribute('aria-pressed', String(!usingUpload && PRESETS[index].id === preset));
    });
  }

  function markFolds() {
    folds.querySelectorAll('.fold').forEach((button, index) => {
      button.setAttribute('aria-pressed', String(FOLDS[index].id === fold));
    });
  }

  function clearUpload() {
    image = null;
    upload.value = '';
    uploadLabel.textContent = 'Upload a background';
    upload.closest('.upload').classList.remove('has-file');
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    }
  }

  function setBusy(busy) {
    watch.disabled = busy;
    seal.disabled = busy;
    watch.textContent = busy ? 'Folding…' : 'Watch it fold';
  }
}

async function saveLetter(text, fold, preset, file) {
  const body = new FormData();
  body.set('text', text);
  body.set('fold', fold);
  if (file) body.set('image', file);
  else body.set('preset', preset);

  try {
    const response = await fetch('/api/letters', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || 'The letter could not be saved.' };
    return { ok: true, url: data.url };
  } catch {
    return { ok: false, error: 'The letter could not be saved.' };
  }
}
