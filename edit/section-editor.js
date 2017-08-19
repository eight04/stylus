/* global bindEvent bindEventGroup showHelp hideHelp beautify setupCodeMirror maximizeCodeHeight CodeMirror updateLintReport */

'use strict';

function some(iterable, testFn) {
  if (iterable.some) {
    return iterable.some(testFn);
  }
  for (const i of iterable) {
    if (testFn(i)) {
      return true;
    }
  }
  return false;
}

function dirtyReporter() {
  const dirty = new Map();
  return {
    add(obj, value) {
      const saved = dirty.get(obj);
      if (!saved) {
        dirty.set(obj, {type: 'add', newValue: value});
      } else if (saved.type === 'remove') {
        if (saved.savedValue === value) {
          dirty.delete(obj);
        } else {
          saved.newValue = value;
          saved.type = 'modify';
        }
      }
    },
    remove(obj, value) {
      const saved = dirty.get(obj);
      if (!saved) {
        dirty.set(obj, {type: 'remove', savedValue: value});
      } else if (saved.type === 'add') {
        dirty.delete(obj);
      } else if (saved.type === 'modify') {
        saved.type = 'remove';
      }
    },
    modify(obj, oldValue, newValue) {
      const saved = dirty.get(obj);
      if (!saved) {
        if (oldValue !== newValue) {
          dirty.set(obj, {type: 'modify', savedValue: oldValue, newValue});
        }
      } else if (saved.type === 'modify') {
        if (saved.savedValue === newValue) {
          dirty.delete(obj);
        } else {
          saved.newValue = newValue;
        }
      } else if (saved.type === 'add') {
        saved.newValue = newValue;
      }
    },
    clear() {
      dirty.clear();
    },
    count() {
      return dirty.size;
    }
  };
}

function createAppliesToToolbar(container, section) {
  const propertyToCss = {urls: 'url', urlPrefixes: 'url-prefix', domains: 'domain', regexps: 'regexp'};
  const CssToProperty = {'url': 'urls', 'url-prefix': 'urlPrefixes', 'domain': 'domains', 'regexp': 'regexps'};

  const applies = [];
  const applyEl = new Map();
  const error = new Set();
  const dirty = dirtyReporter();

  for (const i in propertyToCss) {
    if (section[i]) {
      section[i].forEach(url => {
        applies.push({
          type: propertyToCss[i],
          value: url
        });
      });
    }
  }

  if (applies.length) {
    for (const apply of applies) {
      addAppliesTo(apply);
    }
  } else {
    addAppliesToAny();
  }

  function addAppliesToAny() {
    const e = template.appliesToEverything.cloneNode(true);
    bindEventGroup(e, {'.add-applies-to': {click() {
      container.innerHTML = '';
      newAppliesTo();
    }}});
    container.appendChild(e);
  }

  function newAppliesTo() {
    const apply = {type: 'url', value: ''};
    if (applies.length) {
      apply.type = applies[applies.length - 1].type;
    }
    const el = addAppliesTo(apply);
    dirty.add(apply, apply.type + apply.value);
    error.add(apply);
    el.classList.add('error');
    applies.push(apply);
    updateSection(el, {apply});
  }

  function updateSection(el, detail) {
    for (const prop of Object.keys(propertyToCss)) {
      section[prop] = null;
    }
    for (const {type, value} of applies) {
      const prop = CssToProperty[type];
      if (!section[prop]) {
        section[prop] = [];
      }
      section[prop].push(value);
    }

    el.dispatchEvent(new CustomEvent('appliesToChange', {
      detail: Object.assign({section}, detail),
      bubbles: true
    }));
  }

  function removeAppliesTo(apply) {
    const el = applyEl.get(apply);
    applyEl.delete(apply);
    dirty.remove(apply);
    error.delete(apply);
    el.classList.remove('error');
    applies.splice(applies.indexOf(apply), 1);
    updateSection(el, {apply});
    container.removeChild(el);
    if (!applies.length) {
      addAppliesToAny();
    }
  }

  function addAppliesTo(apply) {
    const el = template.appliesTo.cloneNode(true);

    el.querySelector('[name=applies-type]').value = apply.type;
    el.querySelector('[name=applies-value]').value = apply.value;

    function onTypeChange(e) {
      dirty.modify(
        apply, apply.type + apply.value, e.target.value + apply.value
      );
      apply.type = e.target.value;
      updateSection(e.target, {apply});
    }

    function onValueChange(e) {
      if (
        // handle input event when type === regexp
        // handle change event when type !== regexp
        e.type === 'input' && apply.type !== 'regexp' ||
        e.type === 'change' && apply.type === 'regexp'
      ) {
        return;
      }
      dirty.modify(
        apply, apply.type + apply.value, apply.type + e.target.value
      );
      apply.value = e.target.value;
      if (!apply.value) {
        error.add(apply);
        el.classList.add('error');
      } else {
        error.delete(apply);
        el.classList.remove('error');
      }
      updateSection(e.target, {apply});
    }

    bindEventGroup(el, {
      '.remove-applies-to': {click() {
        removeAppliesTo(apply);
      }},
      '.add-applies-to': {click: newAppliesTo},
      '[name=applies-type]': {change: onTypeChange},
      '[name=applies-value]': {
        change: onValueChange,
        input: onValueChange
      }
    });

    container.appendChild(el);

    applyEl.set(apply, el);
    return el;
  }

  return {
    isDirty() {
      return dirty.count() > 0;
    },
    cleanDirty() {
      dirty.clear();
    },
    hasError() {
      return error.size > 0;
    }
  };
}

