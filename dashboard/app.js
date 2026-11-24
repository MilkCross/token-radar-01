// Token Launch Radar. Reads window.RADAR (data.js, written by main.ts from the snapshot). No network.
(function () {
  'use strict';
  var D = window.RADAR;
  var root = document.getElementById('app');
  if (!D) { root.textContent = 'No data: data.js did not load.'; return; }
  var rows = D.rows;
  var S = { q: '', cat: '', chain: '', wl: false, early: false, pos: false, verdict: '', tvl: 0, key: 'rank', dir: 1, sel: rows[0].slug };
  var SC = { cap: '', wk: '' };
  var view = 'board';
  var base = rows.filter(function (r) { return !r.promoted; });
  var lnLo = Math.log(Math.min.apply(null, base.map(function (r) { return r.value_low; })));
  var lnSpan = Math.log(Math.max.apply(null, base.map(function (r) { return r.value_high; }))) - lnLo;

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
  function E3(x) { return x.toFixed(3); }
  function pc1(x) { return (x * 100).toFixed(1) + '%'; }
  function dlt(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(3); }
  function vlabel(r) { return r.farm_verdict.split(':')[0]; }
  function fmtOdds(o) { return Math.round(o * 100) + '%'; }
  function full(n) { return '$' + n.toLocaleString('en-US'); }
  function range(r) { return fmtUsd(r.value_low) + ' – ' + fmtUsd(r.value_high); }
  function rband(r) { return r.range_level === 80 ? 'P10–P90' : 'P25–P75'; }
  function rrange(r) { return '[' + r.rank_low + '–' + r.rank_high + ']'; }
  function gainWord(a, b) { var g = Math.round((1 - a / b) * 100); return g + '% lower, a ' + (g < 10 ? 'small' : g < 25 ? 'modest' : 'clear') + ' gain'; }
  // Scenario: rewards scale with capital x weeks held against the plan's own; fees and hours stay fixed. Blank inputs are the baseline.
  function scen(r) {
    var pl = r.plan, F = D.farm, hr = r.farm_hours || 1;
    if (!SC.cap && !SC.wk) return pl.net_p25_usd / hr;
    var c = +SC.cap > 0 ? +SC.cap : pl.deposit_usd, h = +SC.wk > 0 ? +SC.wk : pl.hold_weeks;
    return (pl.ev_p25_wallet_usd * (c / pl.deposit_usd) * (h / pl.hold_weeks) - r.farm_cost_usd - r.farm_hours * F.hour_value_usd - c * F.capital_apr * h / 52) / hr;
  }

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
  function sgn(n) { return (n < 0 ? '−$' : '$') + Math.abs(n).toFixed(2); }
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
    return el('p', { class: 'model-line' }, el('b', { text: D.model_version + ': ' }),
      'implied value blends a global power law of market cap on TVL (' + D.peer_total + ' token-bearing peers) with the category’s mcap/TVL multiple (shrunk toward the global median of ' + fmtX(D.global_median_multiple) + ', capped at the peer p90 of ' + fmtX(D.peer_cap_multiple) + '); a category keeps the share w = n/(n+' + D.fit.k + ') of its deviation from the curve, so thin categories stay near it. Size, growth, maturity and chain terms are fitted by Huber regression. Ranges are the model’s own out-of-fold P25–P75 miss (P10–P90 for low-confidence rows). Values are implied circulating market cap, not FDV; a cross-sectional peer benchmark, not a price forecast.');
  }
  function tabs() {
    var defs = [['board', 'Board'], ['model', 'Model'], ['comparables', 'Comparables'], ['live', 'Live tokens']];
    return el('nav', { class: 'tabs', role: 'tablist' }, defs.map(function (d) {
      return el('button', { role: 'tab', 'aria-selected': String(view === d[0]), text: d[1], onclick: function () { go(d[0]); } });
    }));
  }

  // ---- cover: ladder, accounting, calibration, self-critique, one-line integrity strip
  function coverageLine() {
    var c = D.coverage, w = Object.keys(c.excluded_reasons).map(function (k) { return c.excluded_reasons[k] + ' ' + k; }).join(', ');
    return c.total + ' = ' + c.ranked + ' ranked (' + c.promoted + ' promoted, low conf.) + ' + c.tokenized + ' tokenized + ' + c.excluded + ' excluded as product type (' + w + ') + ' + c.quarantined + ' quarantined';
  }
  function fitPanel() {
    var f = D.fit;
    return card('Adjustment fit (' + f.fit_method + ')',
      tbl(['Term', 'Coef (all peers)', 'Mean'], f.features.map(function (n, i) {
        return [n, f.fallback ? 'n/a' : f.coefficients[i].toFixed(4), f.fallback || i === 0 ? '' : f.means[i - 1].toFixed(3)];
      }), 1),
      p('Huber target ln(mcap / (TVL × min(multiple, p90))) over ' + f.peers_fit_all + ' peers; the size term is free, the sum of the others is clamped to ×0.5–2. Curve: ln mcap = ' + f.curve[0].toFixed(2) + ' + ' + f.curve[1].toFixed(3) + ' × ln(TVL / $100M). A category under 5 peers may not stray from the curve by more than ln ' + f.residual_cap.toFixed(2) + ' (the peers’ P90 residual).'));
  }
  function coveragePanel() {
    var c = D.coverage, ex = c.excluded_reasons;
    var rowsC = [['Already tokenized', c.tokenized], ['On the board', c.ranked], ['  of which promoted, low conf.', c.promoted], ['Excluded as product type', c.excluded]].concat(Object.keys(ex).map(function (k) { return ['  of which ' + k, ex[k]]; })).concat([['Quarantined, not priced', c.quarantined], ['Total', c.total]]);
    var q = D.quarantined;
    return card('Accounting: every protocol, once',
      el('dl', { class: 'facts' }, [].concat.apply([], rowsC.map(function (x) { return fact(x[0], x[1]); }))),
      el('h4', { text: 'Set aside, not priced' }),
      q.length ? tbl(['Protocol', 'Category', 'TVL', 'Reason'], q.map(function (x) { return [x.name, x.category || 'Uncategorized', fmtUsd(x.tvl_usd), x.reason]; }), 2) : p('None: the ' + D.promoted_size + ' protocols a first pass set aside all have a TVL at the floor and a chain, so each was priced and promoted, tagged low confidence.'),
      p('Buckets are exclusive, in priority order. Floor $' + c.floor_usd.toLocaleString('en-US') + ' TVL, snapshot ' + c.as_of + '.'));
  }
  function ladderCard(note) {
    var L = D.fit.ladder;
    var c = card('Ablation ladder: median abs log error, out of sample',
      tbl(['Variant', 'Leave-one-out', 'Walk-forward', 'Level'], L.rows.map(function (r) { return [r.label, E3(r.errors[0]), E3(r.errors[1]), r.level[0].toFixed(2) + ' / ' + r.level[1].toFixed(2)]; }), 1),
      tbl(['Shipped model, k = ' + D.fit.k, 'Δ LOO', 'Δ walk', 'Disposition'], L.terms.map(function (t) { return [t[0], dlt(t[3]), dlt(t[4]), t[5]]; }), 1),
      p('Level is Σ predicted / Σ actual market cap on held-out peers. n = ' + L.n.join(' / ') + ', every refit inside its training part, k tuned by an inner leave-one-out. Δ is the change in error when the term is removed (+ means it helps); the noise column is a control that must not help.' + (note ? ' ' + L.note : '')));
    c.className += ' lad';
    return c;
  }
  function cover() {
    var f = D.fit, c = D.coverage, rc = D.recon, I = D.integrity, ok = I.filter(function (x) { return x.pass === true; }).length, n = I.filter(function (x) { return x.pass !== null; }).length;
    var seg = [['rk', 'ranked', c.ranked], ['tk', 'tokenized', c.tokenized], ['ex', 'excluded', c.excluded], ['qu', 'quarantined', c.quarantined]].filter(function (x) { return x[2]; });
    var thin = rows.filter(function (r) { return r.thin; }).length;
    var acc = el('div', { class: 'acc', role: 'img', 'aria-label': 'Protocol accounting bar' }, seg.map(function (x) { return el('i', { class: x[0], style: 'flex:' + x[2], title: x[1] + ' ' + x[2] }, x[1] + ' ' + x[2]); }));
    return el('div', { class: 'strip' },
      el('p', { class: 'one' }, el('b', { class: ok === n ? 'up' : 'down', text: (ok === n ? '✓ ' : '✗ ') + ok + ' of ' + n + ' integrity checks pass' }), ' · ' + c.total + ' of ' + c.total + ' protocols accounted · ' + rc.rows + ' rows · Σ implied ' + full(rc.sum_implied_usd) + ' · build ' + rc.build),
      el('div', { class: 'grid mb' }, ladderCard(false),
        el('section', { class: 'card' }, el('h3', { text: 'Accounting: ' + c.total + ' of ' + c.total }), acc, p(coverageLine()),
          el('h4', { text: 'Calibration, measured' }),
          p('Walk-forward, bands built from the training part alone: the 50% band held ' + pc1(f.band.coverage) + ' (' + f.band.inside + '/' + f.band.n + ') of test peers, the 80% band ' + pc1(f.band80.coverage) + ' (' + f.band80.inside + '/' + f.band80.n + ').', 'prose'),
          el('h4', { text: 'Self-critique' }),
          p('Ranking is the signal; the level carries wide uncertainty. Held out, the median miss is ' + Math.exp(f.loo.fitted).toFixed(1) + '× (leave-one-out) and ' + Math.exp(f.walk.fitted).toFixed(1) + '× (walk-forward).', 'prose'),
          p('Across held-out peers the model predicts only ~' + Math.round(f.level.loo * 100) + '% of the aggregate market cap; ' + thin + ' of ' + rows.length + ' rows sit in THIN categories (under 3 peers) and can never be Worth it.', 'prose'))),
      el('details', {}, el('summary', { text: 'Integrity checks in full' }),
        el('div', { class: 'prose mb' }, I.map(function (x) { return el('p', {}, el('b', { text: (x.pass === false ? 'FAILED · ' : '') + x.label + ': ' }), x.value); }))));
  }

  // ---- board
  var COLS = [
    ['rank', 'Rank', true], ['name', 'Protocol', false], ['category', 'Category', false],
    ['tvl_usd', 'TVL', true], ['change_7d', '7d %', true], ['age_days', 'Age', true], ['implied_value_usd', 'Implied value', true], ['launch_odds', 'Odds', true], ['risk_adjusted_usd', 'Launch EV', true], ['verdict', 'Verdict', false], ['net_hr', 'Net $/h', true]
  ];
  function sortVal(r, k) {
    if (k === 'verdict') return 2 - ['Worth it', 'Marginal', 'Skip'].indexOf(vlabel(r));
    if (k === 'net_hr') return scen(r);
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
      if (S.early && (r.watchlist || r.promoted)) return false;
      if (S.pos && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (S.tvl && r.tvl_usd < S.tvl) return false;
      if (S.verdict && vlabel(r) !== S.verdict) return false;
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
      select('Verdict', [['', 'All verdicts'], ['Worth it', 'Worth it'], ['Marginal', 'Marginal'], ['Skip', 'Skip']], S.verdict, function (v) { S.verdict = v; draw(); }),
      check('Watchlist only', 'wl'), check('Early only', 'early'), check('Positive 7d only', 'pos'),
      el('label', { title: 'Scenario capital per wallet, dollars; blank is each plan’s own' }, 'Capital $', el('input', { type: 'number', min: '0', placeholder: 'plan', value: SC.cap, 'aria-label': 'Scenario capital', oninput: function (e) { SC.cap = e.target.value; update(); } })),
      el('label', { title: 'Scenario weeks held; blank is each plan’s own' }, 'Weeks', el('input', { type: 'number', min: '0', placeholder: 'plan', value: SC.wk, 'aria-label': 'Scenario weeks', oninput: function (e) { SC.wk = e.target.value; update(); } })),
      el('span', { class: 'count', id: 'count' }));
    var box = el('div', { class: 'tablebox scroll', id: 'tbox' });
    var pane = el('aside', { id: 'detail', 'aria-live': 'polite', 'aria-label': 'Selected protocol' });
    showDetail(pane);
    boardUpdate = function () { fillTable(box, controls.querySelector('#count'), pane); };
    boardUpdate();
    return el('div', {}, cover(), controls, p('Scenario (blank = each plan’s own capital and hold): rewards scale with capital × weeks held against the plan’s own, the pool share staying ' + D.farm.airdrop_pool_share * 100 + '% / the protocol’s wallets; fees and hours stay fixed. Net $/h is P25 EV less all-in cost per hands-on hour. Verdicts and ranks stay at baseline.', 'cov'), el('div', { class: 'split' }, el('div', { class: 'left' }, box), pane));
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
        pane.scrollTop = 0;
        try { history.replaceState(null, '', '#/p/' + r.slug); } catch (e) { /* file:// may refuse */ }
      };
      var pc = function (v) { return Math.min(100, Math.max(0, (Math.log(v) - lnLo) / lnSpan * 100)); };
      var pos = function (v) { return pc(v).toFixed(1) + '%'; };
      tr = el('tr', { tabindex: '0', class: r.slug === S.sel ? 'sel' : '', onclick: open, onkeydown: function (e) { if (e.key === 'Enter') open(); } },
        el('td', { class: 'n dim', title: 'Rank ' + r.rank + '; its ' + rband(r) + ' range would rank ' + r.rank_low + ' to ' + r.rank_high }, '#' + r.rank, el('small', { text: rrange(r) })),
        el('td', { class: 'name' }, r.name, el('span', { class: 'badge ' + (r.promoted ? 'low' : r.watchlist ? 'wl' : 'early'), text: r.promoted ? 'low conf.' : r.watchlist ? 'WL' : 'New', title: r.promoted ? 'Promoted from the set-aside list; 80% band' : r.watchlist ? 'Watchlist' : 'Early row' }), r.thin ? el('span', { class: 'badge thin', text: 'THIN', title: 'Category has ' + r.model.peer_count + ' peer(s), under 3: never Worth it' }) : null),
        el('td', { class: 'cat dim', text: r.category || 'Uncategorized' }),
        el('td', { class: 'n', text: fmtUsd(r.tvl_usd) }),
        pctCell(r.change_7d),
        el('td', { class: 'n dim', text: fmtAge(r.age_days) }),
        el('td', { class: 'n val', title: 'Range ' + range(r) + " (peers' " + rband(r) + ')' }, el('span', { text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'wh', 'aria-hidden': 'true' }, el('i', { style: 'left:' + pos(r.value_low) + ';width:' + (pc(r.value_high) - pc(r.value_low)).toFixed(1) + '%' }), el('b', { style: 'left:' + pos(r.implied_value_usd) }))),
        el('td', { class: 'n', title: 'Fitted propensity; category basis ' + r.launch_basis.tokenized + ' tokenized vs ' + r.launch_basis.pre_token + ' pre-token' }, fmtOdds(r.launch_odds), el('span', { class: 'ob', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.round(r.launch_odds * 100) + '%' }))),
        el('td', { class: 'n val', text: fmtUsd(r.risk_adjusted_usd), title: 'Launch EV = value × odds' }),
        el('td', { class: vlabel(r) === 'Worth it' ? 'up' : vlabel(r) === 'Marginal' ? 'amber' : 'down', text: vlabel(r), title: r.verdict_capped ? 'Rule says Worth it; capped at Marginal (THIN)' : '' }),
        el('td', { class: 'n ' + (scen(r) >= 0 ? 'up' : 'down'), text: (scen(r) < 0 ? '−$' : '$') + Math.abs(scen(r)).toFixed(0), title: 'P25 EV less all-in cost, per hands-on hour (' + r.farm_hours.toFixed(1) + 'h)' }));
      return tr;
    });
    box.appendChild(el('table', {}, el('thead', {}, head), el('tbody', {}, body)));
  }

  // ---- detail
  function factors(r) {
    var m = r.model, st = {};
    D.fit.factors.forEach(function (x) { st[x[0]] = x; });
    var data = r.waterfall.map(function (x) {
      var f = st[x[0]];
      return [x[0], x[1] === null ? '' : '×' + x[1].toFixed(2), full(x[2]), f ? dlt(f[1]) + ' / ' + dlt(f[2]) : ''];
    });
    data.push(['Range (peers’ ' + rband(r) + ')', '', full(r.value_low) + ' – ' + full(r.value_high), '']);
    return card('Factor decomposition',
      tbl(['Step', 'Factor', 'Value', 'Held-out Δ'], data, 1),
      p('Blend weight w = n/(n+' + D.fit.k + ') = ' + Math.round(m.confidence * 100) + '% (n = ' + m.peer_count + ' peers). Each factor is exp(w × that step’s log term), so the steps multiply to the implied value' + (r.thin ? '; THIN: the category is under 3 peers, so the value stays near the curve and the verdict cannot be Worth it' : '') + '. Held-out Δ: change in median error, leave-one-out / walk-forward, when the term is removed (+ means it helps).'));
  }
  // Net at P25 EV, by the share of supply airdropped (pool) against the deposit; proceeds are an equal per-wallet split, so a deposit moves only the opportunity cost.
  function matrix(r) {
    var F = D.farm, pl = r.plan, fixed = r.farm_cost_usd + r.farm_hours * F.hour_value_usd, ds = [2500, 10000, 50000];
    return card('Drop share × deposit: net at P25 EV',
      tbl(['Pool share'].concat(ds.map(function (d) { return '$' + d.toLocaleString('en-US'); })), [0.025, F.airdrop_pool_share, 0.1].map(function (s) {
        return [(s * 100) + '%' + (s === F.airdrop_pool_share ? ' (model)' : '')].concat(ds.map(function (d) {
          var v = pl.ev_p25_wallet_usd * s / F.airdrop_pool_share - fixed - d * F.capital_apr * pl.hold_weeks / 52;
          return el('span', { class: v >= 0 ? 'up' : 'down', text: sgn(v) });
        }));
      }), 1),
      p('P25 EV a wallet × share / ' + (F.airdrop_pool_share * 100) + '%, less fees, hands-on time and the deposit’s opportunity cost for ' + pl.hold_weeks.toFixed(1) + ' weeks.'));
  }
  function nearest(r) {
    var n = r.nearest, N = r.model.peer_count, cross = n.some(function (x) { return x.cross; });
    return card('Nearest priced peers',
      n.length ? tbl(['Peer', 'TVL', 'Market cap', 'mcap/TVL'], n.map(function (x) {
        return [x.cross ? [document.createTextNode(x.name), el('span', { class: 'badge live', text: 'cross-category' })] : x.name, fmtUsd(x.tvl_usd), fmtUsd(x.mcap_usd), fmtX(x.multiple)];
      }), 1) : p('No priced peer in this category.'),
      p('Same-category peers closest in TVL' + (cross ? ', then the closest of any category (context only, not in the value: it used ' + N + ' same-category peer' + (N === 1 ? '' : 's') + ')' : '') + '. This row: ' + fmtUsd(r.tvl_usd) + ' TVL, multiple ' + fmtX(r.model.peer_multiple) + ' used.'));
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
    var vcls = r.farm_verdict.indexOf('Worth') === 0 ? 'up' : r.farm_verdict.indexOf('Marginal') === 0 ? 'amber' : 'down';
    var lb = r.launch_basis;
    return el('div', { class: 'mt' },
      el('div', { class: 'dhead' },
        el('div', {}, el('h2', { text: r.name }),
          el('p', { class: 'sub' }, (r.category || 'Uncategorized') + ' · ' + (r.chains.join(', ') || 'no chain listed') + ' · rank #' + r.rank + ' ' + rrange(r) + ' of ' + rows.length,
            el('span', { class: 'badge ' + (r.promoted ? 'low' : r.watchlist ? 'wl' : 'early'), text: r.promoted ? 'low conf.' : r.watchlist ? 'Watchlist' : 'Early' }), r.thin ? el('span', { class: 'badge thin', text: 'THIN' }) : null)),
        el('div', {}, el('p', { class: 'sub', text: 'Implied value · ' + fmtOdds(r.launch_odds) + ' propensity → ' + fmtUsd(r.risk_adjusted_usd) }), el('div', { class: 'big', text: fmtUsd(r.implied_value_usd) }),
          el('p', { class: 'sub', text: 'Range ' + range(r) + ' (peers’ ' + rband(r) + ')' }))),
      r.why ? p(r.why, 'verdict amber mt') : null,
      el('div', { class: 'grid w2' },
        card('Snapshot figures',
          el('dl', { class: 'facts' },
            fact('Slug', r.slug), el('dt', { class: 'wide', text: 'Basis: circulating mcap/TVL (not FDV)' }), fact('TVL', full(r.tvl_usd)), fact('TVL change 7d', fmtPct(r.change_7d)),
            fact('Listed', r.listed_at || 'n/a'), fact('Age', r.age_days === null ? 'n/a (365d assumed)' : r.age_days + ' days'),
            fact('Chains', String(r.chains.length)), fact('Token', 'none recorded'),
            fact('Implied value', full(r.implied_value_usd)), fact('Range (' + rband(r) + ')', full(r.value_low) + ' – ' + full(r.value_high)), fact('Rank range', rrange(r)),
            fact('Launch propensity', fmtOdds(r.launch_odds)), fact('Basis: category share', Math.round(r.cat_share * 100) + '% (' + lb.tokenized + ' tokenized vs ' + lb.pre_token + ' pre-token)'),
            fact('Risk-adjusted', full(r.risk_adjusted_usd)), fact('Blend weight w', Math.round(m.confidence * 100) + '%'))),
        factors(r)),
      el('div', { class: 'grid w2 mt' }, nearest(r), matrix(r)),
      el('section', { class: 'card mt' }, el('h3', { text: 'Farm plan and verdict' }),
        el('p', { class: 'verdict ' + vcls, text: r.farm_verdict }),
        el('dl', { class: 'facts mt' },
          fact('Point EV a wallet', '$' + pl.ev_wallet_usd.toFixed(2)), fact('P25 EV a wallet', '$' + pl.ev_p25_wallet_usd.toFixed(2)),
          fact('All-in cost', '$' + pl.all_in_usd.toFixed(2)),
          fact('  fees', '$' + r.farm_cost_usd.toFixed(2)), fact('  hands-on time', r.farm_hours.toFixed(1) + 'h × $' + F.hour_value_usd + ' = $' + (r.farm_hours * F.hour_value_usd).toFixed(2)),
          fact('  capital opportunity', '$' + pl.deposit_usd.toLocaleString('en-US') + ' × ' + (F.capital_apr * 100).toFixed(1) + '% × ' + pl.hold_weeks.toFixed(1) + '/52 wk = $' + pl.opportunity_usd.toFixed(2)),
          fact('EV / cost', pl.ev_ratio.toFixed(2) + 'x point, ' + pl.ev_p25_ratio.toFixed(2) + 'x P25'),
          fact('Net at point EV', sgn(pl.net_point_usd)), fact('Net at P25', sgn(pl.net_p25_usd) + ' (ROI ' + pl.net_p25_roi_pct.toFixed(0) + '% of cost)'),
          fact('Break-even launch value', full(pl.break_even_value_usd) + ' vs ' + full(r.implied_value_usd) + ' implied')),
        p('Chains ' + pl.chains.map(function (c) { return c.name + ' (tier ' + c.tier + ', $' + c.cost_usd + ')'; }).join(', ') + ' = $' + pl.chain_cost_usd + ' round trip. About ' + pl.participants.toLocaleString('en-US') + ' wallets share a ' + (F.airdrop_pool_share * 100) + '% pool: EV = implied × propensity × ' + (F.airdrop_pool_share * 100) + '% / wallets (Launch EV in the table is value × odds); P25 EV uses the P25 value; break-even = all-in × wallets / (' + (F.airdrop_pool_share * 100) + '% × odds). Worth it: point EV ≥ ' + F.worth_ratio + 'x all-in and P25 EV ≥ ' + F.worth_p25_floor + 'x all-in. Marginal: point EV ≥ ' + F.marginal_ratio + 'x all-in but not Worth it. Skip: point EV < ' + F.marginal_ratio + 'x.'),
        el('ol', { class: 'plan mt' }, steps)));
  }

  // ---- model view
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
    return card('Calibration: held-out predicted vs actual', d, p(pts.length + ' peers, each predicted by a model that never saw it (leave-one-out). The dashed line is a perfect call; the cloud sits below it on aggregate (level ' + D.fit.level.loo.toFixed(2) + '), the spread is the miss the ranges express.'));
  }
  function modelView() {
    var f = D.fit, o = D.odds, F = D.farm, b = f.band, b8 = f.band80, w = f.walk, x = o.experiment, dl = F.dilution, dp = F.deposit, ap = F.airdrop_pool_share * 100;
    var tiers = F.tiers.map(function (t) { return ['Tier ' + t.tier, t.label, '$' + t.cost_usd]; });
    return el('div', {},
      p('Audit view: the ladder, the accounting and the diagnostics behind the board. Values are implied circulating market cap (not FDV; the snapshot has no supply or unlock schedules), a cross-sectional peer benchmark, not a price forecast.', 'note'),
      el('div', { class: 'grid mb' }, ladderCard(true), coveragePanel()),
      el('div', { class: 'grid mb' },
        card('Blend constant k and the walk-forward',
          tbl(['k', 'Leave-one-out error'], f.k_grid.map(function (g) { return [g[0] + (g[0] === f.k ? ' (shipped)' : ''), E3(g[1])]; }), 1),
          p('k grid scored by an inner leave-one-out over all ' + f.peers_fit_all + ' peers; it picks ' + f.k_loo + ', the frozen choice. Inside every validation fold k is re-tuned on that fold’s training part alone.', 'prose'),
          p('Walk-forward: fit on the earliest ' + w.n_fit + ' peers by listed date, tested on the latest ' + w.n + ' (listed ' + w.from + ' to ' + w.to + '; ' + w.undated + ' undated peers count as oldest): error ' + E3(w.fitted) + ' vs ' + E3(w.baseline) + ' category-only. An age-cohort split of one snapshot, not a backtest.', 'prose')),
        card('Ranges and their coverage',
          p('A row’s range is its value × ' + Math.exp(b.lo).toFixed(2) + ' to × ' + Math.exp(b.hi).toFixed(2) + ' (P25–P75 of the out-of-fold residual ln(actual / predicted); P10–P90, × ' + Math.exp(b8.lo).toFixed(2) + ' to × ' + Math.exp(b8.hi).toFixed(2) + ', for low-confidence rows).', 'prose'),
          p('Measured with bands built from the walk-forward training part alone: the 50% band held ' + b.inside + ' of ' + b.n + ' (' + pc1(b.coverage) + '), the 80% band ' + b8.inside + ' of ' + b8.n + ' (' + pc1(b8.coverage) + '). The bands are wide: the model gives scale, not a price.', 'prose')),
        scatter()),
      el('div', { class: 'grid mb' }, fitPanel(),
        card('Launch propensity: fitted on the peers’ record',
          tbl(['Feature', 'Weight'], o.features.map(function (n, i) { return [n, o.coefficients[i].toFixed(3)]; }), 1),
          p('Logistic regression of “records a token” over ' + o.n_scope + ' protocols in scope: the category’s tokenized share (shrunk toward the global ' + fmtOdds(o.global_rate) + ' by ' + o.smoothing + ' pseudo-protocols, leave-one-out), ln TVL (z), ln chains, ln age. L2 λ = ' + o.lambda + ', ' + o.iterations + ' Newton steps; odds clamped to 2–95%.'),
          p('Slug-parity split (' + o.n_train + ' fit, ' + o.n_test + ' held): Brier ' + o.brier_propensity.toFixed(4) + ' vs ' + o.brier_base.toFixed(4) + ' for the base rate. Odds test: smoothing ' + x.variant + ' vs ' + x.current + ' scored ' + x.brier_variant.toFixed(4) + ' vs ' + x.brier_current.toFixed(4) + ' on the same half (tolerance +' + x.tolerance + '), so it was ' + (x.adopted ? 'adopted' : 'rejected') + '. A description of the record, not a forecast of any issuance.'))),
      el('div', { class: 'grid' },
        card('Farm-plan assumptions', tbl(['Tier', 'Chains', 'Round trip'], tiers, 2),
          p('A plan names the first ' + F.max_chains + ' chains and sums their tier costs (bridge plus gas). Tiers are a cost assumption, not a measurement.')),
        card('How a farm plan is costed',
          el('div', { class: 'prose' },
            el('p', {}, el('b', { text: 'Wallets. ' }), el('code', { text: 'clamp(round(' + dl.base + ' × (TVL / $' + dl.ref_tvl_usd / 1e6 + 'M)^' + dl.exponent + '), ' + dl.min + ', ' + dl.max.toLocaleString('en-US') + ')' }), ' share the ' + ap + '% pool equally. ', el('b', { text: 'Deposit. ' }), el('code', { text: 'clamp(round(TVL × ' + dp.rate + ' / ' + dp.step + ') × ' + dp.step + ', $' + dp.min + ', $' + dp.max.toLocaleString('en-US') + ')' }), '.'),
            el('p', {}, el('b', { text: 'EV a wallet. ' }), 'implied × odds × ' + ap + '% / wallets; P25 EV uses the P25 value. ', el('b', { text: 'All-in. ' }), 'fees + hours × $' + F.hour_value_usd + ' + deposit × ' + (F.capital_apr * 100).toFixed(1) + '% × hold weeks / 52.'),
            el('p', {}, el('b', { text: 'Verdict. ' }), 'Worth it: point EV ≥ ' + F.worth_ratio + 'x all-in and P25 EV ≥ ' + F.worth_p25_floor + 'x. Marginal: point EV ≥ ' + F.marginal_ratio + 'x but not Worth it. Skip: below. A THIN row (category under ' + 3 + ' peers) is capped at Marginal. Thresholds are not tuned to a count.')))));
  }

  // ---- comparables
  function comparablesView() {
    var peers = D.peers.map(function (q) {
      return el('tr', {}, el('td', { text: q.category }), el('td', { class: 'n', text: String(q.n) }), el('td', { class: 'n val', text: fmtX(q.median_multiple) }),
        el('td', { class: 'n dim', text: fmtX(q.multiple) }));
    });
        return el('div', {},
      p('Comparables are the ' + D.peer_total + ' protocols in this snapshot that already have a market cap and TVL. Their mcap/TVL ratios, not a hand-set constant, calibrate every pre-token row.', 'note'),
      el('div', { class: 'grid mb' }, fitPanel(), coveragePanel()),
      el('div', { class: 'grid' },
        el('section', { class: 'tablebox' }, el('table', {},
          el('thead', {}, el('tr', {}, el('th', { text: 'Category' }), el('th', { class: 'n', text: 'Peers n' }), el('th', { class: 'n', text: 'Median mcap/TVL' }), el('th', { class: 'n', text: 'Shrunk multiple' }))),
          el('tbody', {}, peers))),
        el('section', { class: 'card' }, el('h3', { text: 'The model in words' }),
          el('div', { class: 'prose' },
            el('p', {}, el('b', { text: 'Value. ' }), 'A power law of market cap on TVL, pulled toward the category’s multiple: (n×category + ' + D.model.prior_weight + '×global) / (n + ' + D.model.prior_weight + '), capped at ' + fmtX(D.peer_cap_multiple) + ', held lower as the category thins. The category keeps w = n/(n+' + D.fit.k + ') of its deviation from the curve; a category with no peers is the curve.'),
            el('p', {}, el('b', { text: 'Thin categories. ' }), 'Under 3 peers a row is tagged THIN and capped at Marginal; under 5 its pull away from the curve is capped at the peers’ P90 residual.'),
            el('p', {}, el('b', { text: 'Terms, fitted robustly. ' }), 'Size (free), growth, maturity and chains are coef × (feature − peer mean) from the Huber fit; the sum of the last three plus the base is clamped to ×0.5–2. Growth is 7d TVL change clamped to ±50 (missing: category median of pre-token protocols); unknown age counts as ' + D.model.unknown_age_days + ' days.'),
            el('p', {}, el('b', { text: 'Launch odds. ' }), 'A fitted propensity (see the Model tab), clamped to 2–95%, scored against the base rate; the category’s tokenized share, ' + fmtOdds(D.odds.global_rate) + ' globally, is its basis.'),
            el('p', {}, el('b', { text: 'Implied value ' }), 'is the blend above, rounded to whole dollars. Board rows are pre-token only: no market cap, CoinGecko id or symbol recorded.')))));
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
    root.appendChild(el('div', { class: 'wrap' + (view === 'board' ? ' wide' : '') }, header(), modelLine(), tabs(), el('main', {}, inner)));
    if (keep) { var s = root.querySelector('input[type=search]'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }
    if (view !== 'board') document.title = 'Token Launch Radar';
  }
  window.addEventListener('hashchange', function () { window.scrollTo(0, 0); draw(); });
  draw();
})();
