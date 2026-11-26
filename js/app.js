(function () {
  'use strict';

  var H = window.HALO;
  var $ = function (id) { return document.getElementById(id); };
  var STORE = 'calculadora-halo-v1';

  var DEFAULT_PARAMS = { exit: 12000, open: 4000, pat: 1000, kff: 3, kva: 25, ias: 120, ftSec: 3, hdgMode: 'nariz', coneSide: 'E', circFinal: 2, circTurn: 25, circAfter: 15, circSide: 'E', circShow: true, decl: NaN, declSide: 'W', exact: false };
  var DEFAULT_LAYERS = [11000, 9000, 7000, 5000, 3000, 1000].map(function (a) { return { alt: a, dir: NaN, spd: NaN }; });
  var PARAM_IDS = ['exit', 'open', 'pat', 'kff', 'kva', 'ias', 'ftSec', 'circFinal', 'circTurn', 'circAfter', 'decl'];
  var MODE_NAME = { nariz: 'Nariz', cauda: 'Cauda', cone: 'Boca do cone' };
  var MODE_FALA = { nariz: 'de nariz', cauda: 'de cauda', cone: 'boca do cone' };
  var VARIANTS = [{ mode: 'nariz', side: 'E' }, { mode: 'cauda', side: 'E' }, { mode: 'cone', side: 'E' }, { mode: 'cone', side: 'D' }];
  var SECS = ['modo', 'ventos', 'salto', 'nav'];
  var MODES = ['nariz', 'cauda', 'cone'];
  var MODE_NOTES = {
    nariz: 'A aeronave passa sobre o alvo voando contra o vento. A projeção à frente leva o paraquedista contra o vento, então o PS fica mais perto do alvo.',
    cauda: 'A aeronave vem a favor do vento em direção ao alvo. A projeção à frente leva o paraquedista para o alvo, então a saída é antecipada: o PS fica mais longe.',
    cone: 'A aeronave cruza perpendicular à resultante do vento. A projeção à frente desloca o PS para o lado, sem mudar a distância contra o vento.'
  };

  // ---------- estado ----------
  function freshState() {
    return { pid: null, params: Object.assign({}, DEFAULT_PARAMS), layers: DEFAULT_LAYERS.map(function (o) { return Object.assign({}, o); }), mapa: 'sat', nomes: true, open: { ventos: true } };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE));
      if (s && s.params && Array.isArray(s.layers)) {
        return {
          pid: s.pid && isFinite(s.pid.lat) && isFinite(s.pid.lon) ? s.pid : null,
          params: (function (pp) {
            if (['nariz', 'cauda', 'cone'].indexOf(pp.hdgMode) === -1) pp.hdgMode = 'nariz';
            if (pp.coneSide !== 'D') pp.coneSide = 'E';
            pp.decl = num(pp.decl);   // JSON guarda NaN como null
            if (pp.declSide !== 'E') pp.declSide = 'W';
            pp.exact = !!pp.exact;
            return pp;
          })(Object.assign({}, DEFAULT_PARAMS, s.params)),
          layers: s.layers.map(function (L) { return { alt: num(L.alt), dir: num(L.dir), spd: num(L.spd) }; }),
          mapa: s.mapa === 'osm' ? 'osm' : 'sat',
          nomes: s.nomes !== false,
          open: s.open && typeof s.open === 'object' ? s.open : { ventos: true }
        };
      }
    } catch (e) { /* sem armazenamento */ }
    return freshState();
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(st)); } catch (e) { /* ignora */ }
  }
  function num(v) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : NaN; }

  var st = load();
  var result = null;

  // ---------- formatação ----------
  var fmt = function (n, d) { return n.toLocaleString('pt-BR', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 }); };
  var deg3 = function (b) { return String(Math.round(b) % 360).padStart(3, '0') + '°'; };
  var mmss = function (s) { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  // ---------- norte magnético ----------
  // Declinação com sinal: + leste, − oeste. Sem declinação informada, tudo sai em verdadeiro (V).
  function hasDecl() { return isFinite(st.params.decl); }
  function declSigned() { return hasDecl() ? (st.params.declSide === 'E' ? st.params.decl : -st.params.decl) : NaN; }
  function calcParams(over) { return Object.assign({}, st.params, { decl: declSigned(), round10: !st.params.exact }, over || {}); }
  var mag = function (t) { return H.norm(t - (hasDecl() ? declSigned() : 0)); };
  var degM = function (t) { return deg3(mag(t)) + (hasDecl() ? ' M' : ' V'); };
  var fala3 = function (t) { return String(Math.round(mag(t)) % 360).padStart(3, '0'); };
  var m10 = function (d) { return fmt(Math.round(Math.abs(d) / 10) * 10); };

  // ---------- mapa ----------
  var map = L.map('map', { zoomControl: true }).setView([-15.8, -47.9], 4);
  map.zoomControl.options.zoomInTitle = 'Ampliar mapa';
  map.zoomControl.options.zoomOutTitle = 'Reduzir mapa';
  map.zoomControl.setPosition('bottomright');
  // Satélite é o padrão: dá noção real do terreno em volta do ponto de saída.
  var bases = {
    sat: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 20, maxNativeZoom: 18, crossOrigin: true, attribution: 'Imagens &copy; Esri, Maxar, Earthstar Geographics'
    }),
    osm: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 20, maxNativeZoom: 19, crossOrigin: true, attribution: '&copy; colaboradores do <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    })
  };
  var nomes = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    maxZoom: 20, maxNativeZoom: 18, crossOrigin: true, pane: 'overlayPane'
  });
  bases[st.mapa].addTo(map);
  if (st.nomes) nomes.addTo(map);
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);

  var mapStyle = $('mapStyle');
  if (mapStyle) {
    var mapLabels = $('mapLabels');
    var mapStyleLabel = $('mapStyleLabel');
    mapStyle.querySelector('input[value="' + st.mapa + '"]').checked = true;
    mapStyleLabel.textContent = st.mapa === 'sat' ? 'Satélite' : 'Mapa de ruas';
    mapLabels.checked = st.nomes;
    mapStyle.addEventListener('change', function (e) {
      if (e.target === mapLabels) {
        st.nomes = mapLabels.checked;
        if (st.nomes) nomes.addTo(map); else map.removeLayer(nomes);
      } else {
        map.removeLayer(bases[st.mapa]);
        st.mapa = e.target.value;
        bases[st.mapa].addTo(map);
        mapStyleLabel.textContent = e.target.parentElement.textContent.trim();
      }
      save();
    });
  }

  var drawLayer = L.layerGroup().addTo(map);
  var pidMarker = null;
  var markMode = false;

  function icon(cls, label) {
    var html = '<div class="mk"><div class="' + cls + '"></div>' + (label ? '<div class="mk-label">' + label + '</div>' : '') + '</div>';
    return L.divIcon({ className: '', html: html, iconSize: [60, 44], iconAnchor: [30, 11] });
  }

  function setMarkMode(on) {
    markMode = on;
    $('markBtn').setAttribute('aria-pressed', on ? 'true' : 'false');
    $('markBtn').textContent = on ? 'Toque no mapa…' : (st.pid ? 'Mover alvo' : 'Marcar alvo no mapa');
    map.getContainer().style.cursor = on ? 'crosshair' : '';
    hint(on ? 'Toque no ponto onde quer pousar.' : null);
  }
  function hint(t) { var h = $('mapHint'); if (t) { h.textContent = t; h.hidden = false; } else { h.hidden = true; } }

  map.on('click', function (e) {
    if (!markMode) return;
    setPid(e.latlng.lat, e.latlng.lng);
    setMarkMode(false);
  });

  function setPid(lat, lon, keepView) {
    st.pid = { lat: lat, lon: lon };
    save();
    hint(null);
    syncPidInputs();
    update();
    if (!keepView) fit();
  }

  function syncPidInputs() {
    $('pidLat').value = st.pid ? st.pid.lat.toFixed(6) : '';
    $('pidLon').value = st.pid ? st.pid.lon.toFixed(6) : '';
    $('markBtn').textContent = st.pid ? 'Mover alvo' : 'Marcar alvo no mapa';
  }

  function fit() {
    if (!st.pid) return;
    var pts = [[st.pid.lat, st.pid.lon]];
    if (result && !result.errors.length) pts.push(H.offset(st.pid.lat, st.pid.lon, result.X, result.Y));
    if (me) pts.push([me.lat, me.lon]);
    var pd = window.HALO_SHEET ? HALO_SHEET.padding() : { right: 0, bottom: 0 };
    if (pts.length === 1) map.setView(pts[0], 15);
    else map.fitBounds(L.latLngBounds(pts).pad(0.35), { maxZoom: 16, paddingTopLeft: [16, 120], paddingBottomRight: [pd.right + 16, pd.bottom + 16] });
  }

  // Depois que a folha para, o alvo não pode ficar escondido atrás dela
  function keepTargetVisible() {
    if (!st.pid || !window.HALO_SHEET) return;
    var pt = map.latLngToContainerPoint([st.pid.lat, st.pid.lon]);
    var sz = map.getSize(), pd = HALO_SHEET.padding();
    var top = 120, bottom = sz.y - pd.bottom - 24;
    if (pt.y < top || pt.y > bottom) map.panBy([0, pt.y - (top + bottom) / 2], { animate: true });
  }
  if (window.HALO_SHEET) HALO_SHEET.onSettle(keepTargetVisible);

  function draw() {
    drawLayer.clearLayers();
    if (!st.pid) {
      if (pidMarker) { map.removeLayer(pidMarker); pidMarker = null; }
      return;
    }
    var p0 = st.pid;
    if (!pidMarker) {
      pidMarker = L.marker([p0.lat, p0.lon], { icon: icon('mk-pid', 'ALVO'), draggable: true, zIndexOffset: 1000, keyboard: true, title: 'Alvo' }).addTo(map);
      pidMarker.on('dragend', function () { var ll = pidMarker.getLatLng(); setPid(ll.lat, ll.lng, true); });
    } else {
      pidMarker.setLatLng([p0.lat, p0.lon]);
    }
    var ll = function (x, y) { return H.offset(p0.lat, p0.lon, x, y); };

    // circunferências de 50, 100 e 200 m em volta do alvo
    [50, 100, 200].forEach(function (r) {
      L.circle([p0.lat, p0.lon], { radius: r, color: '#ffffff', weight: 1.5, opacity: 0.9, fill: false, dashArray: '4 4', interactive: false }).addTo(drawLayer);
      L.marker(ll(r * 0.7071, r * 0.7071), { icon: L.divIcon({ className: '', html: '<span class="mk-ring">' + r + ' m</span>', iconSize: [40, 14], iconAnchor: [20, 7] }), interactive: false, keyboard: false }).addTo(drawLayer);
    });

    if (!result || result.errors.length) return;

    var css = getComputedStyle(document.documentElement);
    var col = { QL: css.getPropertyValue('--ff').trim(), VA: css.getPropertyValue('--va').trim(), FT: css.getPropertyValue('--ftc').trim(), PS: '#f0773a' };
    // polígono de vetores: alvo -> camadas -> fim da projeção à frente -> PS
    var cx = 0, cy = 0;
    result.rows.forEach(function (q) {
      var a = ll(cx, cy); cx += q.x; cy += q.y; var b = ll(cx, cy);
      L.polyline([a, b], { color: col[q.phase], weight: 4, opacity: 0.95 }).addTo(drawLayer);
    });
    var exitLL = ll(result.exit.x, result.exit.y);
    var plLL = ll(result.X, result.Y);
    if (result.ft > 0.5) L.polyline([exitLL, plLL], { color: col.FT, weight: 4, dashArray: '6 6' }).addTo(drawLayer);
    L.circleMarker(exitLL, { radius: 5, color: '#fff', weight: 2, fillColor: '#18211c', fillOpacity: 1 }).addTo(drawLayer)
      .bindTooltip('Fim da projeção à frente');

    var h = result.hdg * Math.PI / 180, ux = Math.sin(h), uy = Math.cos(h);
    var circ = circuit();
    if (circ) {
      // circuito previsto da aeronave: PS -> través -> perna do vento -> base -> final -> PS
      L.polyline(circ.pts.map(function (q) { return ll(q.x, q.y); }), { color: '#ffd24a', weight: 2.5, opacity: 0.95, dashArray: '10 8', interactive: false }).addTo(drawLayer);
      circ.legs.forEach(function (g) {
        var html = '<span class="mk-leg"><span class="arr" style="transform:rotate(' + (g.hdg - 90).toFixed(0) + 'deg)">➤</span>' + mmss(g.sec) + '</span>';
        L.marker(ll(g.mid.x, g.mid.y), { icon: L.divIcon({ className: '', html: html, iconSize: [60, 20], iconAnchor: [30, 10] }), interactive: false, keyboard: false }).addTo(drawLayer);
      });
    } else {
      // só o eixo de aproximação
      var back = ll(result.X - ux * 5000, result.Y - uy * 5000);
      var fwd = ll(result.X + ux * 2000, result.Y + uy * 2000);
      L.polyline([back, fwd], { color: col.PS, weight: 2, opacity: 0.8, dashArray: '2 8' }).addTo(drawLayer);
    }

    L.marker(plLL, { icon: icon('mk-pl', 'PS ' + degM(result.hdg)), zIndexOffset: 900, interactive: false }).addTo(drawLayer);
  }

  // Circuito retangular na velocidade verdadeira de lançamento:
  // final até o PS, reta após o PS, través e base com o mesmo tempo, perna do vento paralela à final.
  function circuit() {
    var p = st.params;
    if (!p.circShow || !(p.circFinal > 0) || !(p.circTurn > 0) || !(p.circAfter >= 0) || !result || result.errors.length) return null;
    var v = result.tas * 0.514444;
    if (!(v > 0)) return null;
    var F = v * p.circFinal * 60, O = v * p.circAfter, Lr = F + O, W = v * p.circTurn;
    var h = result.hdg * Math.PI / 180, u = { x: Math.sin(h), y: Math.cos(h) };
    var n = p.circSide === 'D' ? { x: u.y, y: -u.x } : { x: -u.y, y: u.x };
    var P = { x: result.X, y: result.Y };
    var add = function (a, b, k) { return { x: a.x + b.x * k, y: a.y + b.y * k }; };
    var A = add(P, u, O), B = add(A, n, W), C = add(B, u, -Lr), D = add(C, n, -W);
    var mid = function (a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    var hd = function (a, b) { return H.bearing(b.x - a.x, b.y - a.y); };
    return {
      pts: [P, A, B, C, D, P],
      legs: [
        { name: 'Través', mid: mid(A, B), hdg: hd(A, B), sec: W / v },
        { name: 'Perna do vento', mid: mid(B, C), hdg: hd(B, C), sec: Lr / v },
        { name: 'Base', mid: mid(C, D), hdg: hd(C, D), sec: W / v },
        { name: 'Final', mid: mid(D, P), hdg: hd(D, P), sec: F / v }
      ]
    };
  }

  // ---------- ventos ----------
  function renderWinds() {
    var tb = $('windRows');
    tb.innerHTML = '';
    st.layers.forEach(function (L, i) {
      var tr = document.createElement('tr');
      var v = function (n) { return isFinite(n) ? n : ''; };
      tr.innerHTML =
        '<td><input type="number" id="alt-' + i + '" step="500" inputmode="numeric" value="' + v(L.alt) + '" aria-label="Altitude da camada ' + (i + 1) + '"></td>' +
        '<td><input type="number" id="dir-' + i + '" step="5" min="0" max="360" inputmode="numeric" value="' + v(L.dir) + '" placeholder="°" aria-label="Direção do vento da camada ' + (i + 1) + '"></td>' +
        '<td><input type="number" id="spd-' + i + '" step="1" min="0" inputmode="numeric" value="' + v(L.spd) + '" placeholder="kt" aria-label="Velocidade do vento da camada ' + (i + 1) + '"></td>' +
        '<td><button class="btn icon" type="button" data-rm="' + i + '" aria-label="Remover camada ' + (i + 1) + '">✕</button></td>';
      tb.appendChild(tr);
    });
  }
  $('windRows').addEventListener('input', function (e) {
    var m = /^(alt|dir|spd)-(\d+)$/.exec(e.target.id);
    if (!m) return;
    st.layers[+m[2]][m[1]] = num(e.target.value);
    save(); update();
  });
  $('windRows').addEventListener('click', function (e) {
    var b = e.target.closest('[data-rm]');
    if (!b) return;
    st.layers.splice(+b.getAttribute('data-rm'), 1);
    save(); renderWinds(); update();
  });
  $('addLayer').addEventListener('click', function () {
    var top = st.layers.reduce(function (m, L) { return isFinite(L.alt) ? Math.max(m, L.alt) : m; }, -1000);
    st.layers.unshift({ alt: top + 2000, dir: NaN, spd: NaN });
    save(); renderWinds(); update();
    var el = $('dir-0'); if (el) el.focus();
  });
  var clearArmed = false;
  $('clearWinds').addEventListener('click', function () {
    var b = $('clearWinds');
    if (!clearArmed) {
      clearArmed = true; b.textContent = 'Toque de novo para zerar';
      setTimeout(function () { clearArmed = false; b.textContent = 'Zerar ventos'; }, 3000);
      return;
    }
    clearArmed = false; b.textContent = 'Zerar ventos';
    st.layers = DEFAULT_LAYERS.map(function (o) { return Object.assign({}, o); });
    save(); renderWinds(); update();
  });

  // ---------- parâmetros ----------
  function renderParams() {
    PARAM_IDS.forEach(function (id) { $(id).value = isFinite(st.params[id]) ? st.params[id] : ''; });
    document.querySelectorAll('.seg [data-mode]').forEach(function (b) {
      b.setAttribute('aria-checked', b.getAttribute('data-mode') === st.params.hdgMode ? 'true' : 'false');
    });
    $('coneSideBox').hidden = st.params.hdgMode !== 'cone';
    $('coneSide').value = st.params.coneSide;
    $('modeNote').textContent = MODE_NOTES[st.params.hdgMode];
    $('circSide').value = st.params.circSide;
    $('circShow').checked = !!st.params.circShow;
    $('declSide').value = st.params.declSide;
    $('exact').checked = !!st.params.exact;
    syncPidInputs();
  }
  $('declSide').addEventListener('change', function () { st.params.declSide = $('declSide').value; save(); update(); });
  $('exact').addEventListener('change', function () { st.params.exact = $('exact').checked; save(); update(); });
  PARAM_IDS.forEach(function (id) {
    $(id).addEventListener('input', function () { st.params[id] = num($(id).value); save(); update(); });
  });
  document.querySelectorAll('.seg [data-mode]').forEach(function (b) {
    b.addEventListener('click', function () { st.params.hdgMode = b.getAttribute('data-mode'); save(); renderParams(); update(); });
  });
  $('coneSide').addEventListener('change', function () { st.params.coneSide = $('coneSide').value; save(); update(); });
  $('circSide').addEventListener('change', function () { st.params.circSide = $('circSide').value; save(); update(); });
  $('circShow').addEventListener('change', function () { st.params.circShow = $('circShow').checked; save(); update(); });
  $('resetParams').addEventListener('click', function () {
    st.params = Object.assign({}, DEFAULT_PARAMS);
    save(); renderParams(); update();
  });
  ['pidLat', 'pidLon'].forEach(function (id) {
    $(id).addEventListener('change', function () {
      var lat = num($('pidLat').value), lon = num($('pidLon').value);
      if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180) setPid(lat, lon);
    });
  });
  $('pidMark2').addEventListener('click', function () { setMarkMode(true); window.scrollTo(0, 0); $('map').scrollIntoView({ block: 'nearest' }); });
  $('markBtn').addEventListener('click', function () { setMarkMode(!markMode); });
  $('fitBtn').addEventListener('click', fit);
  $('pidHere').addEventListener('click', function () {
    if (!('geolocation' in navigator)) { flash('Este aparelho não oferece localização.'); return; }
    $('pidHere').textContent = 'Obtendo posição…';
    navigator.geolocation.getCurrentPosition(function (p) {
      $('pidHere').textContent = 'Alvo na minha posição';
      setPid(p.coords.latitude, p.coords.longitude);
    }, function (err) {
      $('pidHere').textContent = 'Alvo na minha posição';
      flash(gpsError(err));
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  });

  // ---------- seções recolhíveis ----------
  // Mais de uma pode ficar aberta; o app lembra o que estava aberto.
  SECS.forEach(function (k) {
    var d = $('sec-' + k);
    d.open = !!st.open[k];
    d.addEventListener('toggle', function () {
      st.open[k] = d.open;
      save();
      if (d.open && window.HALO_SHEET && HALO_SHEET.pos() === 'peek') HALO_SHEET.toPos('half');
    });
  });

  // ---------- pedida ao piloto ----------
  // Onde fica o PS em relação ao alvo, medido ao longo do eixo de entrada.
  // O lado aparece sempre na boca do cone e, em nariz e cauda, só quando passa de 50 m.
  function psText(r, mode, long) {
    var u = long ? ' metros' : ' m', parts = [];
    if (Math.abs(r.along) < 10) parts.push('PS no través do alvo');
    else parts.push('PS ' + m10(r.along) + u + (r.along > 0 ? ' depois do alvo' : ' antes do alvo'));
    if (mode === 'cone' || Math.abs(r.side) > 50) parts.push(m10(r.side) + u + ' à ' + (r.side > 0 ? 'direita' : 'esquerda'));
    return parts.join(long ? ' e ' : ' · ');
  }
  function isSel(v) { return v.mode === st.params.hdgMode && (v.mode !== 'cone' || v.side === st.params.coneSide); }

  function frase() {
    var p = st.params, n = hasDecl() ? ' magnético' : ' verdadeiro', t = '';
    if (result.wind !== null) t += 'Resultante ' + fala3(result.wind) + n + '. ';
    t += 'Lançamento ' + MODE_FALA[p.hdgMode] + ', eixo de entrada ' + fala3(result.hdg) + n;
    if (p.hdgMode === 'cone') t += ', vento entrando pela ' + (p.coneSide === 'E' ? 'esquerda' : 'direita');
    return t + '. ' + psText(result, p.hdgMode, true) + '.';
  }

  function renderPedida() {
    var p = st.params, list = $('pedList');
    list.innerHTML = '';
    VARIANTS.forEach(function (v) {
      var r = isSel(v) ? result : H.compute(calcParams({ hdgMode: v.mode, coneSide: v.side }), st.layers);
      if (r.errors.length) return;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'ped-row';
      b.setAttribute('aria-pressed', isSel(v) ? 'true' : 'false');
      b.innerHTML = '<span class="ped-k"></span><span class="ped-v"></span><span class="ped-ps"></span>';
      b.children[0].textContent = MODE_NAME[v.mode] + (v.mode === 'cone' ? (v.side === 'E' ? ' · vento pela esquerda' : ' · vento pela direita') : '');
      b.children[1].textContent = 'eixo ' + degM(r.hdg);
      b.children[2].textContent = psText(r, v.mode);
      b.addEventListener('click', function () {
        p.hdgMode = v.mode;
        if (v.mode === 'cone') p.coneSide = v.side;
        save(); renderParams(); update();
      });
      list.appendChild(b);
    });
    $('pedRes').textContent = 'Resultante ' + (result.wind === null ? '– (vento calmo)' : degM(result.wind)) +
      ' · PS a ' + m10(result.dist) + ' m do alvo, rumo ' + degM(result.brg);
    $('sTipo').textContent = MODE_NAME[p.hdgMode] + (p.hdgMode === 'cone' ? (p.coneSide === 'E' ? ' (vento pela esq.)' : ' (vento pela dir.)') : '') + ' · eixo de entrada';
    $('sHdg').textContent = degM(result.hdg);
    $('sPs').textContent = psText(result, p.hdgMode);
    $('pedFrase').textContent = frase();
    $('pedida').hidden = false;
  }
  $('pedCopy').addEventListener('click', function () {
    var btn = $('pedCopy'), txt = $('pedFrase').textContent;
    var done = function () { btn.textContent = 'Copiado'; setTimeout(function () { btn.textContent = 'Copiar pedida'; }, 2000); };
    if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, function () { flash(txt); });
    else flash(txt);
  });

  // Resumo de cada seção, para ler com ela fechada
  function renderSecValues() {
    var p = st.params;
    $('vModo').textContent = MODE_NAME[p.hdgMode] + (p.hdgMode === 'cone' ? (p.coneSide === 'E' ? ' · esq.' : ' · dir.') : '');
    var filled = st.layers.filter(function (L) { return isFinite(L.dir) && isFinite(L.spd); }).length;
    $('vVentos').textContent = filled + ' de ' + st.layers.length + ' camadas';
    $('vSalto').textContent = (isFinite(p.exit) ? fmt(p.exit) : '–') + ' / ' + (isFinite(p.open) ? fmt(p.open) : '–') + ' ft · ' +
      (hasDecl() ? 'decl. ' + fmt(p.decl, p.decl % 1 ? 1 : 0) + '° ' + p.declSide : 'sem declinação');
  }

  // ---------- cálculo e resumo ----------
  var transient = null;
  function flash(t) { transient = t; renderMsgs(); setTimeout(function () { if (transient === t) { transient = null; renderMsgs(); } }, 6000); }
  function renderMsgs() {
    var box = $('msgs'); box.innerHTML = '';
    var list = [];
    if (transient) list.push(transient);
    if (result) list = list.concat(result.errors.length ? result.errors : result.warns);
    if (result && !result.errors.length && !hasDecl()) list.push('Eixo em norte VERDADEIRO: falta a declinação magnética (seção Salto).');
    list.forEach(function (m) { var d = document.createElement('div'); d.className = 'msg'; d.textContent = m; box.appendChild(d); });
  }

  function update() {
    var p = st.params;
    var allEmpty = st.layers.every(function (L) { return !isFinite(L.dir) && !isFinite(L.spd); });
    result = allEmpty ? { errors: ['Preencha os ventos por camada na seção Ventos.'] } : H.compute(calcParams(), st.layers);
    renderMsgs();
    renderSecValues();

    var tas = H.tasFromIas(p.ias, p.exit);
    var tot = 2 * (p.circAfter + p.circFinal * 60) + 2 * p.circTurn;
    $('circInfo').textContent = isFinite(tot) && tot > 0 && isFinite(tas)
      ? 'Circuito completo ≈ ' + mmss(tot) + ' · final de ' + fmt(tas * 0.514444 * p.circFinal * 60 / 1000, 1) + ' km'
      : '–';
    $('ftInfo').textContent = isFinite(tas) && isFinite(p.ftSec)
      ? 'TAS ≈ ' + fmt(tas) + ' kt → ' + fmt(tas * 0.514444 * p.ftSec) + ' m'
      : '–';

    if (result.errors.length) {
      $('sTipo').textContent = 'Eixo de entrada';
      $('sHdg').textContent = '–';
      $('sPs').textContent = allEmpty ? 'preencha os ventos' : 'cálculo incompleto';
      $('pedida').hidden = true;
      $('sCoords').textContent = st.pid ? 'Coordenadas do PS aparecem quando o cálculo estiver completo.' : 'Marque o alvo para ver as coordenadas do PS.';
      $('calcRows').innerHTML = '';
    } else {
      renderPedida();
      renderCoords();
      renderCalc();
    }
    draw();
    updateNav();
  }

  function renderCoords() {
    var box = $('sCoords');
    box.innerHTML = '';
    if (!st.pid) { box.textContent = 'Marque o alvo para ver as coordenadas do PS.'; return; }
    var pl = H.offset(st.pid.lat, st.pid.lon, result.X, result.Y);
    var u = H.utm(pl[0], pl[1]);
    var lines = [
      'PS  ' + pl[0].toFixed(5) + ', ' + pl[1].toFixed(5),
      '    ' + H.dms(pl[0], 'N', 'S') + '  ' + H.dms(pl[1], 'E', 'W'),
      '    UTM ' + u.zone + u.band + '  ' + Math.round(u.E) + ' E  ' + Math.round(u.N) + ' N'
    ];
    lines.forEach(function (t) { var d = document.createElement('span'); d.textContent = t; box.appendChild(d); });
    var btn = document.createElement('button');
    btn.className = 'btn small copy'; btn.type = 'button'; btn.textContent = 'Copiar coordenadas do PS';
    btn.addEventListener('click', function () {
      var txt = pl[0].toFixed(6) + ', ' + pl[1].toFixed(6);
      var done = function () { btn.textContent = 'Copiado'; setTimeout(function () { btn.textContent = 'Copiar coordenadas do PS'; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, function () { flash(txt); });
      else flash(txt);
    });
    box.appendChild(btn);
  }

  function renderCalc() {
    var html = '';
    result.rows.slice().reverse().forEach(function (q) {
      var isQL = q.phase === 'QL';
      html += '<tr><td>' + fmt(q.alt) + '</td><td>' + fmt(q.hi) + '→' + fmt(q.lo) + '</td>' +
        '<td><span class="tag" style="--c:var(--' + (isQL ? 'ff' : 'va') + ')">' + (isQL ? 'Queda livre' : 'Velame') + '</span></td>' +
        '<td>' + deg3(q.dir) + '/' + fmt(q.spd) + ' kt</td><td>' + fmt(q.K, q.K % 1 ? 1 : 0) + '</td><td>' + fmt(q.A, q.A % 1 ? 1 : 0) + '</td>' +
        '<td>' + fmt(q.D, 1) + '</td><td>' + fmt(q.x, 1) + '</td><td>' + fmt(q.y, 1) + '</td></tr>';
    });
    if (result.ft > 0.05) {
      html += '<tr><td colspan="3">Projeção à frente</td><td>proa ' + deg3(result.hdg) + ' V</td><td></td><td></td><td>' + fmt(result.ft, 1) + '</td><td>' + fmt(result.fx, 1) + '</td><td>' + fmt(result.fy, 1) + '</td></tr>';
    }
    html += '<tr class="tot"><td colspan="6">PS: ' + fmt(result.dist) + ' m, rumo ' + deg3(result.brg) + ' V</td><td></td><td>' + fmt(result.X, 1) + '</td><td>' + fmt(result.Y, 1) + '</td></tr>';
    $('calcRows').innerHTML = html;
  }

  // ---------- GPS ----------
  var watchId = null, me = null, last = null, gs = null, trk = null, follow = false, wakeLock = null;
  var meMarker = null, accCircle = null;

  function gpsError(err) {
    if (!err) return 'Não foi possível obter a posição.';
    if (err.code === 1) return 'Permissão de localização negada. Libere a localização para este site nas configurações do navegador.';
    if (err.code === 2) return 'Posição indisponível. Aproxime o celular de uma janela e aguarde o sinal.';
    if (err.code === 3) return 'O GPS demorou para responder. Aguarde o sinal.';
    return 'Não foi possível obter a posição.';
  }
  function setGpsUi(state, label) {
    $('gpsBtn').setAttribute('data-state', state);
    $('gpsLabel').textContent = label;
    $('gpsBtn2').textContent = watchId !== null ? 'Desligar GPS' : 'Ligar GPS';
  }
  function gpsToggle() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId); watchId = null;
      releaseWake();
      setGpsUi('off', 'GPS desligado');
      updateNav();
      return;
    }
    if (!('geolocation' in navigator)) { setGpsUi('err', 'Sem GPS'); flash('Este aparelho não oferece localização.'); return; }
    watchId = navigator.geolocation.watchPosition(onPos, function (err) {
      setGpsUi('err', 'Erro de GPS');
      flash(gpsError(err));
    }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 30000 });
    setGpsUi('wait', 'Buscando sinal…');
    requestWake();
  }
  $('gpsBtn').addEventListener('click', gpsToggle);
  $('gpsBtn2').addEventListener('click', gpsToggle);
  $('followBtn').addEventListener('click', function () {
    follow = !follow;
    $('followBtn').setAttribute('aria-pressed', follow ? 'true' : 'false');
    $('followBtn').textContent = follow ? 'Seguindo minha posição' : 'Seguir minha posição';
    if (follow && me) map.panTo([me.lat, me.lon]);
  });

  function onPos(p) {
    var c = p.coords;
    var now = { lat: c.latitude, lon: c.longitude, t: p.timestamp, acc: c.accuracy };
    var measured = null;
    if (c.speed !== null && isFinite(c.speed)) measured = c.speed;
    else if (last) {
      var dt = (now.t - last.t) / 1000;
      if (dt >= 0.5) { var d = H.toXY(last.lat, last.lon, now.lat, now.lon); measured = Math.hypot(d.x, d.y) / dt; }
    }
    if (measured !== null) gs = gs === null ? measured : gs * 0.6 + measured * 0.4;
    if (c.heading !== null && isFinite(c.heading) && gs > 3) trk = c.heading;
    else if (last) {
      var dd = H.toXY(last.lat, last.lon, now.lat, now.lon);
      if (Math.hypot(dd.x, dd.y) > 8) trk = H.bearing(dd.x, dd.y);
    }
    last = now; me = now;
    setGpsUi('on', 'GPS ±' + fmt(c.accuracy) + ' m');

    if (!meMarker) {
      accCircle = L.circle([me.lat, me.lon], { radius: c.accuracy, color: '#1d6fe0', weight: 1, fillOpacity: 0.1, interactive: false }).addTo(map);
      meMarker = L.marker([me.lat, me.lon], { icon: L.divIcon({ className: '', html: '<div class="mk-me"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), interactive: false, zIndexOffset: 1100 }).addTo(map);
      if (!st.pid) map.setView([me.lat, me.lon], 14);
    } else {
      meMarker.setLatLng([me.lat, me.lon]);
      accCircle.setLatLng([me.lat, me.lon]).setRadius(c.accuracy);
    }
    if (follow) map.panTo([me.lat, me.lon], { animate: false });
    updateNav();
  }

  function updateNav() {
    var box = $('navBox');
    var set = function (id, t) { $(id).textContent = t; };
    set('nAcc', me ? '±' + fmt(me.acc) + ' m' : '–');
    set('nGs', gs !== null ? fmt(gs / 0.514444) + ' kt' : '–');
    set('nTrk', (trk !== null ? degM(trk) : '–') + ' / ' + (result && !result.errors.length ? degM(result.hdg) : '–'));
    if (!me || !st.pid || !result || result.errors.length) {
      $('vNav').textContent = watchId === null ? 'GPS desligado' : 'aguardando';
      box.setAttribute('data-state', 'idle');
      set('nEta', '–:–'); set('nAlong', '–'); set('nCross', '–'); set('nBrg', '–');
      set('nState', !st.pid ? 'Marque o alvo na seção Salto ou no mapa.'
        : (!result || result.errors.length) ? 'Complete os ventos para calcular o PS.'
        : watchId === null ? 'Ligue o GPS para navegar até o PS.' : 'Aguardando sinal do GPS…');
      return;
    }
    var pos = H.toXY(st.pid.lat, st.pid.lon, me.lat, me.lon);
    var n = H.nav(pos, { x: result.X, y: result.Y }, result.hdg, gs || 0);
    set('nAlong', (n.along >= 0 ? '' : '−') + fmt(Math.abs(n.along)) + ' m');
    set('nCross', Math.abs(n.cross) < 15 ? 'no eixo' : fmt(Math.abs(n.cross)) + ' m à ' + (n.cross > 0 ? 'direita' : 'esquerda'));
    set('nBrg', degM(n.brg) + ' · ' + fmt(n.direct) + ' m');
    var state, msg;
    if (n.along < 0) {
      state = 'past'; set('nEta', '0:00'); msg = 'PS ultrapassado há ' + fmt(-n.along) + ' m';
    } else if (n.eta === null) {
      state = 'idle'; set('nEta', '–:–'); msg = 'Velocidade muito baixa para estimar o tempo.';
    } else {
      set('nEta', mmss(n.eta));
      if (n.eta <= 5) { state = 'now'; msg = 'Sobre o PS'; }
      else if (n.eta <= 60) { state = 'near'; msg = 'Aproximando do PS'; }
      else { state = 'idle'; msg = 'A caminho do PS'; }
    }
    box.setAttribute('data-state', state);
    set('nState', msg);
    $('vNav').textContent = (n.eta !== null && n.along >= 0 ? mmss(n.eta) + ' · ' : '') + msg;
  }

  // Tela ligada enquanto o GPS estiver ativo
  function requestWake() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; }).catch(function () { /* opcional */ });
  }
  function releaseWake() { if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && watchId !== null) requestWake();
  });

  // ---------- offline ----------
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').then(function () {
      $('swStatus').textContent = ' O app funciona sem internet depois da primeira abertura; o mapa fica disponível nas áreas já visualizadas.';
    }).catch(function () { /* sem offline */ });
  }

  // ---------- início ----------
  renderWinds();
  renderParams();
  update();
  if (st.pid) map.setView([st.pid.lat, st.pid.lon], 14);
  if (st.pid) setTimeout(fit, 50);
  else hint('Toque em "Marcar alvo no mapa" e depois no ponto onde quer pousar.');

  window.__halo = { state: function () { return st; }, result: function () { return result; } };
})();