function createRegExpTester(section) {
  const GET_FAVICON_URL = 'https://www.google.com/s2/favicons?domain=';
  const OWN_ICON = chrome.runtime.getManifest().icons['16'];
  const cachedRegexps = new Map();
  let tabs = [];
  let queryTabsPending;
  let enabled;

  enable();

  function _queryTabs() {
    queryTabsPending = queryTabs().then(_tabs => {
      const supported = _tabs.map(tab => tab.url)
        .filter(url => URLS.supported.test(url));
      tabs = [...new Set(supported).values()];
      queryTabsPending = null;
    });
  }

  function onTabUpdate(tabId, info) {
    if (info.url && enabled) {
      _queryTabs();
      update();
    }
  }

  function enable() {
    enabled = true;
    chrome.tabs.onUpdated.addListener(onTabUpdate);
    _queryTabs();
    update();
  }

  function _disable() {
    enabled = false;
    chrome.tabs.onUpdated.removeListener(onTabUpdate);
  }

  function disable() {
    _disable();
    hideHelp();
  }

  function update() {
    if (!queryTabsPending) {
      _update();
    } else {
      queryTabsPending.then(_update);
    }
  }

  function _update() {
    if (!enabled) {
      return;
    }
    const regexps = (section.regexps || [])
      .filter(s => s)
      .map(text => {
        const rxData = Object.assign({text}, cachedRegexps.get(text));
        if (!rxData.urls) {
          let rx;
          try {
            rx = new RegExp(text);
          } catch (err) {}
          cachedRegexps.set(text, Object.assign(rxData, {
            rx,
            urls: new Map(),
          }));
        }
        return rxData;
      });

    for (const rxData of regexps) {
      const {rx, urls} = rxData;
      if (rx) {
        const urlsNow = new Map();
        for (const url of tabs) {
          const match = urls.get(url) || url.match(rx);
          if (match) {
            urlsNow.set(url, match);
          }
        }
        rxData.urls = urlsNow;
      }
    }
    const stats = {
      full: {data: [], label: t('styleRegexpTestFull')},
      partial: {data: [], label: [
        t('styleRegexpTestPartial'),
        template.regexpTestPartial.cloneNode(true),
      ]},
      none: {data: [], label: t('styleRegexpTestNone')},
      invalid: {data: [], label: t('styleRegexpTestInvalid')},
    };
    // collect stats
    for (const {text, rx, urls} of regexps) {
      if (!rx) {
        stats.invalid.data.push({text});
        continue;
      }
      if (!urls.size) {
        stats.none.data.push({text});
        continue;
      }
      const full = [];
      const partial = [];
      for (const [url, match] of urls.entries()) {
        const faviconUrl = url.startsWith(URLS.ownOrigin)
          ? OWN_ICON
          : GET_FAVICON_URL + new URL(url).hostname;
        const icon = $element({tag: 'img', src: faviconUrl});
        if (match[0].length === url.length) {
          full.push($element({appendChild: [
            icon,
            url,
          ]}));
        } else {
          partial.push($element({appendChild: [
            icon,
            url.slice(0, match.index),
            $element({tag: 'mark', textContent: match[0]}),
            url.slice(match.index + match[0].length),
          ]}));
        }
      }
      if (full.length) {
        stats.full.data.push({text, urls: full});
      }
      if (partial.length) {
        stats.partial.data.push({text, urls: partial});
      }
    }
    // render stats
    const report = $element({className: 'regexp-report'});
    const br = $element({tag: 'br'});
    for (const type in stats) {
      // top level groups: full, partial, none, invalid
      const {label, data} = stats[type];
      if (!data.length) {
        continue;
      }
      const block = report.appendChild($element({
        tag: 'details',
        open: true,
        dataset: {type},
        appendChild: $element({tag: 'summary', appendChild: label}),
      }));
      // 2nd level: regexp text
      for (const {text, urls} of data) {
        if (urls) {
          // type is partial or full
          block.appendChild($element({
            tag: 'details',
            open: true,
            appendChild: [
              $element({tag: 'summary', textContent: text}),
              // 3rd level: tab urls
              ...urls,
            ],
          }));
        } else {
          // type is none or invalid
          block.appendChild(document.createTextNode(text));
          block.appendChild(br.cloneNode());
        }
      }
    }
    showHelp(t('styleRegexpTestTitle'), report, _disable);

    report.onclick = event => {
      const target = event.target.closest('a, .regexp-report div');
      if (target) {
        openURL({url: target.href || target.textContent});
        event.preventDefault();
      }
    };
  }

  return {
    enabled() {
      return enabled;
    },
    toggleEnabled() {
      if (enabled) {
        disable();
      } else {
        enable();
      }
    },
    update
  };
}

