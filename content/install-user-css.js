/* globals userstyle */

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

function install() {
  fetchText(location.href).then(source => {
    const request = {
      method: 'saveStyle',
      url: location.href,
      updateUrl: location.href,
      reason: 'install'
    };
    Object.assign(request, userstyle.json(source));
    chrome.runtime.sendMessage(request);
  }).catch(err => {
    console.log(err);
    alert(chrome.i18n.getMessage('styleInstallFailed', String(err)));
  });
}

// It seems that we need to wait some time to redraw the page.
setTimeout(() => {
  if (confirm(chrome.i18n.getMessage('styleInstallNoName'))) {
    install();
  }
}, 500);
