// Token Launch Radar. Reads window.RADAR (data.js, written by main.ts from the snapshot). No network.
(function () {
  'use strict';
  var D = window.RADAR;
  var root = document.getElementById('app');
  if (!D) { root.textContent = 'No data: data.js did not load.'; return; }
  var rows = D.rows;
  var S = { q: '', cat: '', chain: '', wl: false, early: false, pos: false, tvl: 0, key: 'rank', dir: 1, sel: rows[0].slug };
  var view = 'board';
  var lnLo = Math.log(Math.min.apply(null, rows.map(function (r) { return r.value_low; })));
  var lnSpan = Math.log(Math.max.apply(null, rows.map(function (r) { return r.value_high; }))) - lnLo;

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
  function why(r) { return fmtX(r.model.peer_multiple) + ' n=' + r.model.peer_count + ' (' + Math.round(r.model.confidence * 100) + '%)'; }
  function fmtOdds(o) { return Math.round(o * 100) + '%'; }
  function full(n) { return '$' + n.toLocaleString('en-US'); }
  function range(r) { return fmtUsd(r.value_low) + ' – ' + fmtUsd(r.value_high); }
  function gainWord(a, b) { var g = Math.round((1 - a / b) * 100); return g + '% lower, a ' + (g < 10 ? 'small' : g < 25 ? 'modest' : 'clear') + ' gain'; }

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
  function fact(k, v) { return [el('dt', { text: k }), el('dd', { text: String(v) })]; }
  function card(title) { return el('section', { class: 'card' }, el('h3', { text: title }), [].slice.call(arguments, 1)); }
  // A table: head labels, then rows of strings or nodes; columns from index `ni` on are right-aligned numbers.
  function tbl(heads, data, ni) {
    return el('div', { class: 'tablebox' }, el('table', {},
      el('thead', {}, el('tr', {}, heads.map(function (h, i) { return el('th', { class: i >= ni ? 'n' : '', text: h }); }))),
      el('tbody', {}, data.map(function (r) { return el('tr', { style: 'cursor:default' }, r.map(function (c, i) { return el('td', { class: i >= ni ? 'n' : '' }, c); })); }))));
  }
  function p(text, cls) { return el('p', { class: cls || 'eq', text: text }); }

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
      'implied value = TVL × peer mcap/TVL multiple (shrunk toward the global median of ' + fmtX(D.global_median_multiple) + ', from ' + D.peer_total + ' token-bearing peers; blended with the category family under 3 peers, capped at the peer p90 of ' + fmtX(D.peer_cap_multiple) + ') × size, growth, maturity and chain adjustments fitted by Huber regression (each clamped to 0.5–2, and so is their product). Ranges are the peers’ own P25–P75 miss. Odds are a launch propensity fitted on the peers’ record. Every figure comes from the snapshot; the model is a claim, not a prediction.');
  }
  function tabs() {
    var defs = [['board', 'Board'], ['model', 'Model'], ['comparables', 'Comparables'], ['live', 'Live tokens']];
    return el('nav', { class: 'tabs', role: 'tablist' }, defs.map(function (d) {
      return el('button', { role: 'tab', 'aria-selected': String(view === d[0]), text: d[1], onclick: function () { go(d[0]); } });
    }));
  }

  // ---- integrity strip, coverage and fit panels
  function kpi(v, label) { return el('div', { class: 'kpi' }, el('b', { text: String(v) }), el('span', { text: label })); }
  function coverageLine() {
    var c = D.coverage, w = Object.keys(c.excluded_reasons).map(function (k) { return c.excluded_reasons[k] + ' ' + k; }).join(', ');
    return c.total + ' = ' + c.ranked + ' ranked + ' + c.tokenized + ' tokenized + ' + c.excluded + ' excluded as product type (' + w + ') + ' + c.other_pre_token + ' other pre-token not ranked';
  }
  function fitPanel() {
    var f = D.fit;
    return card('Model fit (' + f.fit_method + ') and out-of-fold check',
      tbl(['Feature', 'Coef (all peers)', 'Mean'], f.features.map(function (n, i) {
        return [n, f.fallback ? 'n/a' : f.coefficients[i].toFixed(4), f.fallback || i === 0 ? '' : f.means[i - 1].toFixed(3)];
      }), 1),
      el('p', { class: 'eq' }, 'Huber IRLS target: ln(mcap / (TVL × category multiple)), ' + f.peers_fit_all + ' peers; OLS start, 25 passes, delta 1.345 × MAD' + (f.fallback ? '; degenerate, radar-2 constants used' : '') + '.', el('br'),
        'Out of fold, median abs log error: ', el('b', { text: f.error_fitted.toFixed(3) }), ' fitted vs ', el('b', { text: f.error_median_only.toFixed(3) }), ' category multiple only (' + gainWord(f.error_fitted, f.error_median_only) + '; typical miss ~' + Math.exp(f.error_fitted).toFixed(1) + 'x).'));
  }
  function coveragePanel() {
    var c = D.coverage, ex = c.excluded_reasons;
    var rowsC = [['Already tokenized', c.tokenized], ['On the board', c.ranked], ['Excluded as product type', c.excluded]].concat(Object.keys(ex).map(function (k) { return ['  of which ' + k, ex[k]]; })).concat([['Other pre-token, not ranked', c.other_pre_token], ['Total', c.total]]);
    return card('Coverage: every protocol accounted for',
      el('dl', { class: 'facts' }, [].concat.apply([], rowsC.map(function (x) { return fact(x[0], x[1]); }))),
      p('Buckets are exclusive, in priority order. Floor $' + c.floor_usd.toLocaleString('en-US') + ' TVL, snapshot ' + c.as_of + '.'));
  }
  function strip() {
    var f = D.fit, rc = D.recon;
    return el('div', { class: 'strip' },
      el('div', { class: 'kpis' }, kpi(D.as_of, 'snapshot'), kpi(D.board_size, 'board rows'), kpi(D.peer_total, 'peers used'),
        kpi(f.error_fitted.toFixed(2) + ' vs ' + f.error_median_only.toFixed(2), 'out-of-fold error: fitted vs category only'), kpi(D.coverage.total, 'protocols accounted for')),
      p(rc.rows + ' rows · Σ implied ' + full(rc.sum_implied_usd) + ' · build ' + rc.build, 'cov'),
      p(coverageLine(), 'cov'),
      el('details', {}, el('summary', { text: 'Model fit, validation and coverage' }), el('div', { class: 'grid' }, fitPanel(), coveragePanel())));
  }

  // ---- board
  var COLS = [
    ['rank', 'Rank', true], ['name', 'Protocol', false], ['category', 'Category', false], ['chains', 'Chains', true],
    ['tvl_usd', 'TVL', true], ['change_7d', '7d %', true], ['age_days', 'Age', true], ['implied_value_usd', 'Implied value', true], ['launch_odds', 'Odds', true], ['risk_adjusted_usd', 'Adj. value', true], ['why', 'Why', true]
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
  var boardUpdate = null;
  function update() { if (boardUpdate) boardUpdate(); }
  function boardView() {
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
    var box = el('div', { class: 'tablebox scroll', id: 'tbox' });
    var pane = el('section', { id: 'detail', 'aria-live': 'polite' });
    showDetail(pane);
    boardUpdate = function () { fillTable(box, controls.querySelector('#count'), pane); };
    boardUpdate();
    return el('div', {}, strip(), controls, box, pane);
  }
  function showDetail(pane) {
    var r = rows.filter(function (x) { return x.slug === S.sel; })[0] || rows[0];
    pane.textContent = '';
    pane.appendChild(detail(r));
    document.title = r.name + ' · Token Launch Radar';
  }
  function fillTable(box, count, pane) {
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
      var tr;
      var open = function () {
        S.sel = r.slug;
        [].forEach.call(box.querySelectorAll('tr.sel'), function (x) { x.className = ''; });
        tr.className = 'sel';
        showDetail(pane);
        try { history.replaceState(null, '', '#/p/' + r.slug); } catch (e) { /* file:// may refuse */ }
      };
      var pos = function (v) { return ((Math.log(v) - lnLo) / lnSpan * 100).toFixed(1) + '%'; };
      tr = el('tr', { tabindex: '0', class: r.slug === S.sel ? 'sel' : '', onclick: open, onkeydown: function (e) { if (e.key === 'Enter') open(); } },
        el('td', { class: 'n dim', text: '#' + r.rank }),
        el('td', { class: 'name' }, r.name, el('span', { class: 'badge ' + (r.watchlist ? 'wl' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' })),
        el('td', { class: 'cat dim', text: r.category || 'Uncategorized' }),
        el('td', { class: 'n dim', text: String(r.chains.length), title: r.chains.join(', ') }),
        el('td', { class: 'n', text: fmtUsd(r.tvl_usd) }),
        pctCell(r.change_7d),
        el('td', { class: 'n dim', text: fmtAge(r.age_days) }),
        el('td', { class: 'n val', title: 'Range ' + range(r) + " (peers' P25–P75)" }, el('span', { text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'wh', 'aria-hidden': 'true' }, el('i', { style: 'left:' + pos(r.value_low) + ';width:' + ((Math.log(r.value_high) - Math.log(r.value_low)) / lnSpan * 100).toFixed(1) + '%' }), el('b', { style: 'left:' + pos(r.implied_value_usd) }))),
        el('td', { class: 'n', text: fmtOdds(r.launch_odds), title: 'Fitted propensity; category basis ' + r.launch_basis.tokenized + ' tokenized vs ' + r.launch_basis.pre_token + ' pre-token' }),
        el('td', { class: 'n val', text: fmtUsd(r.risk_adjusted_usd) }),
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
  function waterfall(r) {
    var w = r.waterfall, lo = Math.log(Math.min.apply(null, w.map(function (x) { return x[2]; }))), hi = Math.log(Math.max.apply(null, w.map(function (x) { return x[2]; }))) - lo || 1;
    var data = w.map(function (x, i) {
      var end = i === 0 || i === w.length - 1;
      return [x[0], x[1] === null ? '' : '×' + x[1].toFixed(2), full(x[2]), el('span', { class: 'wfw' }, el('span', { class: 'wf' + (end ? ' end' : ''), style: 'width:' + Math.max(2, (Math.log(x[2]) - lo) / hi * 100).toFixed(1) + '%' }))];
    });
    data.push(['Range (peers’ P25–P75)', '', full(r.value_low) + ' – ' + full(r.value_high), '']);
    return card('Valuation waterfall', tbl(['Step', 'Factor', 'Value', ''], data, 1), p('Each factor is the fitted, clamped adjustment; their product is clamped to 0.5–2' + (r.clamp_adj !== 1 ? ' (here it binds: ×' + r.clamp_adj.toFixed(2) + ')' : '') + '. The last row scales the implied value by the peers’ out-of-fold P25 and P75 misses.'));
  }
  function nearest(r) {
    var n = r.nearest;
    return card('Nearest tokenized peers',
      n.length ? tbl(['Peer', 'TVL', 'Market cap', 'mcap/TVL'], n.map(function (x) { return [x.name, fmtUsd(x.tvl_usd), fmtUsd(x.mcap_usd), fmtX(x.multiple)]; }), 1) : p('No tokenized peer in this category.'),
      p('Up to 3 peers of the same category, closest in TVL (smallest |ln of the TVL ratio|). This row: ' + fmtUsd(r.tvl_usd) + ' TVL, ' + fmtX(r.model.peer_multiple) + ' used.'));
  }
  function detail(r) {
    var m = r.model, pl = r.plan, F = D.farm;
    var steps = r.farm_steps.map(function (s) {
      var ci = s.lastIndexOf(' Cost: '), ti = s.lastIndexOf(' Time: ');
      var act = ci > 0 ? s.slice(0, ci) : s;
      var cost = ci > 0 && ti > ci ? s.slice(ci + 7, ti).replace(/\.$/, '') : '';
      var time = ti > 0 ? s.slice(ti + 7).replace(/\.$/, '') : '';
      return el('li', {}, el('div', {}, el('p', { text: act }),
        el('div', { class: 'meta' }, el('span', { class: 'c', text: 'Cost: ' + cost }), el('span', { class: 't', text: 'Time: ' + time }))));
    });
    var product = m.peer_multiple * m.base_adj * m.size_adj * m.growth_adj * m.maturity_adj * m.chain_adj * r.clamp_adj;
    var vcls = r.farm_verdict.indexOf('Worth') === 0 ? 'up' : r.farm_verdict.indexOf('Marginal') === 0 ? 'amber' : 'down';
    var lb = r.launch_basis;
    return el('div', { class: 'mt' },
      el('div', { class: 'dhead' },
        el('div', {}, el('h2', { text: r.name }),
          el('p', { class: 'sub' }, (r.category || 'Uncategorized') + ' · ' + (r.chains.join(', ') || 'no chain listed') + ' · rank #' + r.rank + ' of ' + rows.length,
            el('span', { class: 'badge ' + (r.watchlist ? 'wl' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' }))),
        el('div', {}, el('p', { class: 'sub', text: 'Implied value · ' + fmtOdds(r.launch_odds) + ' propensity → ' + fmtUsd(r.risk_adjusted_usd) }), el('div', { class: 'big', text: fmtUsd(r.implied_value_usd) }),
          el('p', { class: 'sub', text: 'Range ' + range(r) + ' (peers’ P25–P75)' }))),
      el('div', { class: 'grid w2' },
        card('Snapshot figures',
          el('dl', { class: 'facts' },
            fact('Slug', r.slug), fact('TVL', full(r.tvl_usd)), fact('TVL change 7d', fmtPct(r.change_7d)),
            fact('Listed', r.listed_at || 'n/a'), fact('Age', r.age_days === null ? 'n/a (365d assumed)' : r.age_days + ' days'),
            fact('Chains', String(r.chains.length)), fact('Token', 'none recorded'),
            fact('Implied value', full(r.implied_value_usd)), fact('Range (P25–P75)', full(r.value_low) + ' – ' + full(r.value_high)),
            fact('Launch propensity', fmtOdds(r.launch_odds)), fact('Basis: category share', Math.round(r.cat_share * 100) + '% (' + lb.tokenized + ' tokenized vs ' + lb.pre_token + ' pre-token)'),
            fact('Risk-adjusted', full(r.risk_adjusted_usd)), fact('Model confidence', Math.round(m.confidence * 100) + '%'))),
        card('Model breakdown',
          el('div', { class: 'bars' },
            el('div', { class: 'bar' }, el('span', { text: 'Peer multiple' }), el('span', { class: 'num', text: 'mcap/TVL' }), el('span', { class: 'v', text: fmtX(m.peer_multiple) })),
            bar('Base (fit)', m.base_adj, 0.5, 2, 'Fitted offset'),
            bar('Size adj.', m.size_adj, 0.5, 2, 'Fitted on ln TVL'), bar('Growth adj.', m.growth_adj, 0.5, 2, '7d TVL change'),
            bar('Maturity adj.', m.maturity_adj, 0.5, 2, 'Age since listing'), bar('Chain adj.', m.chain_adj, 0.5, 2, 'Chain breadth')),
          el('p', { class: 'eq' }, 'Peers: ', el('b', { text: m.peer_count }), ' in category (confidence n/(n+8) = ' + Math.round(m.confidence * 100) + '%; under 3 peers the family multiple is blended in).',
            el('br'), full(r.tvl_usd) + ' × ' + product.toFixed(4) + ' = ', el('b', { text: full(r.implied_value_usd) }))),
        ),
      el('div', { class: 'grid w2 mt' }, waterfall(r), nearest(r)),
      el('section', { class: 'card mt' }, el('h3', { text: 'Farm plan and verdict' }),
        el('p', { class: 'verdict ' + vcls, text: r.farm_verdict }),
        p('Totals: $' + r.farm_cost_usd.toFixed(2) + ' in fees, ' + r.farm_hours.toFixed(1) + ' hands-on hours. Chains ' + pl.chains.map(function (c) { return c.name + ' (tier ' + c.tier + ', $' + c.cost_usd + ')'; }).join(', ') + ' = $' + pl.chain_cost_usd + ' round trip. Deposit $' + pl.deposit_usd.toLocaleString('en-US') + '; about ' + pl.participants.toLocaleString('en-US') + ' wallets share a ' + (F.airdrop_pool_share * 100) + '% pool, so expected $' + pl.ev_wallet_usd.toFixed(2) + ' a wallet = implied × propensity × ' + (F.airdrop_pool_share * 100) + '% / wallets. Time at $' + F.hour_value_usd + '/h; worth it ≥ ' + F.worth_ratio + 'x, marginal ≥ ' + F.marginal_ratio + 'x.'),
        el('ol', { class: 'plan mt' }, steps)));
  }

  // ---- model view
  function valCard(title, e, note) {
    return card(title, tbl(['Model', 'Median abs log error', 'Typical miss'], [['Fitted (Huber)', e.fitted.toFixed(3), '~' + Math.exp(e.fitted).toFixed(1) + 'x'], ['Category multiple only', e.baseline.toFixed(3), '~' + Math.exp(e.baseline).toFixed(1) + 'x']], 1),
      p('Fitted error is ' + gainWord(e.fitted, e.baseline) + '. ' + note));
  }
  function scatter() {
    var pts = D.fit.scatter, vals = [].concat.apply([], pts), lo = Math.floor(Math.min.apply(null, vals)), hi = Math.ceil(Math.max.apply(null, vals));
    var W = 380, L = 56, B = 40, T = 12, R = 28;
    var X = function (v) { return (L + (v - lo) / (hi - lo) * (W - L - R)).toFixed(1); };
    var Y = function (v) { return (W - B - (v - lo) / (hi - lo) * (W - B - T)).toFixed(1); };
    var s = '<svg viewBox="0 0 ' + W + ' ' + W + '" role="img" aria-label="Out-of-fold predicted against actual market cap, log scale" class="scat">';
    for (var k = lo; k <= hi; k++) s += '<line x1="' + X(k) + '" y1="' + T + '" x2="' + X(k) + '" y2="' + (W - B) + '" stroke="#22304d"/><line x1="' + L + '" y1="' + Y(k) + '" x2="' + (W - R) + '" y2="' + Y(k) + '" stroke="#22304d"/><text x="' + X(k) + '" y="' + (W - B + 16) + '" text-anchor="middle" fill="#8a99b5" font-size="13">1e' + k + '</text><text x="' + (L - 6) + '" y="' + (+Y(k) + 4) + '" text-anchor="end" fill="#8a99b5" font-size="13">1e' + k + '</text>';
    s += '<line x1="' + X(lo) + '" y1="' + Y(lo) + '" x2="' + X(hi) + '" y2="' + Y(hi) + '" stroke="#e6ecf5" stroke-dasharray="5 4"/>';
    pts.forEach(function (q) { s += '<circle cx="' + X(q[0]) + '" cy="' + Y(q[1]) + '" r="3" fill="#f5b83d"/>'; });
    s += '<text x="' + ((L + W - R) / 2) + '" y="' + (W - 6) + '" text-anchor="middle" fill="#e6ecf5" font-size="13">predicted market cap ($)</text><text x="14" y="' + ((T + W - B) / 2) + '" text-anchor="middle" fill="#e6ecf5" font-size="13" transform="rotate(-90 14 ' + ((T + W - B) / 2) + ')">actual</text></svg>';
    var d = el('div', { class: 'scatbox' });
    d.innerHTML = s;
    return card('Calibration: out-of-fold predicted vs actual', d, p(pts.length + ' peers, each predicted by a model that never saw it (5-fold). The dashed line is a perfect call; the spread around it is the miss the ranges express.'));
  }
  function modelView() {
    var f = D.fit, o = D.odds, F = D.farm, b = f.band, w = f.walk, dl = F.dilution, dp = F.deposit;
    var pct = function (x) { return (x * 100).toFixed(1) + '%'; };
    var tiers = F.tiers.map(function (t) { return ['Tier ' + t.tier, t.label, '$' + t.cost_usd]; });
    return el('div', {},
      p('Two out-of-sample checks of the same model, side by side. Where the fitted gain is small the table says so.', 'note'),
      el('div', { class: 'grid mb' },
        valCard('Validation 1: 5-fold cross-validation', f.cv, f.cv.n + ' peers predicted out of fold: each fold is refit (category multiples and Huber fit) on the other four; fold = sum of the slug’s char codes mod ' + f.cv.folds + '.'),
        valCard('Validation 2: walk-forward', w, 'Fit on the earliest ' + w.n_fit + ' peers by listed date, tested on the latest ' + w.n + ' (listed ' + w.from + ' to ' + w.to + '; the ' + w.undated + ' undated peers count as oldest). A smaller, harder test.')),
      el('div', { class: 'grid mb' },
        card('Ranges and their coverage',
          p('Value ranges are the peers’ own P25–P75 miss: the out-of-fold residual ln(actual / predicted) has quartiles ' + b.q25.toFixed(2) + ' and +' + b.q75.toFixed(2) + ', so a row’s range is its implied value × ' + Math.exp(b.q25).toFixed(2) + ' to × ' + Math.exp(b.q75).toFixed(2) + '.', 'prose'),
          p('On the walk-forward test, ' + b.inside + ' of ' + b.n + ' peers (' + pct(b.coverage) + ') had an actual market cap inside their band; a P25–P75 band aims at 50%. The quartiles come from out-of-fold residuals that include these peers, so the figure is slightly flattering. The bands are wide: the model gives scale, not a price.', 'prose')),
        scatter()),
      el('div', { class: 'grid mb' }, fitPanel(),
        card('Launch propensity: fitted on the peers’ record',
          tbl(['Feature', 'Weight'], o.features.map(function (n, i) { return [n, o.coefficients[i].toFixed(3)]; }), 1),
          p('Logistic regression of “records a token” over ' + o.n_scope + ' protocols in scope (the snapshot less the product types the board excludes): the category’s tokenized share (shrunk toward the global ' + fmtOdds(o.global_rate) + ' by ' + o.smoothing + ' pseudo-protocols, leave-one-out), ln TVL (z-scored), ln chains and ln age. L2 λ = ' + o.lambda + ', Newton, ' + o.iterations + ' iterations from zero; odds are clamped to 2–95%.'),
          p('Slug-parity split (' + o.n_train + ' fit, ' + o.n_test + ' held): Brier ' + o.brier_propensity.toFixed(4) + ' vs ' + o.brier_base.toFixed(4) + ' for the base rate alone (' + gainWord(o.brier_propensity, o.brier_base) + '; lower is better). It describes which protocols in this snapshot record a token; it is not a forecast of any issuance.'))),
      el('div', { class: 'grid' },
        card('Farm-plan assumptions', tbl(['Tier', 'Chains', 'Round trip'], tiers, 2),
          p('A plan names the protocol’s first ' + F.max_chains + ' chains and sums their tier costs (bridge in and out plus gas). Tiers are a cost assumption, not a measurement: A Ethereum, B other layer-1s, C layer-2s and rollups, U any chain not in the table.')),
        card('How a farm plan is costed',
          el('div', { class: 'prose' },
            el('p', {}, el('b', { text: 'Wallets sharing the pool. ' }), el('code', { text: 'clamp(round(' + dl.base + ' × (TVL / $' + dl.ref_tvl_usd / 1e6 + 'M)^' + dl.exponent + '), ' + dl.min + ', ' + dl.max.toLocaleString('en-US') + ')' })),
            el('p', {}, el('b', { text: 'Deposit. ' }), el('code', { text: 'clamp(round(TVL × ' + dp.rate + ' / ' + dp.step + ') × ' + dp.step + ', $' + dp.min + ', $' + dp.max.toLocaleString('en-US') + ')' }), ' (returned on exit, not a cost).'),
            el('p', {}, el('b', { text: 'Expected value a wallet. ' }), 'implied × propensity × ' + (F.airdrop_pool_share * 100) + '% pool / wallets. One qualifying action costs ' + (F.action_fee_share * 100) + '% of the first chain’s round trip.'),
            el('p', {}, el('b', { text: 'Verdict. ' }), 'Expected value over all-in cost (fees + hands-on hours at $' + F.hour_value_usd + '/h): Worth it ≥ ' + F.worth_ratio + 'x, Marginal ≥ ' + F.marginal_ratio + 'x, else Skip.'),
            el('p', {}, el('b', { text: 'Tactics. ' }), '7d TVL above +5%: crowding caution and a hold capped at 21 days; below −5%: accumulate quietly. Listed under a year: early-user footprint; over 4 years: a sustained eight-week cadence.')))));
  }

  // ---- comparables
  function comparablesView() {
    var peers = D.peers.map(function (q) {
      return el('tr', {}, el('td', { text: q.category }), el('td', { class: 'n', text: String(q.n) }), el('td', { class: 'n val', text: fmtX(q.median_multiple) }),
        el('td', { class: 'n dim', text: fmtX(q.multiple) }));
    });
    var M = D.model;
    return el('div', {},
      p('Comparables are the ' + D.peer_total + ' protocols in this snapshot that already have a market cap and TVL. Their mcap/TVL ratios, not a hand-set constant, calibrate every pre-token row.', 'note'),
      el('div', { class: 'grid mb' }, fitPanel(), coveragePanel()),
      el('div', { class: 'grid' },
        el('section', { class: 'tablebox' }, el('table', {},
          el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { class: 'n', text: 'Peers n' }), el('th', { class: 'n', text: 'Median mcap/TVL' }), el('th', { class: 'n', text: 'Used (shrunk, capped)' }))),
          el('tbody', {}, peers))),
        el('section', { class: 'card' }, el('h3', { text: 'The model in words' }),
          el('div', { class: 'prose' },
            el('p', {}, el('b', { text: 'Peer multiple. ' }), 'Median mcap/TVL of the category, blended with the global median (' + fmtX(D.global_median_multiple) + '): (n×category + ' + M.prior_weight + '×global) / (n + ' + M.prior_weight + '), capped at the peer p90 (' + fmtX(D.peer_cap_multiple) + '). A category with no peers uses the global median.'),
            el('p', {}, el('b', { text: 'Thin categories. ' }), 'Under 3 peers, the shrunk multiple is blended with the family median (all peers of the same kind), weight (3−n)/3.'),
            el('p', {}, el('b', { text: 'Adjustments, fitted robustly. ' }), 'Size, growth, maturity and chain factors are exp(coef × (feature − peer mean)) from the Huber fit above, each clamped to 0.5–2, and their product is clamped to 0.5–2 as well; the base factor is exp(intercept). Growth is 7d TVL change clamped to ±50 (missing: category median of pre-token protocols); unknown age counts as ' + M.unknown_age_days + ' days. If the fit were degenerate, the radar-2 constants apply.'),
            el('p', {}, el('b', { text: 'Launch odds. ' }), 'A fitted propensity (see the Model tab), clamped to 2–95%, scored against the base rate. The category’s tokenized share, ' + fmtOdds(D.odds.global_rate) + ' globally, is its basis. The board ranks by implied value; adjusted value = implied × odds.'),
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
      p('These ' + D.live_size + ' protocols already trade a token. Their market cap is the market’s own value, not the model’s, so they are set aside and never ranked on the board. Their ratios are the comparables the board is calibrated on.', 'note'),
      el('div', { class: 'tablebox' }, el('table', {},
        el('thead', {}, el('tr', {}, ['#', 'Protocol', 'Category', 'TVL', '7d %', 'Market cap', 'mcap/TVL'].map(function (h, i) { return el('th', { class: i > 2 ? 'n' : '', text: h }); }))),
        el('tbody', {}, trs))));
  }

  // ---- routing and render
  function go(v) { location.hash = '#/' + v; }
  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    if (h.indexOf('p/') === 0) {
      if (rows.some(function (x) { return x.slug === h.slice(2); })) S.sel = h.slice(2);
      view = 'board';
      return;
    }
    view = h === 'comparables' || h === 'live' || h === 'model' ? h : 'board';
  }
  function draw() {
    route();
    boardUpdate = null;
    var inner = view === 'model' ? modelView() : view === 'comparables' ? comparablesView() : view === 'live' ? liveView() : boardView();
    var keep = view === 'board' && document.activeElement && document.activeElement.type === 'search';
    root.textContent = '';
    root.appendChild(el('div', { class: 'wrap' }, header(), modelLine(), tabs(), el('main', {}, inner)));
    if (keep) { var s = root.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
    if (view !== 'board') document.title = 'Token Launch Radar';
  }
  window.addEventListener('hashchange', function () { window.scrollTo(0, 0); draw(); });
  draw();
})();
