'use strict';

function capticalize(s) {
  return s[0].toUpperCase() + s.slice(1);
}

(function () {
  // additional info for commands
  const COMMANDS = {
    autocomplete: {
      key: {
        pcDefault: 'Ctrl-Space', // will be used by 'sublime' on PC via fallthrough
        macDefault: 'Alt-Space', // OSX uses Ctrl-Space and Cmd-Space for something else
        emacsy: 'Alt-/' // copied from 'emacs' keymap
        // 'vim' and 'emacs' define their own autocomplete hotkeys
      }
    },
    blockComment: {
      key: {
        sublime: 'Shift-Ctrl-/'
      },
      run: cm => {
        cm.blockComment(cm.getCursor('from'), cm.getCursor('to'), {fullLines: false});
      }
    },
    save: {
      global: true,
      run: save
    },
    toggleStyle: {
      global: true,
      key: 'Alt-Enter',
      run: toggleStyle
    },
    nextEditor: {
      global: true,
      key: 'Alt-PageDown',
      run: cm => { nextPrevEditor(cm, 1); }
    },
    prevEditor: {
      global: true,
      key: 'Alt-PageUp',
      run: cm => { nextPrevEditor(cm, -1); }
    },
    find: {
      global: true
    },
    findNext: {
      global: true,
      key: {
        pcDefault: 'F3'
      }
    },
    findPrev: {
      global: true,
      key: {
        pcDefault: 'Shift-F3'
      },
    },
    replace: {
      global: true
    },
    replaceAll: {
      global: true
    },
    jumpToLine: {
      global: true,
      key: {
        sublime: 'Ctrl-G',
        emacsy: 'Ctrl-G',
        pcDefault: 'Ctrl-J',
        macDefault: 'Cmd-J',
      },
      run: jumpToLine
    }
  };

  const DEFAULTS = {
    mode: 'css',
    lineNumbers: true,
    lineWrapping: true,
    foldGutter: true,
    gutters: ['CodeMirror-linenumbers', 'CodeMirror-foldgutter', 'CodeMirror-lint-markers'],
    matchBrackets: true,
    highlightSelectionMatches: {showToken: /[#.\-\w]/, annotateScrollbar: true},
    hintOptions: {},
    lint: {getAnnotations: CodeMirror.lint.css, delay: prefs.get('editor.lintDelay')},
    lintReportDelay: prefs.get('editor.lintReportDelay'),
    styleActiveLine: true,
    theme: 'default',
    keyMap: prefs.get('editor.keyMap') ||
      (prefs.reset('editor.keyMap'), prefs.get('editor.keyMap')),
  };

  const editors = new Set;

  Object.assign(CodeMirror.defaults, DEFAULTS, prefs.get('editor.options'));

  buildKeyMap();

  // setup global commands
  for (const cmdName of Object.keys(COMMANDS)) {
    const cmd = COMMANDS[cmdName];
    if (cmd.global) {
      CodeMirror.commands[cmdName] = decorateGlobalCmd(cmd.run || CodeMirror.commands[cmdName], cmdName);
    } else if (cmd.run) {
      CodeMirror.commands[cmdName] = cmd.run;
    }
  }

  // some common methods to CodeMirror
  CodeMirror.setGlobalOption = (o, v) => {
    CodeMirror.defaults[o] = v;
    for (const editor of editors) {
      editor.setOption(o, v);
    };
  };

  CodeMirror.toggleAutocompleteOnTyping = enable => {
    for (const editor of editors) {
      const onOff = enable ? 'on' : 'off';
      cm[onOff]('change', autocompleteOnTyping);
      cm[onOff]('pick', autocompletePicked);
    };
  }

  // replace given textarea with the CodeMirror editor
  CodeMirror.setup = textarea => {
    const cm = CodeMirror.fromTextArea(textarea, {lint: null});
    const wrapper = cm.display.wrapper;

    if (prefs.get('editor.autocompleteOnTyping')) {
      cm.on('change', autocompleteOnTyping);
      cm.on('pick', autocompletePicked);
    }
    if (!FIREFOX) {
      cm.on('mousedown', (cm, event) => toggleContextMenuDelete.call(cm, event));
    }
    return cm;
  };

  CodeMirror.setupResizeGrip = cm => {
    const {wrapper} = cm.display;
    let lastClickTime = 0;
    const resizeGrip = wrapper.appendChild(template.resizeGrip.cloneNode(true));
    resizeGrip.onmousedown = event => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      if (Date.now() - lastClickTime < 500) {
        lastClickTime = 0;
        toggleSectionHeight(cm);
        return;
      }
      lastClickTime = Date.now();
      const minHeight = cm.defaultTextHeight() +
        cm.display.lineDiv.offsetParent.offsetTop + /* .CodeMirror-lines padding */
        wrapper.offsetHeight - wrapper.clientHeight; /* borders */
      wrapper.style.pointerEvents = 'none';
      document.body.style.cursor = 's-resize';
      function resize(e) {
        const cmPageY = wrapper.getBoundingClientRect().top + window.scrollY;
        const height = Math.max(minHeight, e.pageY - cmPageY);
        if (height !== wrapper.clientHeight) {
          cm.setSize(null, height);
        }
      }
      document.addEventListener('mousemove', resize);
      document.addEventListener('mouseup', function resizeStop() {
        document.removeEventListener('mouseup', resizeStop);
        document.removeEventListener('mousemove', resize);
        wrapper.style.pointerEvents = '';
        document.body.style.cursor = '';
      });
    };
  };

  CodeMirror.setupSearcher = cm => {
    let cache, pos;
    cm.search = (text, direction, pos, loop) => {
      if (!cache || cache.text !== text) {
        cache = createSearch(text);
      }
      return cache[direction](pos, loop);
    };

    function createSearch(text) {
      const doc = cm.getValues();
      let match = text.match(/^\/(.+?)\/([imuy]*)$/);
      if (match) {
        try {
          text = new RegExp(match[1], match[2]);
        } catch (err) {}
      }
      let matches;
      return {
        next(_pos = pos, loop) {
          let index;
          if (typeof text === 'string') {
            index = doc.
          }
        },
        prev(_pos = pos, loop) {

        }
      }
    }
  };

  function decorateGlobalCmd(run, name) {
    const globalName = `global${capticalize(name)}`;
    return cm => {
      if (cm[globalName]) {
        return cm[globalName](cm);
      }
      return run(cm);
    }
  }

  function buildKeyMap() {
    for (const cmdName of Object.keys(COMMANDS)) {
      const cmd = COMMANDS[cmdName];
      if (typeof cmd.key == "string") {
        if (!CodeMirror.defaults.extraKeys) {
          CodeMirror.defaults.extraKeys = {};
        }
        CodeMirror.defaults.extraKeys[cmd.key] = cmdName;
      } else {
        for (const category of Object.keys(cmd.key)) {
          const key = cmd.key[category];
          CodeMirror.keyMap[category][key] = cmdName;
        }
      }
    }

    // try to remap non-interceptable Ctrl-(Shift-)N/T/W hotkeys
    ['N', 'T', 'W'].forEach(char => {
      [{from: 'Ctrl-', to: ['Alt-', 'Ctrl-Alt-']},
       {from: 'Shift-Ctrl-', to: ['Ctrl-Alt-', 'Shift-Ctrl-Alt-']} // Note: modifier order in CM is S-C-A
      ].forEach(remap => {
        const oldKey = remap.from + char;
        Object.keys(CodeMirror.keyMap).forEach(keyMapName => {
          const keyMap = CodeMirror.keyMap[keyMapName];
          const command = keyMap[oldKey];
          if (!command) {
            return;
          }
          remap.to.some(newMod => {
            const newKey = newMod + char;
            if (!(newKey in keyMap)) {
              delete keyMap[oldKey];
              keyMap[newKey] = command;
              return true;
            }
          });
        });
      });
    });
  }
})();