function createSection(section) {
  const div = template.section.cloneNode(true);
  const dirty = dirtyReporter();
  let regExpTester = null;

  bindEventGroup(div, {
    '.applies-to-help': {click() {
      showHelp(t('appliesLabel'), t('appliesHelp'));
    }},
    '.remove-section': {click() {
      div.dispatchEvent(new CustomEvent('sectionCommand', {
        bubbles: true,
        detail: {method: 'remove', section}
      }));
    }},
    '.add-section': {click() {
      div.dispatchEvent(new CustomEvent('sectionCommand', {
        bubbles: true,
        detail: {method: 'add', section}
      }));
    }},
    '.beautify-section': {click: beautify},
    '.test-regexp': {click() {
      if (!regExpTester) {
        regExpTester = createRegExpTester(section);
      } else {
        regExpTester.toggleEnabled();
      }
    }}
  });

  const codeElement = div.querySelector('.code');
  codeElement.value = section.code;

  const cm = setupCodeMirror(codeElement);
  div.CodeMirror = cm;
  cm.on('change', () => {
    const value = cm.getValue();
    dirty.modify(section, section.code, value);
    section.code = value;
  });

  setTimeout(() => {
    cm.refresh();
  });

  const appliesTo = div.querySelector('.applies-to-list');
  const appliesToToolbar = createAppliesToToolbar(appliesTo, section);

  toggleTestRegExpVisibility();

  bindEvent(div, {appliesToChange(e) {
    if (e.detail && e.detail.apply && e.detail.apply.type === 'regexp') {
      toggleTestRegExpVisibility();
      if (regExpTester && regExpTester.enabled()) {
        regExpTester.update();
      }
    }
  }});

  function toggleTestRegExpVisibility() {
    const show = Boolean(section.regexps && section.regexps.length);
    div.classList.toggle('has-regexp', show);
  }

  return {
    el: div,
    section,
    isDirty() {
      return dirty.count() || appliesToToolbar.isDirty();
    },
    cleanDirty() {
      dirty.clear();
      appliesToToolbar.cleanDirty();
    },
    hasError: appliesToToolbar.hasError
  };
}

