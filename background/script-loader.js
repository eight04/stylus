'use strict';

const cache = new Map();

function loadScript(path) {
  if (!path.includes('://')) {
    path = chrome.runtime.getURL(path);
  }
  return new Promise((resolve, reject) => {
    if (cache.has(path)) {
      resolve(cache.get(path));
      return;
    }
    const script = document.createElement('script');
    script.src = path;
    script.onload = () => {
      resolve(script);
      script.onload = null;
      script.onerror = null;

      cache.set(path, script);
    };
    script.onerror = event => {
      reject(event);
      script.onload = null;
      script.onerror = null;
      script.parentNode.removeChild(script);
    };
    document.head.appendChild(script);
  });
}
