const { parentPort } = require('worker_threads');
const { performance } = require('perf_hooks');

let t = performance.now();
let tdiff = 0;
let tth = 1;
let tc = 0;

const calcHr = () => {
  const it = performance.now();
  tdiff = it - t;

  if (tdiff >= tth) {
    parentPort.postMessage({ key: 'main', val: tc});

    if (tc % 1000 == 0) {
      parentPort.postMessage({ key: 'sub', val: [tc, tdiff, tth]});
    }

    tc ++;
    t = it;

    if (tdiff > 1) {
      tth = 1 + (1 - tdiff);
    } else {
      tth = 1;
    }
  }

  setImmediate(calcHr);
};

setImmediate(calcHr);
