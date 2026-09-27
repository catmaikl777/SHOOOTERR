/* ============================================================
   PIXEL ORCA — UI-хелперы (модалки, тосты, иконки, вкладки)
   ============================================================ */
(function (root) {
  'use strict';

  var SPR = root.PO_SPR;
  var openModals = [];
  var toastBox = null;

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $$(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  /* ---------- пиксельные иконки в DOM ---------- */
  function icon(name, scale, pal, flip) {
    scale = scale || 2;
    var s = SPR.size(name, pal, true);
    var c = document.createElement('canvas');
    c.width = s.w * scale;
    c.height = s.h * scale;
    c.className = 'px-icon';
    c.style.width = c.width + 'px';
    c.style.height = c.height + 'px';
    var ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    SPR.draw(ctx, name, 0, 0, scale, { pal: pal, outline: true, flip: flip });
    return c;
  }

  /* ---------- модальные окна ---------- */
  function open(id) {
    var m = typeof id === 'string' ? document.getElementById(id) : id;
    if (!m) return;
    m.classList.add('open');
    document.body.classList.add('modal-open');
    if (openModals.indexOf(m) < 0) openModals.push(m);
    if (root.SND) root.SND.play('ui');
  }
  function close(id) {
    var m = typeof id === 'string' ? document.getElementById(id) : id;
    if (m) m.classList.remove('open');
    var i = openModals.indexOf(m);
    if (i >= 0) openModals.splice(i, 1);
    if (!openModals.length) document.body.classList.remove('modal-open');
  }
  function closeAll() {
    for (var i = openModals.length - 1; i >= 0; i--) {
      openModals[i].classList.remove('open');
    }
    openModals = [];
    document.body.classList.remove('modal-open');
  }
  function isOpen(id) {
    var m = document.getElementById(id);
    return !!(m && m.classList.contains('open'));
  }

  /* ---------- тосты ---------- */
  function toast(text, type, iconName) {
    if (!toastBox) {
      toastBox = el('div', 'toast-box');
      document.body.appendChild(toastBox);
    }
    var t = el('div', 'toast toast-' + (type || 'info'));
    if (iconName) t.appendChild(icon(iconName, 2));
    t.appendChild(el('span', 'toast-text', text));
    toastBox.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('show'); });
    setTimeout(function () {
      t.classList.remove('show');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 350);
    }, 2600);
  }

  /* ---------- диалоги ---------- */
  function modalShell(title, bodyHtml, opts) {
    opts = opts || {};
    var wrap = el('div', 'px-modal dialog open');
    wrap.innerHTML =
      '<div class="px-modal-head"><h3>' + title + '</h3>' +
      '<button class="px-btn px-btn-x" data-close="1">×</button></div>' +
      '<div class="px-modal-body">' + bodyHtml + '</div>' +
      (opts.footer ? '<div class="px-modal-foot">' + opts.footer + '</div>' : '');
    document.body.appendChild(wrap);
    openModals.push(wrap);
    document.body.classList.add('modal-open');
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.dataset.close) closeEl(wrap);
    });
    return wrap;
  }
  function closeEl(m) {
    m.classList.remove('open');
    var i = openModals.indexOf(m);
    if (i >= 0) openModals.splice(i, 1);
    if (!openModals.length) document.body.classList.remove('modal-open');
    setTimeout(function () { if (m.parentNode) m.parentNode.removeChild(m); }, 200);
  }

  function confirm(title, text, okLabel) {
    return new Promise(function (res) {
      var m = modalShell(title,
        '<p class="dialog-text">' + text + '</p>',
        { footer: '<button class="px-btn" data-act="no">Отмена</button><button class="px-btn px-btn-primary" data-act="yes">' + (okLabel || 'Да') + '</button>' });
      m.addEventListener('click', function (e) {
        var a = e.target.dataset.act;
        if (a === 'yes') { closeEl(m); res(true); }
        else if (a === 'no') { closeEl(m); res(false); }
      });
      m.addEventListener('close', function () { res(false); });
    });
  }

  function prompt(title, label, def, maxLen) {
    return new Promise(function (res) {
      var m = modalShell(title,
        '<label class="px-label">' + label + '</label>' +
        '<input class="px-input" id="pxPromptInput" maxlength="' + (maxLen || 16) + '" value="' + (def || '') + '">',
        { footer: '<button class="px-btn" data-act="no">Отмена</button><button class="px-btn px-btn-primary" data-act="yes">OK</button>' });
      var inp = $('#pxPromptInput', m);
      setTimeout(function () { inp.focus(); inp.select(); }, 60);
      function done(v) {
        closeEl(m);
        res(v);
      }
      m.addEventListener('click', function (e) {
        var a = e.target.dataset.act;
        if (a === 'yes') done(inp.value.trim());
        else if (a === 'no') done(null);
      });
      inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') done(inp.value.trim());
      });
    });
  }

  /* ---------- вкладки ---------- */
  function tabs(container, onSelect) {
    container.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tab]');
      if (!b) return;
      $$('[data-tab]', container).forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      if (root.SND) root.SND.play('ui');
      onSelect(b.dataset.tab, b);
    });
  }

  /* ---------- прогресс-бар ---------- */
  function bar(pct, cls) {
    pct = Math.max(0, Math.min(1, pct));
    return '<div class="px-bar ' + (cls || '') + '"><i style="width:' + (pct * 100).toFixed(2) + '%"></i></div>';
  }

  /* ---------- всплывающий текст ---------- */
  function floatText(target, text, cls) {
    var r = target.getBoundingClientRect();
    var d = el('div', 'float-txt ' + (cls || ''), text);
    d.style.left = (r.left + r.width / 2) + 'px';
    d.style.top = (r.top + r.height * 0.35) + 'px';
    document.body.appendChild(d);
    requestAnimationFrame(function () { d.classList.add('go'); });
    setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 1100);
  }

  function shake(node, power) {
    if (!root.ST || !root.ST.state.settings.shake) return;
    var p = power || 6;
    node.style.transform = 'translate(' + (Math.random() * p - p / 2).toFixed(1) + 'px,' + (Math.random() * p - p / 2).toFixed(1) + 'px)';
    setTimeout(function () { node.style.transform = ''; }, 90);
  }

  /* big centered banner (level up, crit, win) */
  function banner(text, cls, ms) {
    var b = el('div', 'px-banner ' + (cls || ''), text);
    document.body.appendChild(b);
    requestAnimationFrame(function () { b.classList.add('show'); });
    setTimeout(function () {
      b.classList.remove('show');
      setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
    }, ms || 1400);
  }

  function rarityBadge(rar) {
    return '<span class="px-rar px-rar-' + rar + '">' + root.DATA.RAR_NAMES[rar] + '</span>';
  }

  /* экранирование пользовательского текста (ники, названия кланов) */
  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return ESC[ch]; });
  }

  root.UI = {
    $: $, $$: $$, el: el, icon: icon,
    open: open, close: close, closeAll: closeAll, isOpen: isOpen,
    toast: toast, confirm: confirm, prompt: prompt, modalShell: modalShell, closeEl: closeEl,
    tabs: tabs, bar: bar, floatText: floatText, shake: shake, banner: banner,
    rarityBadge: rarityBadge, escapeHtml: escapeHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
