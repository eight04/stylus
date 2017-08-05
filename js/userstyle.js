'use strict';

function wildcard2regexp(text) {
  return text.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&').replace(/\\\*/g, '.*');
}


function userStyle2json(source) {
  const style = buildStyle(source);

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

  function buildStyle(source) {
    const commentRe = /\/\*[\s\S]*?\*\//g;
    const metaRe = /==userstyle==[\s\S]*?==\/userstyle==/i;

    const style = {
      name: null,
      isUserStyle: true,
      version: null,
      source: source,
      enabled: true,
      sections: []
    };
    // iterate through each comment
    let m;
    while ((m = commentRe.exec(source))) {
      const commentSource = source.slice(m.index, m.index + m[0].length);

      let n = commentSource.match(metaRe);
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

      // FIXME: finish all metas
      if ((n = metaSource.match(/@name\s+(.+)/))) {
        style.name = n[1].trim();
      }
      if ((n = metaSource.match(/@namespace\s+(\S+)/))) {
        style.namespace = n[1];
      }
      if ((n = metaSource.match(/@version\s+(\S+)/))) {
        style.version = n[1];
      }
      let r = /@include\s+(\S+)/g;
      while ((n = r.exec(metaSource))) {
        section.includes.push(n[1]);
      }
      r = /@exclude\s+(\S+)/g;
      while ((n = r.exec(metaSource))) {
        section.excludes.push(n[1]);
      }

      style.sections.push(section);
    }

    // split source into `section.code`
    for (let i = 0, len = style.sections.length; i < len; i++) {
      style.sections[i].code = source.slice(
        i === 0 ? 0 : style.sections[i].commentStart,
        style.sections[i + 1] && style.sections[i + 1].commentStart
      );
    }

    return style;
  }
}
