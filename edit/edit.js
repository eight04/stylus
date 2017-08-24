/* eslint brace-style: 0, operator-linebreak: 0 */
/* global CodeMirror exports parserlib CSSLint mozParser createSectionEditor */
'use strict';

let style = null;
let editor = null;
let saveSizeOnClose;
let useHistoryBack;   // use browser history back when 'back to manage' is clicked

// direct & reverse mapping of @-moz-document keywords and internal property names
const propertyToCss = {urls: 'url', urlPrefixes: 'url-prefix', domains: 'domain', regexps: 'regexp'};
const CssToProperty = {'url': 'urls', 'url-prefix': 'urlPrefixes', 'domain': 'domains', 'regexp': 'regexps'};

// if background page hasn't been loaded yet, increase the chances it has before DOMContentLoaded
onBackgroundReady();

// make querySelectorAll enumeration code readable
['forEach', 'some', 'indexOf', 'map'].forEach(method => {
  NodeList.prototype[method] = Array.prototype[method];
});

// Chrome pre-34
Element.prototype.matches = Element.prototype.matches || Element.prototype.webkitMatchesSelector;

// Chrome pre-41 polyfill
Element.prototype.closest = Element.prototype.closest || function (selector) {
  let e;
  // eslint-disable-next-line no-empty
  for (e = this; e && !e.matches(selector); e = e.parentElement) {}
  return e;
};

// eslint-disable-next-line no-extend-native
Array.prototype.rotate = function (amount) { // negative amount == rotate left
  const r = this.slice(-amount, this.length);
  Array.prototype.push.apply(r, this.slice(0, this.length - r.length));
  return r;
};

// eslint-disable-next-line no-extend-native
Object.defineProperty(Array.prototype, 'last', {get: function () { return this[this.length - 1]; }});

// preload the theme so that CodeMirror can calculate its metrics in DOMContentLoaded->setupLivePrefs()
new MutationObserver((mutations, observer) => {
  const themeElement = document.getElementById('cm-theme');
  if (themeElement) {
    themeElement.href = prefs.get('editor.theme') === 'default' ? ''
      : 'vendor/codemirror/theme/' + prefs.get('editor.theme') + '.css';
    observer.disconnect();
  }
}).observe(document, {subtree: true, childList: true});

const getTheme = getCodeMirrorThemes();

function initCodeMirrorOptions() {
  // initialize global editor controls
  const themeControl = document.getElementById('editor.theme');
  // Give the select element a default option
  optionsFromArray(themeControl, [theme === 'default' ? ['default', t('defaultTheme')] : theme]);
  themeControl.value = prefs.get('editor.theme');
  // which would be overwitten by getTheme
  getTheme().then(themes => {
    optionsFromArray(themeControl, themes);
    themeControl.value = prefs.get('editor.theme');
  });
  optionsFromArray($('#editor.keyMap'), Object.keys(CodeMirror.keyMap).sort());
  document.getElementById('options').addEventListener('change', acmeEventListener, false);

  function optionsFromArray(parent, options) {
    // options may be an array of [value, textContent] pair
    const fragment = document.createDocumentFragment();
    for (const opt of options) {
      if (typeof opt === 'string') {
        fragment.appendChild($element({tag: 'option', textContent: opt}));
      } else {
        fragment.appendChild($element({tag: 'option', textContent: opt[1], value: opt[0]}));
      }
    }
    parent.appendChild(fragment);
  }
}

function loadCSS(url) {
  return new Promise(resolve => {
    const link = $element({
      tag: 'link',
      rel: 'stylesheet',
      href: url,
      // FIXME: does onload work on <link> in 2017?
      // https://stackoverflow.com/a/13610128
      onload() {
        link.onload = null;
        resolve(link);
      }
    });
    document.head.appendChild(link);
  });
}

