import { FOLDS } from './folds.js';
import { foldMini } from './mini.js';
import { PRESETS, createLetterCanvas, drawLetter, letterFontReady } from './texture.js';

const PAPERS = PRESETS.filter((item) => item.id === 'cream' || item.id === 'kraft');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FOLD_MS = { gate: 3800, pagu: 7400, jeff: 9700 };
// How long typing pauses before the sheet is redrawn; phones redraw slowly.
const TYPE_MS = window.matchMedia('(pointer: coarse)').matches ? 260 : 90;

const MINIS = {
  gate: '<span class="sheet gate"><i class="l"></i><i class="ml"></i><span class="half"><i class="mr"></i><i class="r"></i></span></span>',
};

export function mountComposer(scene) {
  const intro = document.getElementById('intro');
  const film = document.getElementById('intro-film');
  const video = film.querySelector('video');
  const start = document.getElementById('start');
  const composer = document.getElementById('composer');
  const message = document.getElementById('message');
  const papers = document.getElementById('papers');
  const folds = document.getElementById('folds');
  const foldRef = document.getElementById('fold-ref');
  const foldHistory = document.getElementById('fold-history');
  const foldCopy = document.getElementById('fold-copy');
  const foldVideo = document.getElementById('fold-video');
  const foldCatalog = document.getElementById('fold-catalog');
  const seal = document.getElementById('seal');
  const status = document.getElementById('status');
  const share = document.getElementById('share');
  const link = document.getElementById('link');
  const copy = document.getElementById('copy');
  const another = document.getElementById('another');
  const steps = ['write', 'paper', 'fold'];
  const stepIndex = document.getElementById('step-index');
  const bars = composer.querySelectorAll('.bars i');

  const canvas = createLetterCanvas();
  let preset = 'cream';
  let fold = FOLDS[0].id;
  let step = 'intro';
  let timer = 0;
  let busy = false;
  let previewToken = 0;
  intro.hidden = false;
  film.hidden = false;
  document.body.classList.add('on-intro');
  if (!reduceMotion) video.play().catch(() => {});
  const introSize = new ResizeObserver(() => {
    document.documentElement.style.setProperty('--intro-height', `${intro.offsetHeight}px`);
  });
  introSize.observe(intro);
  scene.setMode('composer');

  PAPERS.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `fold paper ${item.id}`;
    button.setAttribute('aria-pressed', String(item.id === preset));
    button.innerHTML = `<span class="mini" aria-hidden="true"><span class="swatch ${item.id}"></span></span><span class="fold-name">${item.name}</span>`;
    button.addEventListener('click', () => {
      preset = item.id;
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
    button.innerHTML = `<span class="mini" aria-hidden="true">${MINIS[item.id] ?? ''}</span><span class="fold-name">${item.name}</span>`;
    if (!MINIS[item.id]) button.querySelector('.mini').append(foldMini(item.id, { still: reduceMotion }));
    button.addEventListener('click', () => {
      if (busy) return;
      fold = item.id;
      markFolds();
      render();
      previewFold();
    });
    folds.append(button);
  });

  message.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(render, TYPE_MS);
    if (message.value.trim()) status.textContent = '';
    refreshNav();
  });

  document.getElementById('to-paper').addEventListener('click', () => goTo('paper'));
  document.getElementById('to-fold').addEventListener('click', () => goTo('fold'));
  for (const name of steps) {
    document.getElementById(`nav-${name}`).addEventListener('click', () => goTo(name));
  }
  bars.forEach((bar, index) => {
    bar.addEventListener('click', () => {
      if (index < steps.indexOf(step)) goTo(steps[index]);
    });
  });
  composer.querySelectorAll('.back').forEach((back) => {
    back.addEventListener('click', () => {
      const index = steps.indexOf(step);
      if (index > 0) goTo(steps[index - 1]);
    });
  });

  seal.addEventListener('click', async () => {
    const text = message.value.trim();
    if (!text) {
      status.textContent = 'Write a message before locking it.';
      showStep('write');
      message.focus();
      return;
    }
    setBusy(true);
    status.textContent = '';
    share.hidden = true;
    share.classList.remove('show');
    composer.classList.add('leaving');
    scene.takeCenter();
    const pending = saveLetter(text, fold, preset);
    const motion = reduceMotion ? 0 : 1;
    await scene.playTo(0, 420 * motion);
    await scene.playTo(1, foldDuration() * motion);
    await scene.flyAway(1500 * motion);
    const saved = await pending;
    setBusy(false);
    if (!saved.ok) {
      composer.classList.remove('leaving');
      scene.present();
      status.textContent = saved.error;
      previewFold();
      return;
    }
    link.value = `${window.location.origin}${saved.url}`;
    seal.parentElement.hidden = true;
    share.hidden = false;
    requestAnimationFrame(() => {
      share.classList.add('show');
      link.focus();
      link.select();
    });
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
    share.classList.remove('show');
    share.hidden = true;
    composer.classList.remove('leaving');
    seal.parentElement.hidden = false;
    status.textContent = '';
    scene.present();
    scene.playTo(0, 0);
    showStep('write');
    message.focus();
  });

  start.addEventListener('click', async () => {
    start.disabled = true;
    step = 'write';
    intro.classList.add('leaving');
    film.classList.add('leaving');
    await wait(reduceMotion ? 0 : 600);
    intro.hidden = true;
    film.hidden = true;
    video.pause();
    introSize.disconnect();
    markFolds();
    composer.hidden = false;
    showStep('write');
    scene.snapFrame();
    document.body.classList.remove('on-intro');
    if (window.matchMedia('(pointer: fine)').matches) message.focus();
  });

  render();
  letterFontReady.then(render);
  FOLDS.forEach((item) => scene.prepare(item.id));
  scene.playTo(0, 0);

  function goTo(next) {
    if (busy || next === step) return;
    if (next !== 'write' && !message.value.trim()) {
      status.textContent = 'Write a message first.';
      message.focus();
      return;
    }
    if (!share.hidden) reopenSend();
    showStep(next);
  }

  function reopenSend() {
    share.hidden = true;
    seal.parentElement.hidden = false;
  }

  function showStep(next) {
    const index = steps.indexOf(next);
    composer.dataset.dir = index < steps.indexOf(step) ? 'back' : 'forward';
    step = next;
    status.textContent = '';
    stepIndex.textContent = `Step ${index + 1} of ${steps.length}`;
    bars.forEach((bar, at) => {
      bar.classList.toggle('is-done', at <= index);
      bar.classList.toggle('is-now', at === index);
    });
    const ready = Boolean(message.value.trim());
    steps.forEach((name, at) => {
      const open = name === next;
      const panel = document.getElementById(`step-${name}`);
      panel.classList.toggle('is-on', open);
      panel.parentElement.classList.toggle('current', open);
      panel.parentElement.classList.toggle('done', at <= index);
      panel.toggleAttribute('inert', !open);
      const nav = document.getElementById(`nav-${name}`);
      nav.setAttribute('aria-expanded', String(open));
      if (open) nav.setAttribute('aria-current', 'step');
      else nav.removeAttribute('aria-current');
      nav.disabled = name !== 'write' && !ready;
    });
    if (next === 'fold') previewFold();
    else scene.playTo(0, 0);
  }

  function foldDuration() {
    return FOLD_MS[fold];
  }

  async function previewFold() {
    const token = ++previewToken;
    const shown = step;
    const live = () => token === previewToken && step === shown && !busy;
    await scene.playTo(0, 0);
    if (reduceMotion) {
      if (live()) scene.playTo(1, 0);
      return;
    }
    while (live()) {
      if (!(await scene.playTo(1, foldDuration())) || !live()) return;
      await wait(1400);
      if (!live() || !(await scene.playTo(0, 1100)) || !live()) return;
      await wait(700);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function render() {
    const backColor = drawLetter(canvas, {
      text: message.value,
      preset,
      image: null,
      fold,
    });
    scene.setLetter({ canvas, backColor, fold });
  }

  function markPapers() {
    papers.querySelectorAll('.paper').forEach((button, index) => {
      button.setAttribute('aria-pressed', String(PAPERS[index].id === preset));
    });
  }

  function markFolds() {
    folds.querySelectorAll('.fold').forEach((button, index) => {
      button.setAttribute('aria-pressed', String(FOLDS[index].id === fold));
    });
    const chosen = FOLDS.find((item) => item.id === fold);
    foldRef.textContent = `Unlocking History \u00b7 ${chosen.uh}`;
    foldHistory.hidden = !chosen.history;
    foldHistory.textContent = chosen.history || '';
    foldCopy.textContent = chosen.blurb;
    foldVideo.hidden = !chosen.video;
    if (chosen.video) foldVideo.href = chosen.video;
    foldCatalog.hidden = !chosen.catalog;
    if (chosen.catalog) foldCatalog.href = chosen.catalog;
  }

  function refreshNav() {
    const ready = Boolean(message.value.trim());
    for (const name of steps.slice(1)) {
      document.getElementById(`nav-${name}`).disabled = !ready;
    }
  }

  function setBusy(next) {
    busy = next;
    composer.querySelectorAll('button').forEach((button) => {
      button.disabled = next;
    });
    if (!next) seal.disabled = false;
  }
}

async function saveLetter(text, fold, preset) {
  const body = new FormData();
  body.set('text', text);
  body.set('fold', fold);
  body.set('preset', preset);

  try {
    const response = await fetch('/api/letters', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || 'The letter could not be saved.' };
    return { ok: true, url: data.url };
  } catch {
    return { ok: false, error: 'The letter could not be saved.' };
  }
}
