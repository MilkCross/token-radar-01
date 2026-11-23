// Token Launch Radar. Reads window.RADAR (data.js, written by main.ts from the snapshot). No network.
(function () {
  'use strict';
  var D = window.RADAR;
  var root = document.getElementById('app');
  if (!D) { root.textContent = 'No data: data.js did not load.'; return; }
  var rows = D.rows;
  var S = { q: '', cat: '', chain: '', wl: false, early: false, pos: false, tvl: 0, key: 'rank', dir: 1 };
  var view = 'board';

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function fmtAge(d) { return d === null || d === undefined ? 'n/a' : d >= 365 ? (d / 365).toFixed(1) + 'y' : d + 'd'; }
  function fmtX(n) { return 'x' + (n >= 10 ? n.toFixed(1) : n.toFixed(2)); }
  function why(r) { return fmtX(r.model.peer_multiple) + ' peers n=' + r.model.peer_count + (r.model.peer_count <= 1 ? ' (thin)' : ''); }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
      else n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return n;
  }
  function stat(v, label) { return el('div', { class: 'stat' }, el('b', { text: String(v) }), el('span', { text: label })); }
  function pctCell(v) { return el('td', { class: 'n ' + (v === null ? 'dim' : v >= 0 ? 'up' : 'down'), text: fmtPct(v) }); }
  function uniq(list) { return list.filter(function (x, i) { return x && list.indexOf(x) === i; }).sort(); }

  // ---- header and tabs
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('div', { class: 'dot', 'aria-hidden': 'true' }),
        el('div', {}, el('h1', { text: 'Token Launch Radar' }),
          el('p', { class: 'sub', text: 'Snapshot as of ' + D.as_of + ' · pre-token protocols ranked by implied value' }))),
      el('div', { class: 'stats' },
        stat(D.protocols_scanned, 'protocols scanned'), stat(D.watchlist_size, 'watchlist'),
        stat(D.board_size, 'board rows'), stat(D.live_size, 'live set aside')));
  }
  function modelLine() {
    return el('p', { class: 'model-line' },
      el('b', { text: D.model_version + ': ' }),
      'implied value = TVL × peer mcap/TVL multiple (shrunk toward the global median of ' + fmtX(D.global_median_multiple) + ', from ' + D.peer_total + ' token-bearing peers) × size, growth, maturity and chain adjustments; category multiples are capped at the peer p90 (' + fmtX(D.peer_cap_multiple) + '). Every figure comes from the snapshot; the model is a claim, not a prediction.');
  }
  function tabs() {
    var defs = [['board', 'Board'], ['comparables', 'Comparables'], ['live', 'Live tokens']];
    return el('nav', { class: 'tabs', role: 'tablist' }, defs.map(function (d) {
      return el('button', { role: 'tab', 'aria-selected': String(view === d[0]), text: d[1], onclick: function () { go(d[0]); } });
    }));
  }

  // ---- board
  var COLS = [
    ['rank', 'Rank', true], ['name', 'Protocol', false], ['category', 'Category', false], ['chains', 'Chains', true],
    ['tvl_usd', 'TVL', true], ['change_7d', '7d %', true], ['age_days', 'Age', true], ['implied_value_usd', 'Implied value', true], ['why', 'Why', true]
  ];
  function sortVal(r, k) {
    if (k === 'chains') return r.chains.length;
    if (k === 'why') return r.model.peer_multiple;
    var v = r[k];
    return v === null || v === undefined ? null : v;
  }
  function filtered() {
    var q = S.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (q && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(q) < 0) return false;
      if (S.cat && (r.category || 'Uncategorized') !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.wl && !r.watchlist) return false;
      if (S.early && r.watchlist) return false;
      if (S.pos && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (S.tvl && r.tvl_usd < S.tvl) return false;
      return true;
    });
    out.sort(function (a, b) {
      var x = sortVal(a, S.key), y = sortVal(b, S.key);
      if (x === null && y === null) return a.rank - b.rank;
      if (x === null) return 1;
      if (y === null) return -1;
      var c = typeof x === 'string' ? x.localeCompare(y) : x - y;
      return c !== 0 ? S.dir * c : a.rank - b.rank;
    });
    return out;
  }
  function select(label, opts, cur, on) {
    return el('select', { 'aria-label': label, onchange: function (e) { on(e.target.value); } },
      opts.map(function (o) { return el('option', { value: o[0], selected: String(o[0]) === String(cur) }, o[1]); }));
  }
  function check(label, key) {
    return el('label', {}, el('input', { type: 'checkbox', checked: S[key], onchange: function (e) { S[key] = e.target.checked; draw(); } }), label);
  }
  function boardView() {
    var list = filtered();
    var cats = uniq(rows.map(function (r) { return r.category || 'Uncategorized'; }));
    var chains = uniq([].concat.apply([], rows.map(function (r) { return r.chains; })));
    var search = el('input', { type: 'search', placeholder: 'Search protocol or category', 'aria-label': 'Search', value: S.q });
    search.addEventListener('input', function (e) { S.q = e.target.value; update(); });
    var controls = el('div', { class: 'controls' }, search,
      select('Category', [['', 'All categories']].concat(cats.map(function (c) { return [c, c]; })), S.cat, function (v) { S.cat = v; draw(); }),
      select('Chain', [['', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), S.chain, function (v) { S.chain = v; draw(); }),
      select('Minimum TVL', [[0, 'TVL: any'], [1e7, 'TVL ≥ $10M'], [5e7, 'TVL ≥ $50M'], [1e8, 'TVL ≥ $100M'], [5e8, 'TVL ≥ $500M']], S.tvl, function (v) { S.tvl = +v; draw(); }),
      check('Watchlist only', 'wl'), check('Early only', 'early'), check('Positive 7d only', 'pos'),
      el('span', { class: 'count', id: 'count' }));
    var box = el('div', { class: 'tablebox', id: 'tbox' });
    var wrap = el('div', {}, controls, box);
    wrap.update = function () { fillTable(box, controls.querySelector('#count')); };
    fillTable(box, controls.querySelector('#count'));
    boardUpdate = wrap.update;
    return wrap;
  }
  var boardUpdate = null;
  function update() { if (boardUpdate) boardUpdate(); }
  function fillTable(box, count) {
    var list = filtered();
    count.textContent = list.length + ' of ' + rows.length + ' rows';
    box.textContent = '';
    if (!list.length) { box.appendChild(el('p', { class: 'empty', text: 'No protocol matches these filters.' })); return; }
    var head = el('tr', {}, COLS.map(function (c) {
      var active = S.key === c[0];
      return el('th', { scope: 'col', class: c[2] ? 'n' : '', 'aria-sort': active ? (S.dir > 0 ? 'ascending' : 'descending') : null },
        el('button', { type: 'button', text: c[1], onclick: function () {
          if (S.key === c[0]) S.dir = -S.dir; else { S.key = c[0]; S.dir = (c[0] === 'name' || c[0] === 'category' || c[0] === 'rank') ? 1 : -1; }
          draw();
        } }));
    }));
    var body = list.map(function (r) {
      var open = function () { go('p/' + r.slug); };
      var tr = el('tr', { tabindex: '0', onclick: open, onkeydown: function (e) { if (e.key === 'Enter') open(); } },
        el('td', { class: 'n dim', text: '#' + r.rank }),
        el('td', { class: 'name' }, r.name, el('span', { class: 'badge ' + (r.watchlist ? 'wl' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' })),
        el('td', { class: 'cat dim', text: r.category || 'Uncategorized' }),
        el('td', { class: 'n dim', text: String(r.chains.length), title: r.chains.join(', ') }),
        el('td', { class: 'n', text: fmtUsd(r.tvl_usd) }),
        pctCell(r.change_7d),
        el('td', { class: 'n dim', text: fmtAge(r.age_days) }),
        el('td', { class: 'n val', text: fmtUsd(r.implied_value_usd) }),
        el('td', { class: 'n dim', text: why(r) }));
      return tr;
    });
    box.appendChild(el('table', {}, el('thead', {}, head), el('tbody', {}, body)));
  }

  // ---- detail
  function bar(label, v, lo, hi, note) {
    var width = Math.min(Math.abs(v - 1) / ((hi - lo) / 2) * 50, 50);
    var track = el('div', { class: 'track' }, el('u'), el('i', { class: v < 1 ? 'neg' : '', style: 'left:' + (v < 1 ? 50 - width : 50) + '%;width:' + width + '%' }));
    return el('div', { class: 'bar', title: note }, el('span', { text: label }), track, el('span', { class: 'v', text: 'x' + v.toFixed(3) }));
  }
  function detail(r) {
    var m = r.model;
    var plan = r.farm_steps.map(function (s) {
      var ci = s.lastIndexOf(' Cost: '), ti = s.lastIndexOf(' Time: ');
      var act = ci > 0 ? s.slice(0, ci) : s;
      var cost = ci > 0 && ti > ci ? s.slice(ci + 7, ti).replace(/\.$/, '') : '';
      var time = ti > 0 ? s.slice(ti + 7).replace(/\.$/, '') : '';
      return el('li', {}, el('div', {}, el('p', { text: act }),
        el('div', { class: 'meta' }, el('span', { class: 'c', text: 'Cost: ' + cost }), el('span', { class: 't', text: 'Time: ' + time }))));
    });
    var product = m.peer_multiple * m.size_adj * m.growth_adj * m.maturity_adj * m.chain_adj;
    return el('div', {},
      el('button', { class: 'back', type: 'button', text: '← Back to board', onclick: function () { go('board'); } }),
      el('div', { class: 'dhead' },
        el('div', {}, el('h2', { text: r.name }),
          el('p', { class: 'sub' }, (r.category || 'Uncategorized') + ' · ' + (r.chains.join(', ') || 'no chain listed') + ' · rank #' + r.rank + ' of ' + rows.length,
            el('span', { class: 'badge ' + (r.watchlist ? 'wl' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' }))),
        el('div', {}, el('p', { class: 'sub', text: 'Implied value' }), el('div', { class: 'big', text: fmtUsd(r.implied_value_usd) }))),
      el('div', { class: 'grid' },
        el('section', { class: 'card' }, el('h3', { text: 'Snapshot figures' }),
          el('dl', { class: 'facts' },
            fact('Slug', r.slug), fact('TVL', '$' + r.tvl_usd.toLocaleString('en-US')), fact('TVL change 7d', fmtPct(r.change_7d)),
            fact('Listed', r.listed_at || 'n/a'), fact('Age', r.age_days === null ? 'n/a (365d assumed)' : r.age_days + ' days'),
            fact('Chains', String(r.chains.length)), fact('Token', 'none recorded'),
            fact('Implied value', '$' + r.implied_value_usd.toLocaleString('en-US')))),
        el('section', { class: 'card' }, el('h3', { text: 'Model breakdown' }),
          el('div', { class: 'bars' },
            el('div', { class: 'bar' }, el('span', { text: 'Peer multiple' }), el('span', { class: 'num', text: 'mcap/TVL' }), el('span', { class: 'v', text: fmtX(m.peer_multiple) })),
            bar('Size adj.', m.size_adj, 0.6, 1.4, 'Large TVL is discounted'), bar('Growth adj.', m.growth_adj, 0.6, 1.4, '7d TVL change'),
            bar('Maturity adj.', m.maturity_adj, 0.6, 1.4, 'Age since listing'), bar('Chain adj.', m.chain_adj, 0.6, 1.4, 'Chain breadth')),
          el('p', { class: 'eq' }, 'Peers: ', el('b', { text: m.peer_count }), ' in category (global median ' + fmtX(D.global_median_multiple) + ' fills the rest).',
            m.peer_count <= 1 ? el('span', { class: 'down', text: ' Thin comparables: treat this multiple as low confidence.' }) : null,
            el('br'), '$' + r.tvl_usd.toLocaleString('en-US') + ' × ' + product.toFixed(4) + ' = ', el('b', { text: '$' + r.implied_value_usd.toLocaleString('en-US') })))),
      el('section', { class: 'card mt' }, el('h3', { text: '7-step farm plan' }), el('ol', { class: 'plan' }, plan)));
  }
  function fact(k, v) { return [el('dt', { text: k }), el('dd', { text: String(v) })]; }

  // ---- comparables
  function comparablesView() {
    var peers = D.peers.map(function (p) {
      return el('tr', {}, el('td', { text: p.category }), el('td', { class: 'n', text: String(p.n) }), el('td', { class: 'n val', text: fmtX(p.median_multiple) }),
        el('td', { class: 'n dim', text: fmtX(Math.min(D.peer_cap_multiple, (p.n * p.median_multiple + D.model.prior_weight * D.global_median_multiple) / (p.n + D.model.prior_weight))) }));
    });
    var M = D.model;
    return el('div', {},
      el('p', { class: 'note', text: 'Comparables are the ' + D.peer_total + ' protocols in this snapshot that already have a market cap and TVL. Their mcap/TVL ratios, not a hand-set constant, calibrate every pre-token row.' }),
      el('div', { class: 'grid' },
        el('section', { class: 'tablebox' }, el('table', {},
          el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { class: 'n', text: 'Peers n' }), el('th', { class: 'n', text: 'Median mcap/TVL' }), el('th', { class: 'n', text: 'Shrunk (n+' + M.prior_weight + ')' }))),
          el('tbody', {}, peers))),
        el('section', { class: 'card' }, el('h3', { text: 'The model in words' }),
          el('div', { class: 'prose' },
            el('p', {}, el('b', { text: 'Peer multiple. ' }), 'Median mcap/TVL of the category, blended with the global median (' + fmtX(D.global_median_multiple) + '): (n×category + ' + M.prior_weight + '×global) / (n + ' + M.prior_weight + '), capped at the peer p90 (' + fmtX(D.peer_cap_multiple) + '). A category with no peers uses the global median.'),
            el('p', {}, el('b', { text: 'Size. ' }), 'Above $10M of TVL, divide by 1 + ' + M.size_slope + '×log10(TVL/$10M): big pools are worth fewer cents per dollar.'),
            el('p', {}, el('b', { text: 'Growth. ' }), '1 + (' + M.growth_up + ' if g≥0 else ' + M.growth_down + ')×tanh(g/' + M.growth_scale + '), g = 7d TVL change; when unreported, the median of the pre-token protocols in its category. Falls cost more than rises pay.'),
            el('p', {}, el('b', { text: 'Maturity. ' }), M.maturity_floor + ' + ' + M.maturity_range + '×log1p(age/' + M.maturity_scale_days + ') / log1p(' + M.maturity_cap_days + '/' + M.maturity_scale_days + '), age capped at ' + M.maturity_cap_days + ' days; unknown age counts as ' + M.unknown_age_days + '.'),
            el('p', {}, el('b', { text: 'Chains. ' }), '+' + (M.chain_step * 100) + '% per extra chain, up to ' + M.chain_cap + '.'),
            el('p', {}, el('b', { text: 'Implied value ' }), '= TVL × peer multiple × size × growth × maturity × chain, rounded to whole dollars. Ranked board rows are pre-token only: no market cap, CoinGecko id or symbol recorded.')))));
  }

  // ---- live
  function liveView() {
    var trs = D.live.map(function (r, i) {
      return el('tr', { style: 'cursor:default' }, el('td', { class: 'n dim', text: String(i + 1) }),
        el('td', { class: 'name' }, r.name, el('span', { class: 'badge live', text: 'Trading' })),
        el('td', { class: 'cat dim', text: r.category || 'Uncategorized' }), el('td', { class: 'n', text: fmtUsd(r.tvl_usd) }),
        pctCell(r.change_7d), el('td', { class: 'n val', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'n dim', text: r.tvl_usd > 0 && r.mcap_usd ? fmtX(r.mcap_usd / r.tvl_usd) : 'n/a' }));
    });
    return el('div', {},
      el('p', { class: 'note', text: 'These ' + D.live_size + ' protocols already trade a token. Their market cap is the market’s own value, not the model’s, so they are set aside and never ranked on the board. Their ratios are the comparables the board is calibrated on.' }),
      el('div', { class: 'tablebox' }, el('table', {},
        el('thead', {}, el('tr', {}, ['#', 'Protocol', 'Category', 'TVL', '7d %', 'Market cap', 'mcap/TVL'].map(function (h, i) { return el('th', { class: i > 2 ? 'n' : '', text: h }); }))),
        el('tbody', {}, trs))));
  }

  // ---- routing and render
  function go(v) { location.hash = '#/' + v; }
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('p/') === 0) { view = h; return; }
    view = h === 'comparables' || h === 'live' ? h : 'board';
  }
  function draw() {
    route();
    boardUpdate = null;
    var inner;
    if (view.indexOf('p/') === 0) {
      var r = rows.filter(function (x) { return x.slug === view.slice(2); })[0];
      inner = r ? detail(r) : el('p', { class: 'empty', text: 'Unknown protocol.' });
    } else if (view === 'comparables') inner = comparablesView();
    else if (view === 'live') inner = liveView();
    else inner = boardView();
    var keep = view === 'board' && document.activeElement && document.activeElement.type === 'search';
    root.textContent = '';
    root.appendChild(el('div', { class: 'wrap' }, header(), modelLine(), view.indexOf('p/') === 0 ? null : tabs(), el('main', {}, inner)));
    if (keep) { var s = root.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
    document.title = view.indexOf('p/') === 0 && r ? r.name + ' · Token Launch Radar' : 'Token Launch Radar';
  }
  window.addEventListener('hashchange', function () { window.scrollTo(0, 0); draw(); });
  draw();
})();