function acmeEventListener(event) {
  const el = event.target;
  const option = el.id.replace(/^editor\./, '');
  //console.log('acmeEventListener heard %s on %s', event.type, el.id);
  if (!option) {
    console.error('acmeEventListener: no "cm_option" %O', el);
    return;
  }
  let value = el.type === 'checkbox' ? el.checked : el.value;
  switch (option) {
    case 'tabSize':
      CodeMirror.setGlobalOption('indentUnit', Number(value));
      CodeMirror.setGlobalOption('tabSize', Number(value));
      break;
    case 'theme': {
      const themeLink = document.getElementById('cm-theme');
      const url = value === 'default' ? '' : chrome.runtime.getURL('vendor/codemirror/theme/' + value + '.css');
      if (themeLink.href !== url) { // preloaded in initCodeMirror()
        CodeMirror.setGlobalOption('theme', value);
        break;
      }
      // avoid flicker: wait for the second stylesheet to load, then apply the theme
      loadCSS(url).then(el => {
        themeLink.remove();
        el.id = 'cm-theme';
        CodeMirror.setGlobalOption('theme', value);
      });
      break;
    }
    case 'autocompleteOnTyping':
      CodeMirror.toggleAutocompleteOnTyping(value);
      break;
    case 'matchHighlight':
      switch (value) {
        case 'token':
        case 'selection':
          document.body.dataset[option] = value;
          value = {
            showToken: value === 'token' && /[#.\-\w]/,
            annotateScrollbar: true
          };
          break;
        default:
          value = null;
      }
      CodeMirror.setOption(option, value);
      break;
  }
}

// remind Chrome to repaint a previously invisible editor box by toggling any element's transform
// this bug is present in some versions of Chrome (v37-40 or something)
document.addEventListener('scroll', () => {
  const style = document.getElementById('name').style;
  style.webkitTransform = style.webkitTransform ? '' : 'scale(1)';
});

// Shift-Ctrl-Wheel scrolls entire page even when mouse is over a code editor
document.addEventListener('wheel', event => {
  if (event.shiftKey && event.ctrlKey && !event.altKey && !event.metaKey) {
    // Chrome scrolls horizontally when Shift is pressed but on some PCs this might be different
    window.scrollBy(0, event.deltaX || event.deltaY);
    event.preventDefault();
  }
});

queryTabs({currentWindow: true}).then(tabs => {
  const windowId = tabs[0].windowId;
  if (prefs.get('openEditInWindow')) {
    if (
      sessionStorage.saveSizeOnClose &&
      'left' in prefs.get('windowPosition', {}) &&
      !isWindowMaximized()
    ) {
      // window was reopened via Ctrl-Shift-T etc.
      chrome.windows.update(windowId, prefs.get('windowPosition'));
    }
    if (tabs.length === 1 && window.history.length === 1) {
      chrome.windows.getAll(windows => {
        if (windows.length > 1) {
          sessionStorageHash('saveSizeOnClose').set(windowId, true);
          saveSizeOnClose = true;
        }
      });
    } else {
      saveSizeOnClose = sessionStorageHash('saveSizeOnClose').value[windowId];
    }
  }
  chrome.tabs.onRemoved.addListener((tabId, info) => {
    sessionStorageHash('manageStylesHistory').unset(tabId);
    if (info.windowId === windowId && info.isWindowClosing) {
      sessionStorageHash('saveSizeOnClose').unset(windowId);
    }
  });
});

getActiveTab().then(tab => {
  useHistoryBack = sessionStorageHash('manageStylesHistory').value[tab.id] === location.href;
});

function goBackToManage(event) {
  if (useHistoryBack) {
    event.stopPropagation();
    event.preventDefault();
    history.back();
  }
}

function isWindowMaximized() {
  return window.screenLeft === 0 &&
    window.screenTop === 0 &&
    window.outerWidth === screen.availWidth &&
    window.outerHeight === screen.availHeight;
}

window.onbeforeunload = () => {
  if (saveSizeOnClose && !isWindowMaximized()) {
    prefs.set('windowPosition', {
      left: screenLeft,
      top: screenTop,
      width: outerWidth,
      height: outerHeight
    });
  }
  document.activeElement.blur();
  if (isCleanGlobal()) {
    return;
  }
  updateLintReport(null, 0);
  return confirm(t('styleChangesNotSaved'));
};

function setupGlobalSearch() {
  const originalCommand = {
    find: CodeMirror.commands.find,
    findNext: CodeMirror.commands.findNext,
    findPrev: CodeMirror.commands.findPrev,
    replace: CodeMirror.commands.replace
  };
  const originalOpenDialog = CodeMirror.prototype.openDialog;
  const originalOpenConfirm = CodeMirror.prototype.openConfirm;

  let curState; // cm.state.search for last used 'find'

  function shouldIgnoreCase(query) { // treat all-lowercase non-regexp queries as case-insensitive
    return typeof query === 'string' && !/[A-Z]/.test(query);
  }

  function updateState(cm, newState) {
    if (!newState) {
      if (cm.state.search) {
        return cm.state.search;
      }
      if (!curState) {
        return null;
      }
      newState = curState;
    }
    cm.state.search = {
      query: newState.query,
      overlay: newState.overlay,
      annotate: cm.showMatchesOnScrollbar(newState.query, shouldIgnoreCase(newState.query))
    };
    cm.addOverlay(newState.overlay);
    return cm.state.search;
  }

  // overrides the original openDialog with a clone of the provided template
  function customizeOpenDialog(cm, template, callback) {
    cm.openDialog = (tmpl, cb, opt) => {
      // invoke 'callback' and bind 'this' to the original callback
      originalOpenDialog.call(cm, template.cloneNode(true), callback.bind(cb), opt);
    };
    setTimeout(() => { cm.openDialog = originalOpenDialog; }, 0);
    refocusMinidialog(cm);
  }

  function focusClosestCM(activeCM) {
    editors.lastActive = activeCM;
    const cm = getEditorInSight();
    if (cm !== activeCM) {
      cm.focus();
    }
    return cm;
  }

  function find(activeCM) {
    activeCM = focusClosestCM(activeCM);
    customizeOpenDialog(activeCM, template.find, function (query) {
      this(query);
      curState = activeCM.state.search;
      if (editors.length === 1 || !curState.query) {
        return;
      }
      editors.forEach(cm => {
        if (cm !== activeCM) {
          cm.execCommand('clearSearch');
          updateState(cm, curState);
        }
      });
      if (CodeMirror.cmpPos(curState.posFrom, curState.posTo) === 0) {
        findNext(activeCM);
      }
    });
    originalCommand.find(activeCM);
  }

  function findNext(activeCM, reverse) {
    let state = updateState(activeCM);
    if (!state || !state.query) {
      find(activeCM);
      return;
    }
    let pos = activeCM.getCursor(reverse ? 'from' : 'to');
    activeCM.setSelection(activeCM.getCursor()); // clear the selection, don't move the cursor

    const rxQuery = typeof state.query === 'object'
      ? state.query : stringAsRegExp(state.query, shouldIgnoreCase(state.query) ? 'i' : '');

    if (
      document.activeElement &&
      document.activeElement.name === 'applies-value' &&
      searchAppliesTo(activeCM)
    ) {
      return;
    }
    let cm = activeCM;
    for (let i = 0; i < editors.length; i++) {
      state = updateState(cm);
      if (!cm.hasFocus()) {
        pos = reverse ? CodeMirror.Pos(cm.lastLine()) : CodeMirror.Pos(0, 0);
      }
      const searchCursor = cm.getSearchCursor(state.query, pos, shouldIgnoreCase(state.query));
      if (searchCursor.find(reverse)) {
        if (editors.length > 1) {
          makeSectionVisible(cm);
          cm.focus();
        }
        // speedup the original findNext
        state.posFrom = reverse ? searchCursor.to() : searchCursor.from();
        state.posTo = CodeMirror.Pos(state.posFrom.line, state.posFrom.ch);
        originalCommand[reverse ? 'findPrev' : 'findNext'](cm);
        return;
      } else if (!reverse && searchAppliesTo(cm)) {
        return;
      }
      cm = editors[(editors.indexOf(cm) + (reverse ? -1 + editors.length : 1)) % editors.length];
      if (reverse && searchAppliesTo(cm)) {
        return;
      }
    }
    // nothing found so far, so call the original search with wrap-around
    originalCommand[reverse ? 'findPrev' : 'findNext'](activeCM);

    function searchAppliesTo(cm) {
      let inputs = [].slice.call(cm.getSection().querySelectorAll('.applies-value'));
      if (reverse) {
        inputs = inputs.reverse();
      }
      inputs.splice(0, inputs.indexOf(document.activeElement) + 1);
      return inputs.some(input => {
        const match = rxQuery.exec(input.value);
        if (match) {
          input.focus();
          const end = match.index + match[0].length;
          // scroll selected part into view in long inputs,
          // works only outside of current event handlers chain, hence timeout=0
          setTimeout(() => {
            input.setSelectionRange(end, end);
            input.setSelectionRange(match.index, end);
          }, 0);
          return true;
        }
      });
    }
  }

  function findPrev(cm) {
    findNext(cm, true);
  }

  function replace(activeCM, all) {
    let queue;
    let query;
    let replacement;
    activeCM = focusClosestCM(activeCM);
    customizeOpenDialog(activeCM, template[all ? 'replaceAll' : 'replace'], txt => {
      query = txt;
      customizeOpenDialog(activeCM, template.replaceWith, txt => {
        replacement = txt;
        queue = editors.rotate(-editors.indexOf(activeCM));
        if (all) {
          editors.forEach(doReplace);
        } else {
          doReplace();
        }
      });
      this(query);
    });
    originalCommand.replace(activeCM, all);

    function doReplace() {
      const cm = queue.shift();
      if (!cm) {
        if (!all) {
          editors.lastActive.focus();
        }
        return;
      }
      // hide the first two dialogs (replace, replaceWith)
      cm.openDialog = (tmpl, callback) => {
        cm.openDialog = (tmpl, callback) => {
          cm.openDialog = originalOpenDialog;
          if (all) {
            callback(replacement);
          } else {
            doConfirm(cm);
            callback(replacement);
            if (!cm.getWrapperElement().querySelector('.CodeMirror-dialog')) {
              // no dialog == nothing found in the current CM, move to the next
              doReplace();
            }
          }
        };
        callback(query);
      };
      originalCommand.replace(cm, all);
    }
    function doConfirm(cm) {
      let wrapAround = false;
      const origPos = cm.getCursor();
      cm.openConfirm = function overrideConfirm(tmpl, callbacks, opt) {
        const ovrCallbacks = callbacks.map(callback => () => {
          makeSectionVisible(cm);
          cm.openConfirm = overrideConfirm;
          setTimeout(() => { cm.openConfirm = originalOpenConfirm; }, 0);

          const pos = cm.getCursor();
          callback();
          const cmp = CodeMirror.cmpPos(cm.getCursor(), pos);
          wrapAround |= cmp <= 0;

          const dlg = cm.getWrapperElement().querySelector('.CodeMirror-dialog');
          if (!dlg || cmp === 0 || wrapAround && CodeMirror.cmpPos(cm.getCursor(), origPos) >= 0) {
            if (dlg) {
              dlg.remove();
            }
            doReplace();
          }
        });
        originalOpenConfirm.call(cm, template.replaceConfirm.cloneNode(true), ovrCallbacks, opt);
      };
    }
  }

  function replaceAll(cm) {
    replace(cm, true);
  }

  CodeMirror.commands.find = find;
  CodeMirror.commands.findNext = findNext;
  CodeMirror.commands.findPrev = findPrev;
  CodeMirror.commands.replace = replace;
  CodeMirror.commands.replaceAll = replaceAll;
}

function jumpToLine(cm) {
  const cur = cm.getCursor();
  refocusMinidialog(cm);
  cm.openDialog(template.jumpToLine.cloneNode(true), str => {
    const m = str.match(/^\s*(\d+)(?:\s*:\s*(\d+))?\s*$/);
    if (m) {
      cm.setCursor(m[1] - 1, m[2] ? m[2] - 1 : cur.ch);
    }
  }, {value: cur.line + 1});
}

function toggleStyle() {
  $('#enabled').checked = !$('#enabled').checked;
  save();
}

function toggleSectionHeight(cm) {
  if (cm.state.toggleHeightSaved) {
    // restore previous size
    cm.setSize(null, cm.state.toggleHeightSaved);
    cm.state.toggleHeightSaved = 0;
  } else {
    // maximize
    const wrapper = cm.display.wrapper;
    const allBounds = $('#sections').getBoundingClientRect();
    const pageExtrasHeight = allBounds.top + window.scrollY +
      parseFloat(getComputedStyle($('#sections')).paddingBottom);
    const sectionExtrasHeight = cm.getSection().clientHeight - wrapper.offsetHeight;
    cm.state.toggleHeightSaved = wrapper.clientHeight;
    cm.setSize(null, window.innerHeight - sectionExtrasHeight - pageExtrasHeight);
    const bounds = cm.getSection().getBoundingClientRect();
    if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
      window.scrollBy(0, bounds.top);
    }
  }
}

