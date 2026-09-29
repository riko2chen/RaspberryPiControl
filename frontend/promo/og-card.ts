// Development-only artwork entry. Uses the same model as the application,
// with fixed, synthetic data and no access to saved devices or local storage.
import {createCubeViewer} from '../src/model/cube-viewer';
import {DemoEngine} from '../src/demo/engine';

const canvas = document.createElement('canvas');
canvas.width = 128; canvas.height = 32;
const context = canvas.getContext('2d')!;
context.fillStyle = '#fff';
context.font = '9px monospace';
context.textBaseline = 'top';
context.fillText('PI CONTROL', 1, 1);
context.fillText('MAKE IT YOURS', 1, 12);
context.fillText('LIGHTS / FAN / OLED', 1, 23);
const pixels = context.getImageData(0, 0, 128, 32).data;
const bytes = new Uint8Array(512);
for (let i = 0; i < 4096; i++) if (pixels[i * 4 + 3] > 128) bytes[i >> 3] |= 1 << (7 - i % 8);
const engine = new DemoEngine({getItem: () => null, setItem: () => {}, removeItem: () => {}},
  () => btoa(String.fromCharCode(...bytes)), () => 0);
const state = engine.sample();
state.config.lights.effect = 'static';
state.applied.lights!.parameters.effect = 'static';
state.applied.lights!.colors = ['#ab8eff', '#9891ff', '#699eff', '#4bbaff', '#60d9f1', '#76e4da', '#a8ecdb', '#dbeac2', '#f1d8bd', '#edbacc', '#d89ee8', '#b991f6', '#9994fa', '#7aaefa'];
const host = document.querySelector<HTMLDivElement>('#model')!;
const viewer = await createCubeViewer(host, state, () => {}, () => {document.body.dataset.render = 'failed';});
viewer.pause(true);
document.body.dataset.render = 'ready';
