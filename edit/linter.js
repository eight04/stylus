'use strict';

// eslint-disable-next-line no-var
var linter = (() => {
  const changeCallbacks = [];
  const unhookCallbacks = [];
  const linters = [];
  const cms = new Set();

  return {
    register,
    run,
    enableForEditor,
    disableForEditor,
    onChange,
    onUnhook
  };

  function onUnhook(cb) {
    unhookCallbacks.push(cb);
  }

  function onChange(cb) {
    changeCallbacks.push(cb);
  }

  function onUpdateLinting(...args) {
    for (const cb of changeCallbacks) {
      cb(...args);
    }
  }

  function enableForEditor(cm) {
    cm.setOption('lint', {onUpdateLinting, getAnnotations});
    cms.add(cm);
  }

  function disableForEditor(cm) {
    cm.setOption('lint', false);
    cms.delete(cm);
    for (const cb of unhookCallbacks) {
      cb(cm);
    }
  }

  function register(linterFn) {
    linters.push(linterFn);
  }

  function run() {
    for (const cm of cms) {
      cm.performLint();
    }
  }

  function getAnnotations(...args) {
    return Promise.all(linters.map(fn => fn(...args)))
      .then(results => [].concat(...results.filter(Boolean)));
  }
})();

// FIXME: this should be put inside edit.js
prefs.subscribe(['editor.linter'], () => {
  linter.run();
});
