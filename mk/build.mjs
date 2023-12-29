// vim: expandtab softtabstop=2 shiftwidth=2

import * as node_fs from 'node:fs';
import      katex   from './katex.min.js';
import * as csso    from './csso.min.mjs';

const styles = loadStyles('mk/styles.css');
const srcPrefix = 'src/';
const dstPrefix = 'docs/';

renderPages('post/', 'index.html', 'Posts');
renderPages('note/', 'notes.html', 'Notes');


function loadStyles(path) {
  const styles = node_fs.readFileSync(path, { encoding: 'utf8' });
  // tag, style, tag, style, ...
  const cursor = styles.split(/^\/\* \[(\w+)\] \*\/$/gm).slice(1).values();
  // collect tag/style pairs
  const result = {};
  for (const tag of cursor) result[tag] = csso.minify(cursor.next().value).css;
  return result;
}

function formatPage(path, pageData) {
  console.log(repr(path));
  const template =
    '<!DOCTYPE html><html><head><meta charset="utf-8"/>' +
    '<meta name="viewport" content="width=device-width,initial-scale=1"/>' +
    '<title>{title}</title><style>{style}</style>{extra}</head>' +
    '<body><h1>{title}</h1>{context}{content}</body></html>\n';
  const result = template.replace(/\{(\w+)\}/g, (_, key) => pageData[key] ?? '');
  node_fs.writeFileSync(dstPrefix + path, result);
}

// `path` must be single-level and `idxPath` must be top-level
// otherwise links between pages and index and the link to katex.min.css would fail
function renderPages(path, idxPath, idxTitle) {
  node_fs.mkdirSync(dstPrefix + path);

  const files = node_fs.readdirSync(srcPrefix + path, { withFileTypes: true });
  for (const file of files) {
    if (!file.isFile())
      perror('Invalid source file (should be regular file)');
    if (!file.name.endsWith('.txt'))
      perror('Invalid source filename (should end with \'.txt\')');
    function perror(msg) {
      throw new Error(`${msg}: '${repr(srcPrefix + path + file.name)}'`)
    }
  }

  const pages = files.map(file => path + file.name.slice(0, -4));
  const index = pages.map(page => renderPage(page, idxPath));

  const idxItems = index.reverse().map(({ title, created, updated, path }) =>
    `<time>${htmlText(updated ?? created)}</time>` +
    `<a href="${htmlAttr(path)}.html">${htmlText(title)}</a>`);
  const idxContent = `<ol>${idxItems.map(item => `<li>${item}</li>`).join('')}</ol>`;

  formatPage(idxPath, {
    title: idxTitle,
    content: idxContent,
    style: styles.common + styles.list,
  });
}

// fun project: reorder css for better gzip compression
//   (extremely hard -- probably deserves Hacker News post if done properly)

function renderPage(path, idxPath) {
  const source = node_fs.readFileSync(srcPrefix + `${path}.txt`, { encoding: 'utf-8' });
  const lines = source.split('\n').entries();
  const attrs = readAttrs();

  const flags = {}, katexMacros = {};
  const content = renderIter(lines, flags, katexMacros, `${path}.txt`);

  const katexCss = '<link rel="stylesheet" href="../static/katex.min.css"/>';
  const style = styles.common + styles.page +
    (flags.rule ? styles.rule : '') +
    (flags.math ? styles.math : '') +
    (flags.code ? styles.code : '');
  const context = `<div><a href="../${htmlAttr(idxPath)}">[Index]</a> <span>${
      attrs.updated ?
        `Created ${htmlText(attrs.created)}, updated ${htmlText(attrs.updated)}` :
        `Created ${htmlText(attrs.created)}`
    }</span></div>`;

  formatPage(path + '.html', {
    title: attrs.title,
    style,
    extra: flags.math ? katexCss : '',
    context,
    content,
  });

  return attrs;

  function readAttrs() {
    const result = { title: 'Untitled', created: '????-??-??', path };
    for (const [lidx, line] of lines) {
      if (line === '') break;
      const match = line.match(/^(\w+)\s*(.*)$/);
      if (!match) perror('Invalid attribute line');
      const [_, key, val] = match;
      result[key] = val;

      function perror(msg) {
        throw new Error(`${msg}: ${repr(srcPrefix + path)}:${lidx}`)
      }
    }
    return result;
  }
}

