'use strict';

function runtimeSend(request) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      request,
      ({status, result}) => (status === 'error' ? reject : resolve)(result)
    );
  });
}

function createSourceLoader() {
  let source;

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

  function load() {
    return fetchText(location.href)
      .then(_source => {
        source = _source;
        return source;
      });
  }

  function watch(cb) {
    let timer;
    const DELAY = 1000;

    function start() {
      if (timer) {
        return;
      }
      timer = setTimeout(check, DELAY);
    }

    function stop() {
      clearTimeout(timer);
      timer = null;
    }

    function check() {
      fetchText(location.href)
        .then(_source => {
          if (source !== _source) {
            source = _source;
            return cb(source);
          }
        })
        .catch(console.log)
        .then(() => {
          timer = setTimeout(check, DELAY);
        });
    }

    return {start, stop};
  }

  return {load, watch, source: () => source};
}

function initUsercssInstall() {
  const pendingSource = createSourceLoader().load();

  connectToPort('usercss-install').then(onConnect);

  const url = chrome.runtime.getURL('/install-usercss.html') +
    '?updateUrl=' + location.href;

  injectIframe({
    url,
    onCreate(iframe) {
      connectToIframe(iframe).then(onConnect);
    },
    onError(err) {
      console.error('failed to inject iframe, fallback to new tab', err);
      runtimeSend({
        method: 'openUsercssInstallPage',
        updateUrl: location.href
      }).catch(alert);
    }
  });

  function connectToPort(name) {
    return new Promise(resolve => {
      chrome.runtime.onConnect.addListener(port => {
        // FIXME: is this the correct way to reject a connection?
        // https://developer.chrome.com/extensions/messaging#connect
        console.assert(port.name === name);

        function postMessage(data) {
          port.postMessage(data);
        }

        function onMessage(cb) {
          port.onMessage.addListener(cb);
        }

        resolve({postMessage, onMessage});
      });
    });
  }

  function connectToIframe(iframe) {
    return new Promise(resolve => {
      function onMessage(cb) {
        window.addEventListener('message', e => {
          if (e.source !== iframe.contentWindow) {
            return;
          }
          cb(e.data);
        });
      }

      function postMessage(data) {
        iframe.contentWindow.postMessage(data, iframe.src);
      }

      resolve({onMessage, postMessage});
    });
  }

  function onConnect(connection) {
    connection.onMessage(msg => {
      switch (msg.method) {
        case 'getSourceCode':
          pendingSource.then(sourceCode =>
            connection.postMessage({method: msg.method + 'Response', sourceCode})
          ).catch(err =>
            connection.postMessage({method: msg.method + 'Response', error: err.message || String(err)})
          );
          break;
      }
    });
  }
}

function injectIframe({url, onCreate, onError}) {
  onError = wrapOnError(onError);

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style = `
    all: unset;
    margin: 0;
    padding: 0;
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: white;
  `.replace(/;/g, '!important;');

  iframe.addEventListener('load', onLoad);
  iframe.addEventListener('error', wrapOnError(onError));
  document.body.appendChild(iframe);
  document.body.style.overflow = 'hidden';

  onCreate(iframe);

  const observer = new MutationObserver(onDOMChange);
  observer.observe(iframe.parentNode, {childList: true});

  function onLoad() {
    iframe.contentWindow.focus();
    iframe.removeEventListener('load', onLoad);
  }

  function wrapOnError(fn) {
    return err => {
      fn(err);
      unbind();
      iframe.remove();
    };
  }

  function onDOMChange() {
    if (!iframe.parentNode) {
      onError(new Error('iframe is removed from DOM'));
      unbind();
      iframe.remove();
    }
  }

  function unbind() {
    iframe.removeEventListener('load', onLoad);
    iframe.removeEventListener('error', onError);
    observer.disconnect();
  }
}

function isUsercss() {
  if (!/text\/(css|plain)/.test(document.contentType)) {
    return false;
  }
  if (!/==userstyle==/i.test(document.body.textContent)) {
    return false;
  }
  return true;
}

if (isUsercss()) {
  initUsercssInstall();
}
