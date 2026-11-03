import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import multer from 'multer';
import { createStore } from './store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const store = createStore(dataDir);
const isProd = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT) || 3000;

const FOLDS = new Set(['gate', 'pagu', 'jeff']);
const PRESETS = new Set(['cream', 'lined', 'kraft', 'airmail']);
const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const upload = multer({
  storage: multer.diskStorage({
    destination: store.uploadDir,
    filename(req, file, cb) {
      const ext = MIME_EXT[file.mimetype] || '.img';
      cb(null, `${crypto.randomBytes(8).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (MIME_EXT[file.mimetype]) cb(null, true);
    else cb(new Error('type'));
  },
});

function removeUpload(file) {
  if (file?.path) fs.promises.unlink(file.path).catch(() => {});
}

const app = express();

app.use('/uploads', express.static(store.uploadDir, {
  fallthrough: false,
  maxAge: isProd ? '7d' : 0,
  setHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
  },
}));

app.post('/api/letters', (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) {
      const tooBig = err.code === 'LIMIT_FILE_SIZE';
      res.status(400).json({
        error: tooBig
          ? 'That image is larger than 5 MB.'
          : 'Use a JPEG, PNG, or WebP under 5 MB.',
      });
      return;
    }

    const text = String(req.body.text || '').replace(/\r\n/g, '\n').trim();
    const fold = String(req.body.fold || '');
    const preset = String(req.body.preset || '');

    if (!text) {
      removeUpload(req.file);
      res.status(400).json({ error: 'Write a message before locking it.' });
      return;
    }
    if (text.length > 4000) {
      removeUpload(req.file);
      res.status(400).json({ error: 'Keep the message under 4,000 characters.' });
      return;
    }
    if (!FOLDS.has(fold)) {
      removeUpload(req.file);
      res.status(400).json({ error: 'Choose a technique.' });
      return;
    }
    if (!req.file && !PRESETS.has(preset)) {
      res.status(400).json({ error: 'Choose a paper or upload a background.' });
      return;
    }

    const id = crypto.randomBytes(6).toString('base64url');
    const letter = {
      id,
      text,
      fold,
      backgroundType: req.file ? 'upload' : 'preset',
      backgroundValue: req.file ? req.file.filename : preset,
      createdAt: Date.now(),
    };

    try {
      await store.create(letter);
    } catch (error) {
      removeUpload(req.file);
      res.status(500).json({ error: 'The letter could not be saved.' });
      return;
    }

    res.json({ id, url: `/l/${id}` });
  });
});

app.get('/api/letters/:id', (req, res) => {
  const letter = store.get(req.params.id);
  if (!letter) {
    res.status(404).json({ error: 'This letter is not here.' });
    return;
  }
  res.json({
    text: letter.text,
    fold: letter.fold,
    backgroundUrl: letter.backgroundType === 'upload'
      ? `/uploads/${letter.backgroundValue}`
      : null,
    preset: letter.backgroundType === 'preset' ? letter.backgroundValue : null,
  });
});

if (isProd) {
  const dist = path.join(root, 'dist');
  app.use(express.static(dist));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) {
      next();
      return;
    }
    res.sendFile(path.join(dist, 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Letter server on http://127.0.0.1:${port}`);
});
