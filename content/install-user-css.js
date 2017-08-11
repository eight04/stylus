'use strict';

function fetchText(url) {
  return new Promise((resolve, reject) => {
    // you can't use fetch in Chrome under 'file:' protocol
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.addEventListener('load', () => resolve(xhr.responseText));
    xhr.addEventListener('error', () => reject(xhr));
    xhr.send();
  });
}

function install(style) {
  const request = Object.assign(style, {
    method: 'saveStyle',
    reason: 'install',
    url: location.href,
    updateUrl: location.href
  });
  return communicate(request);
}

function communicate(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(request, ([err, result]) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
}

function initUsercssInstall() {
  fetchText(location.href).then(source =>
    communicate({
      method: 'queryUsercss',
      source: source,
      checkDup: true
    })
  ).then(({style, dup}) => {
    if (dup) {
      if (confirm(chrome.i18n.getMessage('styleInstallOverwrite', [style.name, dup.version, style.version]))) {
        return install(style);
      }
    } else if (confirm(chrome.i18n.getMessage('styleInstall', [style.name]))) {
      return install(style);
    }
  }).catch(err => {
    console.log(err);
    alert(chrome.i18n.getMessage('styleInstallFailed', String(err)));
  });
}

// It seems that we need to wait some time to redraw the page.
setTimeout(initUsercssInstall, 500);