function autocompleteOnTyping(cm, info, debounced) {
  if (
    cm.state.completionActive ||
    info.origin && !info.origin.includes('input') ||
    !info.text.last
  ) {
    return;
  }
  if (cm.state.autocompletePicked) {
    cm.state.autocompletePicked = false;
    return;
  }
  if (!debounced) {
    debounce(autocompleteOnTyping, 100, cm, info, true);
    return;
  }
  if (info.text.last.match(/[-\w!]+$/)) {
    cm.state.autocompletePicked = false;
    cm.options.hintOptions.completeSingle = false;
    cm.execCommand('autocomplete');
    setTimeout(() => {
      cm.options.hintOptions.completeSingle = true;
    });
  }
}

function autocompletePicked(cm) {
  cm.state.autocompletePicked = true;
}

function refocusMinidialog(cm) {
  const section = cm.getSection();
  if (!section.querySelector('.CodeMirror-dialog')) {
    return;
  }
  // close the currently opened minidialog
  cm.focus();
  // make sure to focus the input in newly opened minidialog
  setTimeout(() => {
    section.querySelector('.CodeMirror-dialog').focus();
  }, 0);
}

function nextPrevEditor(cm, direction) {
  cm = editors[(editors.indexOf(cm) + direction + editors.length) % editors.length];
  makeSectionVisible(cm);
  cm.focus();
}

