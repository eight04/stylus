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
      updateUrl: location.href
    };
    Object.assign(request, userstyle.json(source));
    chrome.runtime.sendMessage(request);
  }).catch(err => {
    console.log(err);
    // FIXME: i18n
    alert(`Failed to install userstyle!\n${err}`);
  });
}

// FIXME: i18n
if (confirm('Do you want to install this style into stylus?')) {
  install();
}
