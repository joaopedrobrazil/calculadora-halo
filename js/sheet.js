/*
 * Folha inferior arrastável sobre o mapa (celular) e cartão flutuante (desktop).
 *
 * Posições de repouso (celular):
 *   'peek' – só o PS, o rumo e a proa;
 *   'half' – metade da tela;
 *   'full' – quase a tela toda (88%).
 * Movimento: mola criticamente amortecida com leve quique (amortecimento 0,8, resposta 0,3 s),
 * começando da posição atual e levando a velocidade do dedo ao soltar.
 * Encaixe: a posição de repouso mais próxima da posição projetada pelo impulso (desaceleração 0,998).
 */
(function (root) {
  'use strict';

  var sheet = document.getElementById('sheet');
  var summary = document.getElementById('summary');
  var sumMain = sheet.querySelector('.sum-main');
  var DESK = window.matchMedia('(min-width: 861px)');
  var REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');

  var ZETA = 0.8, RESP = 0.3, DECEL = 0.998;
  var NEXT = { peek: 'half', half: 'full', full: 'half' };

  var y = 0, v = 0, target = 0, pos = 'half', raf = 0;
  var drag = null, justDragged = false;
  var listeners = [];

  function vh() { return window.innerHeight; }
  function peekH() { return sumMain.offsetTop + sumMain.offsetHeight + 16; }
  function snaps() {
    var h = sheet.offsetHeight;
    return { full: 0, half: Math.max(0, h - vh() * 0.5), peek: Math.max(0, h - peekH()) };
  }
  function visible() { return Math.max(0, sheet.offsetHeight - y); }
  function rubber(over, dim) { return over * dim * 0.55 / (dim + 0.55 * over); }

  function setY(val) {
    y = val;
    sheet.style.transform = 'translate3d(0,' + val.toFixed(1) + 'px,0)';
    document.documentElement.style.setProperty('--sheet-vis', Math.round(visible()) + 'px');
  }

  function settle(name) {
    pos = name;
    sheet.setAttribute('data-pos', name);
    for (var i = 0; i < listeners.length; i++) listeners[i](name);
  }

  function animateTo(name, v0) {
    cancelAnimationFrame(raf);
    target = snaps()[name];
    v = v0 || 0;
    if (REDUCE.matches) { setY(target); v = 0; settle(name); return; }
    var w = 2 * Math.PI / RESP, k = w * w, c = 2 * ZETA * w, last = performance.now();
    function step(now) {
      var dt = Math.min((now - last) / 1000, 1 / 30);
      last = now;
      var n = 4, h = dt / n;
      for (var i = 0; i < n; i++) {
        v += (-k * (y - target) - c * v) * h;
        y += v * h;
      }
      setY(y);
      if (Math.abs(y - target) < 0.5 && Math.abs(v) < 4) {
        v = 0;
        setY(target);
        settle(name);
        return;
      }
      raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
  }

  // Ajusta ao tamanho da tela (girar o aparelho, mudar de desktop para celular)
  function layout() {
    cancelAnimationFrame(raf);
    if (DESK.matches) {
      sheet.style.transform = '';
      sheet.setAttribute('data-pos', 'desk');
      document.documentElement.style.setProperty('--sheet-vis', '0px');
      return;
    }
    setY(snaps()[pos]);
    sheet.setAttribute('data-pos', pos);
  }

  function onDown(e) {
    if (DESK.matches || e.button > 0) return;
    justDragged = false;
    drag = { id: e.pointerId, startY: e.clientY, startTop: y, active: false, el: e.currentTarget, samples: [{ y: e.clientY, t: e.timeStamp }] };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.active) {
      if (Math.abs(e.clientY - drag.startY) < 8) return;   // limiar: toque continua sendo toque
      drag.active = true;
      drag.startY = e.clientY;
      drag.startTop = y;
      cancelAnimationFrame(raf);
      v = 0;
      try { drag.el.setPointerCapture(e.pointerId); } catch (err) { /* sem captura: segue sem ela */ }
    }
    var s = snaps(), h = sheet.offsetHeight;
    var raw = drag.startTop + (e.clientY - drag.startY);
    var out = raw;
    if (raw < s.full) out = s.full - rubber(s.full - raw, h);
    else if (raw > s.peek) out = s.peek + rubber(raw - s.peek, h);
    setY(out);
    drag.samples.push({ y: e.clientY, t: e.timeStamp });
    while (drag.samples.length > 2 && e.timeStamp - drag.samples[0].t > 120) drag.samples.shift();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    var d = drag;
    drag = null;
    if (!d.active) return;
    justDragged = true;

    var first = d.samples[0], last = d.samples[d.samples.length - 1];
    var dt = (last.t - first.t) / 1000;
    var vel = dt > 0.005 && e.timeStamp - last.t <= 100 ? (last.y - first.y) / dt : 0;  // px/s, + = para baixo
    var proj = y + vel * DECEL / (1 - DECEL) / 1000;

    var s = snaps(), best = 'half', bd = Infinity;
    ['full', 'half', 'peek'].forEach(function (n) {
      var dd = Math.abs(s[n] - proj);
      if (dd < bd) { bd = dd; best = n; }
    });
    animateTo(best, vel);
  }

  // Toque sem arrasto em um dos handles: cancela o clique que sobra depois de um arrasto
  sheet.addEventListener('click', function (e) {
    if (justDragged) { justDragged = false; e.stopPropagation(); e.preventDefault(); }
  }, true);

  var handles = sheet.querySelectorAll('.sheet-handle');
  for (var i = 0; i < handles.length; i++) handles[i].addEventListener('pointerdown', onDown);

  // Toque na alça alterna a altura
  document.getElementById('grip').addEventListener('click', function () {
    if (DESK.matches) return;
    animateTo(NEXT[pos] || 'half', 0);
  });

  // Campo de texto focado com a folha recolhida: sobe para a metade
  sheet.addEventListener('focusin', function (e) {
    if (!DESK.matches && pos === 'peek' && e.target.matches('input, select')) animateTo('half', 0);
  });

  if (DESK.addEventListener) DESK.addEventListener('change', layout); else DESK.addListener(layout);
  window.addEventListener('resize', layout);
  layout();

  root.HALO_SHEET = {
    onSettle: function (fn) { listeners.push(fn); },
    // Área coberta pela folha, para o mapa enquadrar o alvo fora dela
    padding: function () {
      if (DESK.matches) return { right: sheet.offsetWidth + 32, bottom: 0 };
      return { right: 0, bottom: visible() };
    },
    toPos: function (name) { if (!DESK.matches) animateTo(name, 0); }
  };
})(window);
