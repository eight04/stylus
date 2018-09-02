/* global linter editors clipString createLinterHelpDialog makeSectionVisible */
'use strict';

// eslint-disable-next-line no-var
var linterReport = (() => {
  const cms = new Map();
  const helpDialog = createLinterHelpDialog(getIssues);

  document.addEventListener('DOMContentLoaded', () => {
    $('#lint-help').addEventListener('click', helpDialog.show);
  }, {once: true});

  linter.onChange((annotationsNotSorted, annotations, cm) => {
    let table = cms.get(cm);
    if (!table) {
      table = createTable(cm);
      cms.set(cm, table);
      const container = $('.lint-report-container');
      if (typeof editor === 'object') {
        container.append(table.element);
      } else {
        const nextSibling = findNextSibling(cms, cm);
        container.insertBefore(table.element, nextSibling && cms.get(nextSibling).element);
      }
    }
    table.updateCaption();
    table.updateAnnotations(annotations);
    updateCount();
  });

  linter.onUnhook(cm => {
    const table = cms.get(cm);
    if (table) {
      table.element.remove();
      cms.delete(cm);
    }
    updateCount();
  });

  return {refresh};

  function updateCount() {
    const issueCount = Array.from(cms.values())
      .reduce((sum, table) => sum + table.trs.length, 0);
    $('#lint').classList.toggle('hidden', issueCount === 0);
    $('#issue-count').textContent = issueCount;
  }

  function getIssues() {
    const issues = new Set();
    for (const table of cms.values()) {
      for (const tr of table.trs) {
        issues.add(tr.getAnnotation());
      }
    }
    return issues;
  }

  function findNextSibling(cms, cm) {
    let i = editors.indexOf(cm) + 1;
    while (i < editors.length) {
      if (cms.has(editors[i])) {
        return editors[i];
      }
      i++;
    }
  }

  function refresh() {
    for (const table of cms.values()) {
      table.updateCaption();
    }
  }

  function createTable(cm) {
    const caption = $create('caption');
    const tbody = $create('tbody');
    const table = $create('table', [caption, tbody]);
    const trs = [];
    return {
      element: table,
      trs,
      updateAnnotations,
      updateCaption
    };

    function updateCaption() {
      caption.textContent = typeof editor === 'object' ?
        '' : `${t('sectionCode')} ${editors.indexOf(cm) + 1}`;
    }

    function updateAnnotations(lines) {
      let i = 0;
      for (const anno of getAnnotations()) {
        let tr;
        if (i < trs.length) {
          tr = trs[i];
        } else {
          tr = createTr();
          trs.push(tr);
          tbody.append(tr.element);
        }
        tr.update(anno);
        i++;
      }
      if (i === 0) {
        trs.length = 0;
        tbody.textContent = '';
      } else {
        while (trs.length > i) {
          trs.pop().element.remove();
        }
      }
      table.classList.toggle('empty', trs.length === 0);

      function *getAnnotations() {
        for (const line of lines.filter(Boolean)) {
          yield *line;
        }
      }
    }

    function createTr() {
      let anno;
      const severityIcon = $create('div');
      const severity = $create('td', {attributes: {role: 'severity'}}, severityIcon);
      const line = $create('td', {attributes: {role: 'line'}});
      const col = $create('td', {attributes: {role: 'col'}});
      const message = $create('td', {attributes: {role: 'message'}});

      const trElement = $create('tr', {
        onclick: () => gotoLintIssue(cm, anno)
      }, [
        severity,
        line,
        $create('td', {attributes: {role: 'sep'}}, ':'),
        col,
        message
      ]);
      return {
        element: trElement,
        update,
        getAnnotation: () => anno
      };

      function update(_anno) {
        anno = _anno;
        trElement.className = anno.severity;
        severity.dataset.rule = anno.rule;
        severityIcon.className = `CodeMirror-lint-marker-${anno.severity}`;
        severityIcon.textContent = anno.severity;
        line.textContent = anno.from.line + 1;
        col.textContent = anno.from.ch + 1;
        message.title = clipString(anno.message, 1000) + `\n(${anno.rule})`;
        message.textContent = clipString(anno.message, 100);
      }
    }
  }

  function gotoLintIssue(cm, anno) {
    makeSectionVisible(cm);
    cm.focus();
    cm.setSelection(anno.from);
  }
})();
