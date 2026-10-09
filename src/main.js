import './style.css';
import { createScene } from './scene.js';
import { mountComposer } from './composer.js';
import { mountReader } from './reader.js';

const canvas = document.querySelector('#view');
const scene = createScene(canvas);
const match = window.location.pathname.match(/^\/l\/([^/]+)\/?$/);

if (match) mountReader(scene, decodeURIComponent(match[1]));
else mountComposer(scene);