function getEditorInSight(nearbyElement) {
  // priority: 1. associated CM for applies-to element 2. last active if visible 3. first visible
  let cm;
  if (nearbyElement && nearbyElement.className.indexOf('applies-') >= 0) {
    cm = getSectionForChild(nearbyElement).CodeMirror;
  } else {
    cm = editors.lastActive;
  }
  if (!cm || offscreenDistance(cm) > 0) {
    const sorted = editors
      .map((cm, index) => ({cm: cm, distance: offscreenDistance(cm), index: index}))
      .sort((a, b) => a.distance - b.distance || a.index - b.index);
    cm = sorted[0].cm;
    if (sorted[0].distance > 0) {
      makeSectionVisible(cm);
    }
  }
  return cm;

  function offscreenDistance(cm) {
    const LINES_VISIBLE = 2; // closest editor should have at least # lines visible
    const bounds = cm.getSection().getBoundingClientRect();
    if (bounds.top < 0) {
      return -bounds.top;
    } else if (bounds.top < window.innerHeight - cm.defaultTextHeight() * LINES_VISIBLE) {
      return 0;
    } else {
      return bounds.top - bounds.height;
    }
  }
}

function updateLintReport(cm, delay) {
  if (delay === 0) {
    // immediately show pending csslint messages in onbeforeunload and save
    update(cm);
    return;
  }
  if (delay > 0) {
    setTimeout(cm => { cm.performLint(); update(cm); }, delay, cm);
    return;
  }
  // eslint-disable-next-line no-var
  var state = cm.state.lint;
  if (!state) {
    return;
  }
  // user is editing right now: postpone updating the report for the new issues (default: 500ms lint + 4500ms)
  // or update it as soon as possible (default: 500ms lint + 100ms) in case an existing issue was just fixed
  clearTimeout(state.reportTimeout);
  state.reportTimeout = setTimeout(update, state.options.delay + 100, cm);
  state.postponeNewIssues = delay === undefined || delay === null;

  function update(cm) {
    const scope = cm ? [cm] : editors;
    let changed = false;
    let fixedOldIssues = false;
    scope.forEach(cm => {
      const scopedState = cm.state.lint || {};
      const oldMarkers = scopedState.markedLast || {};
      const newMarkers = {};
      const html = !scopedState.marked || scopedState.marked.length === 0 ? '' : '<tbody>' +
        scopedState.marked.map(mark => {
          const info = mark.__annotation;
          const isActiveLine = info.from.line === cm.getCursor().line;
          const pos = isActiveLine ? 'cursor' : (info.from.line + ',' + info.from.ch);
          let message = escapeHtml(info.message.replace(/ at line \d.+$/, ''));
          if (message.length > 100) {
            message = message.substr(0, 100) + '...';
          }
          if (isActiveLine || oldMarkers[pos] === message) {
            delete oldMarkers[pos];
          }
          newMarkers[pos] = message;
          return '<tr class="' + info.severity + '">' +
            '<td role="severity" class="CodeMirror-lint-marker-' + info.severity + '">' +
              info.severity + '</td>' +
            '<td role="line">' + (info.from.line + 1) + '</td>' +
            '<td role="sep">:</td>' +
            '<td role="col">' + (info.from.ch + 1) + '</td>' +
            '<td role="message">' + message + '</td></tr>';
        }).join('') + '</tbody>';
      scopedState.markedLast = newMarkers;
      fixedOldIssues |= scopedState.reportDisplayed && Object.keys(oldMarkers).length > 0;
      if (scopedState.html !== html) {
        scopedState.html = html;
        changed = true;
      }
    });
    if (changed) {
      clearTimeout(state ? state.renderTimeout : undefined);
      if (!state || !state.postponeNewIssues || fixedOldIssues) {
        renderLintReport(true);
      } else {
        state.renderTimeout = setTimeout(() => {
          renderLintReport(true);
        }, CodeMirror.defaults.lintReportDelay);
      }
    }
  }
  function escapeHtml(html) {
    const chars = {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;'};
    return html.replace(/[&<>"'/]/g, char => chars[char]);
  }
}

function renderLintReport(someBlockChanged) {
  const container = document.getElementById('lint');
  const content = container.children[1];
  const label = t('sectionCode');
  const newContent = content.cloneNode(false);
  let issueCount = 0;
  editors.forEach((cm, index) => {
    if (cm.state.lint && cm.state.lint.html) {
      const html = '<caption>' + label + ' ' + (index + 1) + '</caption>' + cm.state.lint.html;
      const newBlock = newContent.appendChild(tHTML(html, 'table'));

      newBlock.cm = cm;
      issueCount += newBlock.rows.length;

      const block = content.children[newContent.children.length - 1];
      const blockChanged = !block || cm !== block.cm || html !== block.innerHTML;
      someBlockChanged |= blockChanged;
      cm.state.lint.reportDisplayed = blockChanged;
    }
  });
  if (someBlockChanged || newContent.children.length !== content.children.length) {
    document.getElementById('issue-count').textContent = issueCount;
    container.replaceChild(newContent, content);
    container.style.display = newContent.children.length ? 'block' : 'none';
    resizeLintReport(null, newContent);
  }
}

function resizeLintReport(event, content) {
  content = content || document.getElementById('lint').children[1];
  if (content.children.length) {
    const bounds = content.getBoundingClientRect();
    const newMaxHeight = bounds.bottom <= innerHeight ? '' : (innerHeight - bounds.top) + 'px';
    if (newMaxHeight !== content.style.maxHeight) {
      content.style.maxHeight = newMaxHeight;
    }
  }
}

function gotoLintIssue(event) {
  const issue = event.target.closest('tr');
  if (!issue) {
    return;
  }
  const block = issue.closest('table');
  makeSectionVisible(block.cm);
  block.cm.focus();
  block.cm.setSelection({
    line: parseInt(issue.querySelector('td[role="line"]').textContent) - 1,
    ch: parseInt(issue.querySelector('td[role="col"]').textContent) - 1
  });
}

function toggleLintReport() {
  document.getElementById('lint').classList.toggle('collapsed');
}

function beautify(event) {
  if (exports.css_beautify) { // thanks to csslint's definition of 'exports'
    doBeautify();
  } else {
    const script = document.head.appendChild(document.createElement('script'));
    script.src = 'vendor-overwrites/beautify/beautify-css-mod.js';
    script.onload = doBeautify;
  }
  function doBeautify() {
    const tabs = prefs.get('editor.indentWithTabs');
    const options = prefs.get('editor.beautify');
    options.indent_size = tabs ? 1 : prefs.get('editor.tabSize');
    options.indent_char = tabs ? '\t' : ' ';

    const section = getSectionForChild(event.target);
    const scope = section ? [section.CodeMirror] : editors;

    showHelp(t('styleBeautify'), '<div class="beautify-options">' +
      optionHtml('.selector1,', 'selector_separator_newline') +
      optionHtml('.selector2,', 'newline_before_open_brace') +
      optionHtml('{', 'newline_after_open_brace') +
      optionHtml('border: none;', 'newline_between_properties', true) +
      optionHtml('display: block;', 'newline_before_close_brace', true) +
      optionHtml('}', 'newline_between_rules') +
      `<label style="display: block; clear: both;"><input data-option="indent_conditional" type="checkbox"
        ${options.indent_conditional !== false ? 'checked' : ''}>` +
        t('styleBeautifyIndentConditional') + '</label>' +
      '</div>' +
      '<div><button role="undo"></button></div>');

    const undoButton = document.querySelector('#help-popup button[role="undo"]');
    undoButton.textContent = t(scope.length === 1 ? 'undo' : 'undoGlobal');
    undoButton.addEventListener('click', () => {
      let undoable = false;
      scope.forEach(cm => {
        if (cm.beautifyChange && cm.beautifyChange[cm.changeGeneration()]) {
          delete cm.beautifyChange[cm.changeGeneration()];
          cm.undo();
          cm.scrollIntoView(cm.getCursor());
          undoable |= cm.beautifyChange[cm.changeGeneration()];
        }
      });
      undoButton.disabled = !undoable;
    });

    scope.forEach(cm => {
      setTimeout(() => {
        const pos = options.translate_positions =
          [].concat.apply([], cm.doc.sel.ranges.map(r =>
            [Object.assign({}, r.anchor), Object.assign({}, r.head)]));
        const text = cm.getValue();
        const newText = exports.css_beautify(text, options);
        if (newText !== text) {
          if (!cm.beautifyChange || !cm.beautifyChange[cm.changeGeneration()]) {
            // clear the list if last change wasn't a css-beautify
            cm.beautifyChange = {};
          }
          cm.setValue(newText);
          const selections = [];
          for (let i = 0; i < pos.length; i += 2) {
            selections.push({anchor: pos[i], head: pos[i + 1]});
          }
          cm.setSelections(selections);
          cm.beautifyChange[cm.changeGeneration()] = true;
          undoButton.disabled = false;
        }
      }, 0);
    });

    document.querySelector('.beautify-options').onchange = ({target}) => {
      const value = target.type === 'checkbox' ? target.checked : target.selectedIndex > 0;
      prefs.set('editor.beautify', Object.assign(options, {[target.dataset.option]: value}));
      if (target.parentNode.hasAttribute('newline')) {
        target.parentNode.setAttribute('newline', value.toString());
      }
      doBeautify();
    };

    function optionHtml(label, optionName, indent) {
      const value = options[optionName];
      return '<div newline="' + value.toString() + '">' +
        '<span' + (indent ? ' indent' : '') + '>' + label + '</span>' +
        '<select data-option="' + optionName + '">' +
          '<option' + (value ? '' : ' selected') + '>&nbsp;</option>' +
          '<option' + (value ? ' selected' : '') + '>\\n</option>' +
        '</select></div>';
    }
  }
}

document.addEventListener('DOMContentLoaded', init);

function init() {
  initCodeMirrorOptions();
  setupLivePrefs();
  const params = getParams();
  if (!params.id) { // match should be 2 - one for the whole thing, one for the parentheses
    // This is an add
    $('#heading').textContent = t('addStyleTitle');
    const section = {code: ''};
    for (const i in CssToProperty) {
      if (params[i]) {
        section[CssToProperty[i]] = [params[i]];
      }
    }
    style = {
      name: '',
      sections: [section]
    };
    window.onload = () => {
      window.onload = null;
      initWithStyle({style});
    };
    return;
  }
  // This is an edit
  $('#heading').textContent = t('editStyleHeading');
  getStylesSafe({id: params.id}).then(styles => {
    style = styles[0];
    if (!style) {
      style = {id: null, sections: []};
      history.replaceState({}, document.title, location.pathname);
    }
    styleId = style.id;
    sessionStorage.justEditedStyleId = styleId;
    setStyleMeta(style);
    window.onload = () => {
      window.onload = null;
      initWithStyle({style});
    };
    if (document.readyState !== 'loading') {
      window.onload();
    }
  });
}

function setStyleMeta(style) {
  document.getElementById('name').value = style.name;
  document.getElementById('name').disabled = Boolean(style.usercss);
  document.getElementById('enabled').checked = style.enabled;
  document.getElementById('url').href = style.url;
}

function initWithStyle({style, codeIsUpdated}) {
  setStyleMeta(style);

  if (codeIsUpdated === false) {
    setCleanGlobal();
    updateTitle();
    return;
  }

  // if this was done in response to an update, we need to clear existing editors
  if (editor) {
    editor.destroy();
  }
  if (style.usercss) {
    editor = createSourceEditor($('#main-editor'), style);
  } else {
    editor = createSectionEditor($('#main-editor'), style);
  }
  initHooks();
}

function initHooks() {
  document.querySelectorAll('#header .style-contributor').forEach(node => {
    node.addEventListener('change', updateTitle);
    node.addEventListener('input', updateTitle);
  });
  document.getElementById('toggle-style-help').addEventListener('click', showToggleStyleHelp);
  document.getElementById('to-mozilla').addEventListener('click', showMozillaFormat, false);
  document.getElementById('to-mozilla-help').addEventListener('click', showToMozillaHelp, false);
  document.getElementById('from-mozilla').addEventListener('click', fromMozillaFormat);
  document.getElementById('beautify').addEventListener('click', beautify);
  document.getElementById('save-button').addEventListener('click', save, false);
  document.getElementById('sections-help').addEventListener('click', showSectionHelp, false);
  document.getElementById('keyMap-help').addEventListener('click', showKeyMapHelp, false);
  document.getElementById('cancel-button').addEventListener('click', goBackToManage);
  document.getElementById('lint-help').addEventListener('click', showLintHelp);
  document.getElementById('lint').addEventListener('click', gotoLintIssue);
  window.addEventListener('resize', resizeLintReport);

  // touch devices don't have onHover events so the element we'll be toggled via clicking (touching)
  if ('ontouchstart' in document.body) {
    document.querySelector('#lint h2').addEventListener('click', toggleLintReport);
  }

  if (!FIREFOX) {
    $$([
      'input:not([type])',
      'input[type="text"]',
      'input[type="search"]',
      'input[type="number"]',
    ].join(',')
    ).forEach(e => e.addEventListener('mousedown', toggleContextMenuDelete));
  }

  setupGlobalSearch();
  setCleanGlobal();
  updateTitle();
}


function toggleContextMenuDelete(event) {
  if (event.button === 2 && prefs.get('editor.contextDelete')) {
    chrome.contextMenus.update('editor.contextDelete', {
      enabled: Boolean(
        this.selectionStart !== this.selectionEnd ||
        this.somethingSelected && this.somethingSelected()
      ),
    }, ignoreChromeError);
  }
}


function maximizeCodeHeight(sectionDiv, isLast) {
  const cm = sectionDiv.CodeMirror;
  const stats = maximizeCodeHeight.stats = maximizeCodeHeight.stats || {totalHeight: 0, deltas: []};
  if (!stats.cmActualHeight) {
    stats.cmActualHeight = getComputedHeight(cm.display.wrapper);
  }
  if (!stats.sectionMarginTop) {
    stats.sectionMarginTop = parseFloat(getComputedStyle(sectionDiv).marginTop);
  }
  const sectionTop = sectionDiv.getBoundingClientRect().top - stats.sectionMarginTop;
  if (!stats.firstSectionTop) {
    stats.firstSectionTop = sectionTop;
  }
  const extrasHeight = getComputedHeight(sectionDiv) - stats.cmActualHeight;
  const cmMaxHeight = window.innerHeight - extrasHeight - sectionTop - stats.sectionMarginTop;
  const cmDesiredHeight = cm.display.sizer.clientHeight + 2 * cm.defaultTextHeight();
  const cmGrantableHeight = Math.max(stats.cmActualHeight, Math.min(cmMaxHeight, cmDesiredHeight));
  stats.deltas.push(cmGrantableHeight - stats.cmActualHeight);
  stats.totalHeight += cmGrantableHeight + extrasHeight;
  if (!isLast) {
    return;
  }
  stats.totalHeight += stats.firstSectionTop;
  if (stats.totalHeight <= window.innerHeight) {
    editors.forEach((cm, index) => {
      cm.setSize(null, stats.deltas[index] + stats.cmActualHeight);
    });
    return;
  }
  // scale heights to fill the gap between last section and bottom edge of the window
  const sections = document.getElementById('sections');
  const available = window.innerHeight - sections.getBoundingClientRect().bottom -
    parseFloat(getComputedStyle(sections).marginBottom);
  if (available <= 0) {
    return;
  }
  const totalDelta = stats.deltas.reduce((sum, d) => sum + d, 0);
  const q = available / totalDelta;
  const baseHeight = stats.cmActualHeight - stats.sectionMarginTop;
  stats.deltas.forEach((delta, index) => {
    editors[index].setSize(null, baseHeight + Math.floor(q * delta));
  });
}

function updateTitle() {
  const DIRTY_TITLE = '* $';

  const name = document.getElementById('name').savedValue;
  const clean = !editor.isDirty();
  const title = styleId === null ? t('addStyleTitle') : t('editStyleTitle', [name]);
  document.title = clean ? title : DIRTY_TITLE.replace('$', title);
}

function validate() {
  const name = document.getElementById('name').value;
  if (name === '') {
    return t('styleMissingName');
  }
  // validate the regexps
  if (document.querySelectorAll('.applies-to-list').some(list => {
    list.childNodes.some(li => {
      if (li.className === template.appliesToEverything.className) {
        return false;
      }
      const valueElement = li.querySelector('[name=applies-value]');
      const type = li.querySelector('[name=applies-type]').value;
      const value = valueElement.value;
      if (type && value) {
        if (type === 'regexp') {
          try {
            new RegExp(value);
          } catch (ex) {
            valueElement.focus();
            return true;
          }
        }
      }
      return false;
    });
  })) {
    return t('styleBadRegexp');
  }
  return null;
}

function save() {
  updateLintReport(null, 0);

  // save the contents of the CodeMirror editors back into the textareas
  for (let i = 0; i < editors.length; i++) {
    editors[i].save();
  }

  const error = validate();
  if (error) {
    alert(error);
    return;
  }
  const name = document.getElementById('name').value;
  const enabled = document.getElementById('enabled').checked;
  saveStyleSafe({
    id: styleId,
    name: name,
    enabled: enabled,
    reason: 'editSave',
    sections: getSectionsHashes()
  })
    .then(saveComplete);
}

function getSectionsHashes() {
  const sections = [];
  getSections().forEach(div => {
    const meta = getMeta(div);
    const code = div.CodeMirror.getValue();
    if (/^\s*$/.test(code) && Object.keys(meta).length === 0) {
      return;
    }
    meta.code = code;
    sections.push(meta);
  });
  return sections;
}

function getMeta(e) {
  const meta = {urls: [], urlPrefixes: [], domains: [], regexps: []};
  e.querySelector('.applies-to-list').childNodes.forEach(li => {
    if (li.className === template.appliesToEverything.className) {
      return;
    }
    const type = li.querySelector('[name=applies-type]').value;
    const value = li.querySelector('[name=applies-value]').value;
    if (type && value) {
      const property = CssToProperty[type];
      meta[property].push(value);
    }
  });
  return meta;
}

function saveComplete(style) {
  styleId = style.id;
  sessionStorage.justEditedStyleId = styleId;
  setCleanGlobal();

  // Go from new style URL to edit style URL
  if (location.href.indexOf('id=') === -1) {
    history.replaceState({}, document.title, 'edit.html?id=' + style.id);
    $('#heading').textContent = t('editStyleHeading');
  }
  updateTitle();
}

function showMozillaFormat() {
  const popup = showCodeMirrorPopup(t('styleToMozillaFormatTitle'), '', {readOnly: true});
  popup.codebox.setValue(toMozillaFormat());
  popup.codebox.execCommand('selectAll');
}

function toMozillaFormat() {
  return mozParser.format({sections: getSectionsHashes()});
}

function fromMozillaFormat() {
  const popup = showCodeMirrorPopup(t('styleFromMozillaFormatPrompt'), tHTML(`<div>
      <button name="import-append" i18n-text="importAppendLabel" i18n-title="importAppendTooltip"></button>
      <button name="import-replace" i18n-text="importReplaceLabel" i18n-title="importReplaceTooltip"></button>
    </div>`
  ));

  const contents = popup.querySelector('.contents');
  contents.insertBefore(popup.codebox.display.wrapper, contents.firstElementChild);
  popup.codebox.focus();

  popup.querySelector('[name="import-append"]').addEventListener('click', doImport);
  popup.querySelector('[name="import-replace"]').addEventListener('click', doImport);

  popup.codebox.on('change', () => {
    clearTimeout(popup.mozillaTimeout);
    popup.mozillaTimeout = setTimeout(() => {
      popup.classList.toggle('ready', trimNewLines(popup.codebox.getValue()));
    }, 100);
  });

  function doImport() {
    const replaceOldStyle = this.name === 'import-replace';
    popup.querySelector('.dismiss').onclick();
    const mozStyle = trimNewLines(popup.codebox.getValue());

    mozParser.parse(mozStyle).then(sections => {
      if (replaceOldStyle) {
        editor.removeAllSections();
      }

      // nuke the last blank section
      editor.removeLastEmptySection();

      const firstSection = sections[0];
      editor.addSection(firstSection);
      const firstAddedCM = editors.last;
      for (const section of sections.slice(1)) {
        editor.addSection(section);
      }

      delete maximizeCodeHeight.stats;
      editors.forEach(cm => {
        maximizeCodeHeight(cm.getSection(), cm === editors.last);
      });

      makeSectionVisible(firstAddedCM);
      firstAddedCM.focus();
    }, errors => {
      showHelp(t('issues'), $element({
        tag: 'pre',
        textContent: errors.join('\n'),
      }));
    });
  }
  function trimNewLines(s) {
    return s.replace(/^[\s\n]+/, '').replace(/[\s\n]+$/, '');
  }
}

function showSectionHelp() {
  showHelp(t('styleSectionsTitle'), t('sectionHelp'));
}

function showToMozillaHelp() {
  showHelp(t('styleMozillaFormatHeading'), t('styleToMozillaFormatHelp'));
}

function showToggleStyleHelp() {
  showHelp(t('helpAlt'), t('styleEnabledToggleHint'));
}

function showKeyMapHelp() {
  const keyMap = mergeKeyMaps({}, prefs.get('editor.keyMap'), CodeMirror.defaults.extraKeys);
  const keyMapSorted = Object.keys(keyMap)
    .map(key => ({key: key, cmd: keyMap[key]}))
    .concat([{key: 'Shift-Ctrl-Wheel', cmd: 'scrollWindow'}])
    .sort((a, b) => (a.cmd < b.cmd || (a.cmd === b.cmd && a.key < b.key) ? -1 : 1));
  showHelp(t('cm_keyMap') + ': ' + prefs.get('editor.keyMap'),
    '<table class="keymap-list">' +
      '<thead><tr><th><input placeholder="' + t('helpKeyMapHotkey') + '" type="search"></th>' +
        '<th><input placeholder="' + t('helpKeyMapCommand') + '" type="search"></th></tr></thead>' +
      '<tbody>' + keyMapSorted.map(value =>
        '<tr><td>' + value.key + '</td><td>' + value.cmd + '</td></tr>'
      ).join('') +
      '</tbody>' +
    '</table>');

  const table = document.querySelector('#help-popup table');
  table.addEventListener('input', filterTable);

  const inputs = table.querySelectorAll('input');
  inputs[0].addEventListener('keydown', hotkeyHandler);
  inputs[1].focus();

  function hotkeyHandler(event) {
    const keyName = CodeMirror.keyName(event);
    if (keyName === 'Esc' || keyName === 'Tab' || keyName === 'Shift-Tab') {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    // normalize order of modifiers,
    // for modifier-only keys ('Ctrl-Shift') a dummy main key has to be temporarily added
    const keyMap = {};
    keyMap[keyName.replace(/(Shift|Ctrl|Alt|Cmd)$/, '$&-dummy')] = '';
    const normalizedKey = Object.keys(CodeMirror.normalizeKeyMap(keyMap))[0];
    this.value = normalizedKey.replace('-dummy', '');
    filterTable(event);
  }

  function filterTable(event) {
    const input = event.target;
    const col = input.parentNode.cellIndex;
    inputs[1 - col].value = '';
    table.tBodies[0].childNodes.forEach(row => {
      const cell = row.children[col];
      const text = cell.textContent;
      const query = stringAsRegExp(input.value, 'gi');
      const test = query.test(text);
      row.style.display = input.value && test === false ? 'none' : '';
      if (input.value && test) {
        cell.textContent = '';
        let offset = 0;
        text.replace(query, (match, index) => {
          if (index > offset) {
            cell.appendChild(document.createTextNode(text.substring(offset, index)));
          }
          cell.appendChild($element({tag: 'mark', textContent: match}));
          offset = index + match.length;
        });
        if (offset + 1 !== text.length) {
          cell.appendChild(document.createTextNode(text.substring(offset)));
        }
      }
      else {
        cell.textContent = text;
      }
      // clear highlight from the other column
      const otherCell = row.children[1 - col];
      if (otherCell.children.length) {
        const text = otherCell.textContent;
        otherCell.textContent = text;
      }
    });
  }
  function mergeKeyMaps(merged, ...more) {
    more.forEach(keyMap => {
      if (typeof keyMap === 'string') {
        keyMap = CodeMirror.keyMap[keyMap];
      }
      Object.keys(keyMap).forEach(key => {
        let cmd = keyMap[key];
        // filter out '...', 'attach', etc. (hotkeys start with an uppercase letter)
        if (!merged[key] && !key.match(/^[a-z]/) && cmd !== '...') {
          if (typeof cmd === 'function') {
            // for 'emacs' keymap: provide at least something meaningful (hotkeys and the function body)
            // for 'vim*' keymaps: almost nothing as it doesn't rely on CM keymap mechanism
            cmd = cmd.toString().replace(/^function.*?\{[\s\r\n]*([\s\S]+?)[\s\r\n]*\}$/, '$1');
            merged[key] = cmd.length <= 200 ? cmd : cmd.substr(0, 200) + '...';
          } else {
            merged[key] = cmd;
          }
        }
      });
      if (keyMap.fallthrough) {
        merged = mergeKeyMaps(merged, keyMap.fallthrough);
      }
    });
    return merged;
  }
}

function showLintHelp() {
  showHelp(t('issues'), t('issuesHelp') + '<ul>' +
    CSSLint.getRules().map(rule =>
      '<li><b>' + rule.name + '</b><br>' + rule.desc + '</li>'
    ).join('') + '</ul>'
  );
}

function showHelp(title, body, onclose) {
  const div = $('#help-popup');
  div.classList.remove('big');
  $('.contents', div).textContent = '';
  $('.contents', div).appendChild(typeof body === 'string' ? tHTML(body) : body);
  $('.title', div).textContent = title;

  if (getComputedStyle(div).display === 'none') {
    document.addEventListener('keydown', closeHelp);
    div.querySelector('.dismiss').onclick = closeHelp; // avoid chaining on multiple showHelp() calls
  }
  div.style.display = 'block';
  showHelp.onclose = onclose;
  return div;

  function closeHelp(e) {
    if (
      !e ||
      e.type === 'click' ||
      ((e.keyCode || e.which) === 27 && !e.altKey && !e.ctrlKey && !e.shiftKey && !e.metaKey)
    ) {
      div.style.display = '';
      document.querySelector('.contents').textContent = '';
      document.removeEventListener('keydown', closeHelp);
      if (showHelp.onclose) {
        showHelp.onclose();
        showHelp.onclose = null;
      }
    }
  }
}

function hideHelp() {
  const div = $('#help-popup');
  div.style.display = '';
}

function showCodeMirrorPopup(title, html, options) {
  const popup = showHelp(title, html);
  popup.classList.add('big');

  popup.codebox = CodeMirror(popup.querySelector('.contents'), Object.assign({
    mode: 'css',
    lineNumbers: true,
    lineWrapping: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter', 'CodeMirror-lint-markers'],
    matchBrackets: true,
    lint: {getAnnotations: CodeMirror.lint.css, delay: 0},
    styleActiveLine: true,
    theme: prefs.get('editor.theme'),
    keyMap: prefs.get('editor.keyMap')
  }, options));
  popup.codebox.focus();
  popup.codebox.on('focus', () => { hotkeyRerouter.setState(false); });
  popup.codebox.on('blur', () => { hotkeyRerouter.setState(true); });
  return popup;
}

function getParams() {
  const params = {};
  const urlParts = location.href.split('?', 2);
  if (urlParts.length === 1) {
    return params;
  }
  urlParts[1].split('&').forEach(keyValue => {
    const splitKeyValue = keyValue.split('=', 2);
    params[decodeURIComponent(splitKeyValue[0])] = decodeURIComponent(splitKeyValue[1]);
  });
  return params;
}

chrome.runtime.onMessage.addListener(onRuntimeMessage);

function onRuntimeMessage(request) {
  switch (request.method) {
    case 'styleUpdated':
      if (styleId && styleId === request.style.id && request.reason !== 'editSave') {
        if ((request.style.sections[0] || {}).code === null) {
          // the code-less style came from notifyAllTabs
          onBackgroundReady().then(() => {
            request.style = BG.cachedStyles.byId.get(request.style.id);
            initWithStyle(request);
          });
        } else {
          initWithStyle(request);
        }
      }
      break;
    case 'styleDeleted':
      if (styleId && styleId === request.id) {
        window.onbeforeunload = () => {};
        window.close();
        break;
      }
      break;
    case 'prefChanged':
      if ('editor.smartIndent' in request.prefs) {
        CodeMirror.setOption('smartIndent', request.prefs['editor.smartIndent']);
      }
      break;
    case 'editDeleteText':
      document.execCommand('delete');
      break;
  }
}

function getComputedHeight(el) {
  const compStyle = getComputedStyle(el);
  return el.getBoundingClientRect().height +
    parseFloat(compStyle.marginTop) + parseFloat(compStyle.marginBottom);
}


function getCodeMirrorThemes() {
  if (!chrome.runtime.getPackageDirectoryEntry) {
    const themes = [
      ['default', chrome.i18n.getMessage('defaultTheme')],
      '3024-day',
      '3024-night',
      'abcdef',
      'ambiance',
      'ambiance-mobile',
      'base16-dark',
      'base16-light',
      'bespin',
      'blackboard',
      'cobalt',
      'colorforth',
      'dracula',
      'duotone-dark',
      'duotone-light',
      'eclipse',
      'elegant',
      'erlang-dark',
      'hopscotch',
      'icecoder',
      'isotope',
      'lesser-dark',
      'liquibyte',
      'material',
      'mbo',
      'mdn-like',
      'midnight',
      'monokai',
      'neat',
      'neo',
      'night',
      'panda-syntax',
      'paraiso-dark',
      'paraiso-light',
      'pastel-on-dark',
      'railscasts',
      'rubyblue',
      'seti',
      'solarized',
      'the-matrix',
      'tomorrow-night-bright',
      'tomorrow-night-eighties',
      'ttcn',
      'twilight',
      'vibrant-ink',
      'xq-dark',
      'xq-light',
      'yeti',
      'zenburn',
    ].map(v => typeof v === 'string' ? [value, value] : value);
    return Promise.resolve(themes);
  }
  return new Promise(resolve => {
    chrome.runtime.getPackageDirectoryEntry(rootDir => {
      rootDir.getDirectory('vendor/codemirror/theme', {create: false}, themeDir => {
        themeDir.createReader().readEntries(entries => {
          const themes = [
            ['default', chrome.i18n.getMessage('defaultTheme')]
          ].concat(
            entries.filter(entry => entry.isFile)
              .sort((a, b) => (a.name < b.name ? -1 : 1))
              .map(entry => entry.name.replace(/\.css$/, ''))
          ).map(v => typeof v === 'string' ? [v, v] : v);
          resolve(themes);
        });
      });
    });
  });
}
