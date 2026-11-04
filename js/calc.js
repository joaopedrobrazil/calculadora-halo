/*
 * Núcleo de cálculo do Ponto de Lançamento (PL) para salto HALO.
 *
 * Método: soma vetorial camada por camada.
 *   D = K × V × A            (m; V em nós, A em milhares de pés)
 *   X = D × sen(direção)     (leste +)
 *   Y = D × cos(direção)     (norte +)
 * A direção é a de onde o vento VEM, então o vetor aponta contra o vento,
 * que é para onde o PL deve ser deslocado a partir do PID.
 */
(function (root) {
  'use strict';

  var RAD = Math.PI / 180;
  var R_EARTH = 6371008.8;   // raio médio da Terra (m)
  var KT = 0.514444;         // 1 nó em m/s

  function bearing(x, y) {
    return (Math.atan2(x, y) / RAD + 360) % 360;
  }

  // Velocidade verdadeira aproximada: +2% por 1.000 ft
  function tasFromIas(iasKt, altFt) {
    return iasKt * (1 + 0.02 * altFt / 1000);
  }

  /**
   * p: { exit, open, pat (ft), kff, kva, ias (kt), ftSec (s), hdgMode: 'auto'|'manual', hdg (°) }
   * layers: [{ alt (ft), dir (°, de onde vem), spd (kt) }]
   */
  function compute(p, layers) {
    var errors = [];
    var warns = [];
    if (!(p.exit > p.open)) errors.push('A altitude de saída precisa ser maior que a de abertura.');
    if (!(p.open > p.pat)) errors.push('A abertura precisa ficar acima do início do tráfego.');
    if (!(p.pat >= 0)) errors.push('O início do tráfego não pode ser negativo.');
    ['kff', 'kva', 'ias', 'ftSec'].forEach(function (k) {
      if (!isFinite(p[k]) || p[k] < 0) errors.push('Preencha todos os dados do salto com valores válidos.');
    });
    if (p.hdgMode === 'manual' && !(isFinite(p.hdg) && p.hdg >= 0 && p.hdg <= 360)) {
      errors.push('A proa manual precisa ficar entre 0° e 360°.');
    }
    var valid = layers.filter(function (L) {
      return isFinite(L.alt) && isFinite(L.dir) && isFinite(L.spd) && L.spd >= 0 && L.dir >= 0 && L.dir <= 360;
    });
    if (valid.length < layers.length) errors.push('Há camada de vento incompleta ou inválida: direção entre 0 e 360 e velocidade não negativa.');
    if (!valid.length) errors.push('Informe pelo menos uma camada de vento.');
    errors = errors.filter(function (e, i, a) { return a.indexOf(e) === i; });
    if (errors.length) return { errors: errors };

    var s = valid.slice().sort(function (a, b) { return a.alt - b.alt; });
    if (p.exit > s[s.length - 1].alt + 1000) {
      warns.push('Não há leitura de vento perto da altitude de saída; o vento da camada mais alta foi estendido até ' + Math.round(p.exit) + ' ft.');
    }

    // Cada leitura vale até a metade da distância às leituras vizinhas
    var rows = [];
    s.forEach(function (L, i) {
      var lo = i === 0 ? 0 : (s[i - 1].alt + L.alt) / 2;
      var hi = i === s.length - 1 ? Infinity : (L.alt + s[i + 1].alt) / 2;
      [['VA', p.pat, p.open, p.kva], ['QL', p.open, p.exit, p.kff]].forEach(function (ph) {
        var a = Math.max(lo, ph[1]);
        var b = Math.min(hi, ph[2]);
        if (b > a) {
          var A = (b - a) / 1000;
          var D = ph[3] * L.spd * A;
          rows.push({
            alt: L.alt, dir: L.dir, spd: L.spd, phase: ph[0], K: ph[3], A: A, lo: a, hi: b, D: D,
            x: D * Math.sin(L.dir * RAD), y: D * Math.cos(L.dir * RAD)
          });
        }
      });
    });
    rows.sort(function (a, b) { return a.lo - b.lo; });

    function phase(ph, K) {
      var x = 0, y = 0, A = 0;
      rows.forEach(function (q) { if (q.phase === ph) { x += q.x; y += q.y; A += q.A; } });
      var d = Math.hypot(x, y);
      return { x: x, y: y, A: A, d: d, dir: bearing(x, y), vEq: A > 0 && K > 0 ? d / (K * A) : 0 };
    }
    var ff = phase('QL', p.kff);
    var va = phase('VA', p.kva);

    // Ponto de saída efetivo (onde termina a projeção à frente)
    var ex = ff.x + va.x;
    var ey = ff.y + va.y;

    // Proa de lançamento
    var hdg;
    if (p.hdgMode === 'manual') {
      hdg = p.hdg % 360;
    } else {
      // Automática: eixo passando pelo ponto de saída e apontando para o PID
      hdg = Math.hypot(ex, ey) > 1 ? bearing(-ex, -ey) : 0;
    }

    var tas = tasFromIas(p.ias, p.exit);
    var ft = tas * KT * p.ftSec;
    var fx = -ft * Math.sin(hdg * RAD);
    var fy = -ft * Math.cos(hdg * RAD);
    var X = ex + fx;
    var Y = ey + fy;

    return {
      errors: [], warns: warns, rows: rows, ff: ff, va: va,
      exit: { x: ex, y: ey }, hdg: hdg, tas: tas, ft: ft, fx: fx, fy: fy,
      X: X, Y: Y, dist: Math.hypot(X, Y), brg: bearing(X, Y)
    };
  }

  // Deslocamento local (plano tangente), adequado para alguns km
  function offset(lat, lon, x, y) {
    return [lat + (y / R_EARTH) / RAD, lon + (x / (R_EARTH * Math.cos(lat * RAD))) / RAD];
  }
  function toXY(lat0, lon0, lat, lon) {
    return { x: (lon - lon0) * RAD * R_EARTH * Math.cos(lat0 * RAD), y: (lat - lat0) * RAD * R_EARTH };
  }

  // Navegação até o PL: distância ao longo do eixo, desvio lateral e tempo
  function nav(pos, pl, hdg, gs) {
    var ux = Math.sin(hdg * RAD), uy = Math.cos(hdg * RAD);
    var dx = pl.x - pos.x, dy = pl.y - pos.y;
    var along = dx * ux + dy * uy;
    var cross = (pos.x - pl.x) * uy - (pos.y - pl.y) * ux; // + = à direita do eixo
    return {
      along: along, cross: cross, direct: Math.hypot(dx, dy), brg: bearing(dx, dy),
      eta: gs > 10 && along > 0 ? along / gs : null
    };
  }

  // UTM (WGS 84; SIRGAS 2000 é praticamente idêntico)
  function utm(lat, lon) {
    var a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
    var e2 = f * (2 - f), ep2 = e2 / (1 - e2), e4 = e2 * e2, e6 = e4 * e2;
    var zone = Math.floor((lon + 180) / 6) + 1;
    var lon0 = ((zone - 1) * 6 - 180 + 3) * RAD;
    var phi = lat * RAD, lam = lon * RAD;
    var sin = Math.sin(phi), cos = Math.cos(phi), tan = Math.tan(phi);
    var N = a / Math.sqrt(1 - e2 * sin * sin);
    var T = tan * tan, C = ep2 * cos * cos, A = cos * (lam - lon0);
    var M = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi
      - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * phi)
      + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * phi)
      - (35 * e6 / 3072) * Math.sin(6 * phi));
    var E = k0 * N * (A + (1 - T + C) * Math.pow(A, 3) / 6
      + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Math.pow(A, 5) / 120) + 500000;
    var Nn = k0 * (M + N * tan * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * Math.pow(A, 4) / 24
      + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Math.pow(A, 6) / 720));
    if (lat < 0) Nn += 10000000;
    var bands = 'CDEFGHJKLMNPQRSTUVWXX';
    var band = bands.charAt(Math.max(0, Math.min(20, Math.floor((lat + 80) / 8))));
    return { zone: zone, band: band, E: E, N: Nn };
  }

  function dms(v, pos, neg) {
    var h = v >= 0 ? pos : neg;
    v = Math.abs(v);
    var d = Math.floor(v), mf = (v - d) * 60, m = Math.floor(mf), sec = (mf - m) * 60;
    if (sec >= 59.95) { sec = 0; m += 1; }
    if (m >= 60) { m = 0; d += 1; }
    return d + '°' + String(m).padStart(2, '0') + '\'' + sec.toFixed(1).padStart(4, '0') + '"' + h;
  }

  root.HALO = {
    compute: compute, bearing: bearing, tasFromIas: tasFromIas,
    offset: offset, toXY: toXY, nav: nav, utm: utm, dms: dms
  };
})(typeof window !== 'undefined' ? window : globalThis);
