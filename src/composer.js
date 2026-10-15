import { FOLDS } from './folds.js';
import { PRESETS, createLetterCanvas, drawLetter } from './texture.js';

const PAPERS = PRESETS.filter((item) => item.id === 'cream' || item.id === 'kraft');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FOLD_MS = 2600;

const MINIS = {
  trifold: '<span class="sheet tri"><i class="mid"></i><i class="bot"></i><i class="top"></i></span>',
  gate: '<span class="sheet gate"><i class="mid"></i><i class="left"></i><i class="right"></i></span>',
  locked: '<span class="sheet lock"><i class="base"></i><i class="c nw"></i><i class="c ne"></i><i class="c se"></i><i class="c sw"></i></span>',
  pagu: '<span class="sheet hex"><i class="body"></i><i class="tuck"></i></span>',
};

export function mountComposer(scene) {
  const composer = document.getElementById('composer');
  const message = document.getElementById('message');
  const papers = document.getElementById('papers');
  const folds = document.getElementById('folds');
  const seal = document.getElementById('seal');
  const status = document.getElementById('status');
  const share = document.getElementById('share');
  const link = document.getElementById('link');
  const copy = document.getElementById('copy');
  const another = document.getElementById('another');
  const sendCopy = composer.querySelector('.send-copy');

  const canvas = createLetterCanvas();
  let preset = 'cream';
  let fold = 'trifold';
  let step = 'write';
  let timer = 0;
  let busy = false;
  let sending = false;
  let loopToken = 0;

  composer.hidden = false;
  scene.setMode('composer');

  PAPERS.forEach((item) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `paper ${item.id}`;
    button.setAttribute('aria-pressed', String(item.id === preset));
    button.innerHTML = `<span class="swatch ${item.id}" aria-hidden="true"></span><span>${item.name}</span>`;
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
    button.innerHTML = `<span class="mini" aria-hidden="true">${MINIS[item.id]}</span><span class="fold-name">${item.name}</span>`;
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
    timer = window.setTimeout(render, 90);
    if (message.value.trim()) status.textContent = '';
    refreshNav();
  });

  document.getElementById('to-paper').addEventListener('click', () => goTo('paper'));
  document.getElementById('to-fold').addEventListener('click', () => goTo('fold'));
  document.getElementById('to-send').addEventListener('click', () => goTo('send'));
  for (const name of ['write', 'paper', 'fold', 'send']) {
    document.getElementById(`nav-${name}`).addEventListener('click', () => goTo(name));
  }

  seal.addEventListener('click', async () => {
    const text = message.value.trim();
    if (!text) {
      status.textContent = 'Write a message before sealing.';
      showStep('write');
      message.focus();
      return;
    }
    sending = true;
    loopToken += 1;
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
    sending = false;
    if (!saved.ok) {
      composer.classList.remove('leaving');
      scene.present();
      status.textContent = saved.error;
      loopFold();
      return;
    }
    link.value = `${window.location.origin}${saved.url}`;
    sendCopy.hidden = true;
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
    sendCopy.hidden = false;
    seal.parentElement.hidden = false;
    status.textContent = '';
    scene.present();
    scene.playTo(0, 0);
    showStep('write');
    message.focus();
  });

  render();
  showStep('write');

  function goTo(next) {
    if (busy || next === step) return;
    if (next !== 'write' && !message.value.trim()) {
      status.textContent = 'Write a message before choosing paper.';
      message.focus();
      return;
    }
    if (!share.hidden) reopenSend();
    showStep(next);
  }

  function reopenSend() {
    share.hidden = true;
    sendCopy.hidden = false;
    seal.parentElement.hidden = false;
  }

  function showStep(next) {
    step = next;
    status.textContent = '';
    const ready = Boolean(message.value.trim());
    for (const name of ['write', 'paper', 'fold', 'send']) {
      const open = name === next;
      const panel = document.getElementById(`step-${name}`);
      panel.classList.toggle('is-on', open);
      panel.toggleAttribute('inert', !open);
      const nav = document.getElementById(`nav-${name}`);
      nav.setAttribute('aria-expanded', String(open));
      if (open) nav.setAttribute('aria-current', 'step');
      else nav.removeAttribute('aria-current');
      nav.disabled = name !== 'write' && !ready;
    }
    if (next === 'fold') {
      stopLoop();
      previewFold();
    } else if (next === 'send') {
      loopFold();
    } else {
      stopLoop();
      scene.playTo(0, 0);
    }
  }

  function stopLoop() {
    loopToken += 1;
  }

  async function loopFold() {
    const token = ++loopToken;
    const motion = reduceMotion ? 0 : 1;
    while (step === 'send' && token === loopToken && !sending) {
      if (!(await scene.playTo(0, 650 * motion))) return;
      if (step !== 'send' || token !== loopToken || sending) return;
      if (!(await scene.playTo(1, foldDuration() * motion))) return;
      if (step !== 'send' || token !== loopToken || sending) return;
      await wait(420);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function foldDuration() {
    return fold === 'pagu' ? 4800 : FOLD_MS;
  }

  function previewFold() {
    scene.playTo(0, 0).then(() => {
      if (step === 'fold') scene.playTo(1, reduceMotion ? 0 : foldDuration());
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
  }

  function refreshNav() {
    const ready = Boolean(message.value.trim());
    for (const name of ['paper', 'fold', 'send']) {
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
