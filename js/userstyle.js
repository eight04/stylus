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

// eslint-disable-next-line no-var
var userstyle = {
  buildStyle(source) {
    const commentRe = /\/\*[\s\S]*?\*\//g;
    const metaRe = /==userstyle==[\s\S]*?==\/userstyle==/i;

    const style = {
      name: null,
      isUserStyle: true,
      version: null,
      source: source,
      enabled: true,
      sections: [],
      vars: {}
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

    this.buildCode(style);

    return style;
  },

  buildCode(style) {
    // build CSS variables
    const vars = `:root {
${Object.entries(style.vars).map(([key, va]) => `  --${key}: ${va.value};
`).join('')}}
`;

    // split source into `section.code`
    for (let i = 0, len = style.sections.length; i < len; i++) {
      style.sections[i].code = vars + style.source.slice(
        i === 0 ? 0 : style.sections[i].commentStart,
        style.sections[i + 1] && style.sections[i + 1].commentStart
      );
    }

    return style;
  },

  validate(style) {
    // mandatory fields
    for (const prop of ['name', 'namespace', 'version']) {
      if (!style[prop]) {
        // FIXME: i18n
        throw new Error(`Missing metadata ${prop}`);
      }
    }
  },

  json(source) {
    const style = this.buildStyle(source);

    this.validate(style);

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