function createSectionEditor(parent, style) {
  const el = template.sectionEditor.cloneNode(true);
  const container = $('.sections-container', el);
  const sectionCtrls = new Map();
  const dirty = dirtyReporter();

  parent.appendChild(el);
  createSections();

  const unbind = bindEvent(container, {sectionCommand(e) {
    const {method, section} = e.detail;
    switch (method) {
      case 'add':
        addSection({code: ''}, section);
        return;
      case 'remove':
        removeSection(section);
        return;
    }
  }});

  function _insertAfter(newSection, refSection) {
    // create ctrl
    const sectionCtrl = createSection(newSection);
    sectionCtrls.set(newSection, sectionCtrl);

    // modify DOM tree
    if (refSection) {
      const refEl = sectionCtrls.get(refSection).el;
      container.insertBefore(sectionCtrl.el, refEl.nextSibling);
    } else {
      container.appendChild(sectionCtrl.el);
    }

    maximizeCodeHeight(
      sectionCtrl.el,
      !refSection || style.sections.indexOf(refSection) === style.sections.length - 1
    );

    const cm = sectionCtrl.el.CodeMirror;
    setTimeout(() => {
      cm.setOption('lint', CodeMirror.defaults.lint);
      updateLintReport(cm, 0);
    }, prefs.get('editor.lintDelay'));

    return sectionCtrl;
  }

  function insertAfter(newSection, refSection) {
    const sectionCtrl = _insertAfter(newSection, refSection);

    // modify style.sections
    let i;
    if (!refSection) {
      i = style.sections.length;
    } else {
      i = style.sections.indexOf(refSection) + 1;
    }
    style.sections.splice(i, 0, newSection);

    // modify dirty
    dirty.add(newSection);

    return sectionCtrl;
  }

  function addSection(section) {
    return insertAfter(section);
  }

  function removeSection(section) {
    const i = style.sections.indexOf(section);
    style.sections.splice(i, 1);
    const {el} = sectionCtrls.get(section);
    container.removeChild(el);
    sectionCtrls.delete(section);
    dirty.remove(section);
  }

  function createSections() {
    const queue = style.sections.slice();
    const queueStart = new Date().getTime();
    // after 100ms the sections will be added asynchronously
    while (new Date().getTime() - queueStart <= 100 && queue.length) {
      add();
    }
    (function processQueue() {
      if (queue.length) {
        add();
        setTimeout(processQueue, 0);
      }
    })();

    function add() {
      _insertAfter(queue.shift());
    }
  }

  return {
    el,
    destroy() {
      unbind();
      parent.removeChild(el);
    },
    isDirty() {
      return dirty.count() || some(sectionCtrls.values(), s => s.isDirty());
    },
    hasError() {
      return some(sectionCtrls.values(), s => s.hasError());
    },
    // used by moz-import
    addSection,
    removeAllSections() {
      for (const section of style.sections.slice()) {
        removeSection(section);
      }
    },
    removeLastEmptySection() {
      const lastSection = style.sections[style.sections.length - 1];
      if (!lastSection) {
        return;
      }
      if (!lastSection.code.trim()) {
        removeSection(lastSection);
      }
    }
  };
}
