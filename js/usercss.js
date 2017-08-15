/* globals loadScript mozParser */

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
    postprocess(sections, vars) {
      let varDef = ':root {\n';
      for (const key of Object.keys(vars)) {
        varDef += `  --${key}: ${vars[key].value};\n`;
      }
      varDef += '}\n';

      for (const section of sections) {
        section.code = varDef + section.code;
      }
    }
  },
  stylus: {
    preprocess(source, vars) {
      return loadScript('vendor/stylus/stylus.min.js').then(() => (
        new Promise((resolve, reject) => {
          let varDef = '';
          for (const key of Object.keys(vars)) {
            varDef += `${key} = ${vars[key].value};\n`;
          }

          // eslint-disable-next-line no-undef
          stylus(varDef + source).render((err, output) => {
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

function getMetaSource(source) {
  const commentRe = /\/\*[\s\S]*?\*\//g;
  const metaRe = /==userstyle==[\s\S]*?==\/userstyle==/i;

  let m;
  // iterate through each comment
  while ((m = commentRe.exec(source))) {
    const commentSource = source.slice(m.index, m.index + m[0].length);
    const n = commentSource.match(metaRe);
    if (n) {
      return n[0];
    }
  }
}

// eslint-disable-next-line no-var
var usercss = {

  buildMeta(source) {
    const style = usercss._buildMeta(source);
    usercss.validate(style);
    return style;
  },

  _buildMeta(source) {
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

    const metaSource = getMetaSource(source);

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

    return style;
  },

  buildCode(style) {
    let builder;
    if (style.preprocessor && style.preprocessor in BUILDER) {
      builder = BUILDER[style.preprocessor];
    } else {
      builder = BUILDER.default;
    }

    return Promise.resolve().then(() => {
      // preprocess
      if (builder.preprocess) {
        return builder.preprocess(style.source, style.vars);
      }
      return style.source;
    }).then(mozStyle =>
      // moz-parser
      loadScript('/js/moz-parser.js').then(() =>
        mozParser.parse(mozStyle).then(sections => {
          style.sections = sections;
        })
      )
    ).then(() => {
      // postprocess
      if (builder.postprocess) {
        return builder.postprocess(style.sections, style.vars);
      }
    }).then(() => style);
  },

  validate(style) {
    // mandatory fields
    for (const prop of ['name', 'namespace', 'version']) {
      if (!style[prop]) {
        throw new Error(chrome.i18n.getMessage('styleMissingMeta', prop));
      }
    }
  }
};