function renderIter(lines, flags, katexMacros, srcPath) {
  let result = '', state = 'wait';
  for (const [lidx, line] of lines) {
    if (line === '') {
      if (state !== 'wait' && state !== 'skip')
        result += '</p>';
      state = 'wait';
    } else if (line.startsWith('#-')) {
      if (state !== 'wait') perror('Unexpected rule');
      result += '<hr/>';
      flags.rule = true;
    } else if (line.startsWith('# ')) {
      if (state !== 'wait') perror('Unexpected heading');
      result += '<h2>';
      result += renderText(gather(line.slice('# '.length)),
        flags, katexMacros, srcPath, lidx, 3);
      result += '</h2>';
    } else if (line.startsWith('#[')) {
      // TODO: support environment annotation like '#[ aligned'
      if (state === 'skip') perror('Unexpected math block');
      result += katex.renderToString(collect('#]').join(''), {
        displayMode: true,
        macros: katexMacros
      });
      state = (state === 'wait') ? 'skip' : 'cont';
      flags.math = true;
    } else if (line.startsWith('#<')) {
      // TODO: support language annotation like '#< c' or just '#< .' to indicate code
      if (state === 'skip') perror('Unexpected code block');
      result += `<pre>${collect('#>').join('\n')}</pre>`;
      state = (state === 'wait') ? 'skip' : 'cont';
      flags.code = true;
    } else if (line === '#') {
      if (state !== 'wait') perror('Unexpected paragraph');
      result += '<p>';
      state = 'cont';
    } else {
      if (state === 'skip') perror('Unexpected text');
      if (state === 'wait') result += '<p>';
      if (state === 'text') result += '<br/>';
      result += renderText(gather(line), flags, katexMacros, srcPath, lidx, 1);
      state = 'text';
    }

    function perror(msg) {
      throw new Error(`${msg}: ${repr(srcPrefix + srcPath)}:${lidx}`);
    }
  }
  return result;

  function collect(end) {
    let result = [];
    for (const [lidx, line] of lines) {
      if (line === end) return result;
      result.push(line.slice(line.startsWith('##')));
    }
    perror('Unexpected EOF');
  }
  function gather(line) {
    while (line.endsWith(' \\')) {
      const { value: [_, next], done } = lines.next();
      if (done) perror('Unexpected EOF');
      line = line.slice(0, -2) + next;
    }
    return line;
  }
  function perror(msg) {
    throw new Error(`${msg} : ${repr(srcPrefix + srcPath)}`);
  }
}

function renderText(text, flags, katexMacros, srcPath, lidx, cidx) {
  text += '}';
  return iter();

  function iter() {
    let result = '';
    while (true) {
      const len = text.length;
      const idx = Math.min(...['\\', ']', '}', '$', '`'].map(chr =>
        ((text.indexOf(chr) + 1) || (len + 1)) - 1));
      if (idx === len) perror('Unexpected EOL');
      result += htmlText(text.slice(0, idx));
      text = text.slice(idx);
      cidx += idx;

      if (text[0] === ']' || text[0] === '}') {
        text = text.slice(1);
        return result;
      } else if (text[0] === '\\') {
        const match = text.match(/^\\(\w+)(\{|\[)(.*)$/);
        if (!match) perror('Invalid macro invocation');
        const [_, func, optp, rest] = match;
        text = rest;
        let opt = null;
        if (optp === '[') {
          opt = iter();
          if (text === '' || text[0] !== '{')
            perror('Invalid macro invocation');
          text = text.slice(1);
        }
        const arg = iter();
        if (func === 'em') {
          result += '<em>' + arg + '</em>';
        } else if (func === 'link') {
          result += `<a href="${htmlAttr(arg)}">${htmlText(opt ?? arg)}</a>`;
        } else {
          result += '<span style="color:red">' + func + '</span>';
        }
      } else if (text[0] === '$') {
        const match = text.match(/^\$(.*?)(?<!\\)\$(.*)$/);
        if (!match) perror('Invalid inline math');
        const [_, math, rest] = match;
        result += katex.renderToString(math.replace('\\$', '$'), { macros: katexMacros });
        text = rest;
        flags.math = true;
      } else if (text[0] === '`') {
        const match = text.match(/^`(.*?)(?<!\\)`(.*)$/);
        if (!match) perror('Invalid inline code');
        const [_, code, rest] = match;
        result += `<code>${code.replace('\\`', '`')}</code>`;
        text = rest;
        flags.code = true;
      }
    }

    function perror(msg) {
      throw new Error(`${msg}: ${srcPath}:${lidx}:${cidx}`)
    }
  }
}

function repr(unsafeStr) {
  return unsafeStr.replace(/[^A-Za-z0-9_./ -]/g, (chr) => {
    const code = chr.codePointAt(0);
    return (code >= 32 && code < 127) ? `\\${chr}` : `\\u{${code}}`
  });
}

function htmlText(unsafeStr) {
  return unsafeStr
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;');
}

function htmlAttr(unsafeStr) {
  return unsafeStr
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;');  // '&#34;' is actually shorter
}

