/* globals loadScript */

'use strict';

function wildcard2regexp(text) {
  return text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\\\*/g, '.*');
}


function guessType(value) {
  if (/^url\(.+\)$/i.test(value)) {
    return 'image';
  }
  if (/^#[0-9a-f]{3,8}$/i.test(value)) {
    return 'color';
  }
  if (/^hsla?\(.+\)$/i.test(value)) {
    return 'color';
  }
  if (/^rgba?\(.+\)$/i.test(value)) {
    return 'color';
  }
  // should we use a color-name table to guess type?
  return 'text';
}

const BUILDER = {
  default: {
    vars(vars) {
      let output = ':root {\n';

      for (const key of Object.keys(vars)) {
        output += `  --${key}: ${vars[key].value};\n`;
      }

      output += '}\n';

      return output;
    },
    code(code) {
      return Promise.resolve(code);
    }
  },
  stylus: {
    vars(vars) {
      let output = '';
      for (const key of Object.keys(vars)) {
        output += `${key} = ${vars[key].value};\n`;
      }
      return output;
    },
    code(code) {
      return loadScript('vendor/stylus/stylus.min.js').then(() => (
        new Promise((resolve, reject) => {
          // eslint-disable-next-line no-undef
          stylus(code).render((err, output) => {
            if (err) {
              reject(err);
            } else {
              resolve(output);
            }
          });
        })
      ));
    }
  }
};

// eslint-disable-next-line no-var
var usercss = {

  buildMeta(source) {
    const style = usercss._buildMeta(source);
    usercss.validate(style);
    usercss.toStylish(style);
    return style;
  },

  _buildMeta(source) {
    const commentRe = /\/\*[\s\S]*?\*\//g;
    const metaRe = /==userstyle==[\s\S]*?==\/userstyle==/i;

    const style = {
      name: null,
      usercss: true,
      version: null,
      source: source,
      enabled: true,
      sections: [],
      vars: {},
      preprocessor: null
    };
    // iterate through each comment
    let m;
    while ((m = commentRe.exec(source))) {
      const commentSource = source.slice(m.index, m.index + m[0].length);

      const n = commentSource.match(metaRe);
      if (!n) {
        continue;
      }

      const section = {
        commentStart: m.index,
        commentEnd: m.index + m[0].length,
        code: null, // calculate this later
        includes: [],
        excludes: []
      };

      const metaSource = n[0];

      const match = (re, callback) => {
        let m;
        if (!re.global) {
          if ((m = metaSource.match(re))) {
            if (m.length === 1) {
              callback(m[0]);
            } else {
              callback(...m.slice(1));
            }
          }
        } else {
          const result = [];
          while ((m = re.exec(metaSource))) {
            if (m.length <= 2) {
              result.push(m[m.length - 1]);
            } else {
              result.push(m.slice(1));
            }
          }
          if (result.length) {
            callback(result);
          }
        }
      };

      // FIXME: finish all metas
      match(/@name[^\S\r\n]+(.+?)[^\S\r\n]*$/m, m => (style.name = m));
      match(/@namespace[^\S\r\n]+(\S+)/, m => (style.namespace = m));
      match(/@preprocessor[^\S\r\n]+(\S+)/, m => (style.preprocessor = m));
      match(/@version[^\S\r\n]+(\S+)/, m => (style.version = m));
      match(/@include[^\S\r\n]+(\S+)/g, m => section.includes.push(...m));
      match(/@exclude[^\S\r\n]+(\S+)/g, m => section.excludes.push(...m));
      match(
        /@var[^\S\r\n]+(\S+)[^\S\r\n]+(?:(['"])((?:\\\2|.)*?)\2|(\S+))[^\S\r\n]+(.+?)[^\S\r\n]*$/gm,
        ms => ms.forEach(([key,, label1, label2, value]) => (
          style.vars[key] = {
            type: guessType(value),
            label: label1 || label2,
            value: value
          }
        ))
      );

      style.sections.push(section);
    }
    return style;
  },

  buildCode(style) {
    let builder;
    if (style.preprocessor && style.preprocessor in BUILDER) {
      builder = BUILDER[style.preprocessor];
    } else {
      builder = BUILDER.default;
    }

    // build CSS variables
    const vars = builder.vars(style.vars);

    // split source into `section.code`
    for (let i = 0, len = style.sections.length; i < len; i++) {
      style.sections[i].code = vars + style.source.slice(
        i === 0 ? 0 : style.sections[i].commentStart,
        style.sections[i + 1] && style.sections[i + 1].commentStart
      );
    }

    // build each section
    const pending = [];
    for (const section of style.sections) {
      pending.push(
        builder.code(section.code)
          .then(code => {
            section.code = code;
          })
      );
    }

    return Promise.all(pending).then(() => style);
  },

  validate(style) {
    // mandatory fields
    for (const prop of ['name', 'namespace', 'version']) {
      if (!style[prop]) {
        throw new Error(chrome.i18n.getMessage('styleMissingMeta', prop));
      }
    }
  },

  toStylish(style) {
    // convert @include rules to stylish
    // maybe we should parse match patterns in the future
    // https://developer.mozilla.org/en-US/Add-ons/WebExtensions/Match_patterns
    for (const section of style.sections) {
      for (const include of section.includes) {
        let m;
        if (include === '*') {
          // match all
          continue;
        } else if (include.startsWith('/') && include.endsWith('/')) {
          // regexp
          if (!section.regexps) {
            section.regexps = [];
          }
          section.regexps.push(include.slice(1, -1));
        } else if (!include.includes('*')) {
          // url
          if (!section.urls) {
            section.urls = [];
          }
          section.urls.push(include);
        } else if ((m = include.match(/^\*:\/\/(?:\*\.)?([^/]+)\/\*$/))) {
          // domain. Compatible with match patterns
          // e.g. *://*.mozilla.org/*
          if (!section.domains) {
            section.domains = [];
          }
          section.domains.push(m[1]);
        } else if ((m = include.match(/^[^*]+\*$/))) {
          // prefixes
          if (!section.urlPrefixes) {
            section.urlPrefixes = [];
          }
          section.urlPrefixes.push(include.slice(0, -1));
        } else {
          // compile wildcard to regexps
          if (!section.regexps) {
            section.regexps = [];
          }
          section.regexps.push(wildcard2regexp(include));
        }
      }
    }

    return style;
  }
};
