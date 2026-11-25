// Token Radar's dashboard, radar-5. It reads window.RADAR (written beside
// dashboard/ by main.ts) and renders the ranked board, a filterable table,
// and a per-protocol detail view with the model's own inputs and the
// protocol's farm plan. No network: every byte it shows is in data.js. The
// farm plan is rendered from the row itself, never re-derived in the page,
// so the page and board.json cannot disagree about it. The implied value is
// recomputed in the detail view from the row's own multipliers and checked
// against the board.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var mount = document.getElementById('board');
  var view = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  // -- formatting -----------------------------------------------------------

  var usdWhole = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdWhole.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function age(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function signedDollars(n) {
    return (n >= 0 ? '+' : '-') + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function chainList(chains, max) {
    if (!chains || !chains.length) return 'an unnamed chain';
    if (max && chains.length > max) return chains.slice(0, max).join(', ') + ' + ' + (chains.length - max) + ' more';
    return chains.join(', ');
  }
  // The model, recomputed from the row's own multipliers: TVL x category
  // multiple x growth x maturity x the pre-token discount.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.category_multiple * row.growth_multiplier * row.maturity_multiplier * DATA.model.pre_token_discount));
  }

  // -- a small element builder ----------------------------------------------

  // h('div', {class: 'x'}, [children]) — attrs: class, text, html, on*,
  // anything else becomes an attribute. Children may be nodes, strings,
  // arrays, or nulls (skipped).
  function h(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (v !== null && v !== undefined) node.setAttribute(k, v);
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    });
    return node;
  }
  function fact(label, big, small) {
    return h('div', { class: 'fact' }, [
      h('span', { text: label }),
      h('b', { text: big }),
      h('small', { text: small }),
    ]);
  }
  function kv(label, value, cls) {
    return h('div', { class: cls || null }, [h('span', { text: label }), h('b', { class: 'num', text: value })]);
  }

  // -- hash state ------------------------------------------------------------

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.q = params.get('q');
    if (params.get('p')) view.selected = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('tab')) view.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (view.q) params.set('q', view.q);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.tab !== 'pre-token') params.set('tab', view.tab);
    if (view.selected) params.set('p', view.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // -- filtering and sorting ---------------------------------------------------

  function visibleRows() {
    var q = view.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (view.tab === 'watchlist' && !r.watchlist) return false;
      if (view.category !== 'all' && r.category !== view.category) return false;
      if (view.chain !== 'all' && !(r.chains || []).includes(view.chain)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortValue(r, key) {
    if (key === 'name') return r.name.toLowerCase();
    if (key === 'tvl') return r.tvl_usd;
    if (key === 'growth') return r.change_7d === null ? -Infinity : r.change_7d;
    if (key === 'age') return r.age_days === null ? Infinity : r.age_days;
    if (key === 'verdict') return r.farm_net_low_usd;
    return r.implied_value_usd;
  }
  function sortedRows(list) {
    var key = view.sort;
    var dir = view.dir;
    return list.slice().sort(function (a, b) {
      var av = sortValue(a, key);
      var bv = sortValue(b, key);
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // -- page sections -----------------------------------------------------------

  function pageHeader() {
    return h('header', { class: 'top' }, [
      h('div', { class: 'brand' }, [
        h('span', { class: 'mark' }),
        h('span', { class: 'brand-name', text: 'Token Radar' }),
        h('span', { class: 'brand-sub', text: 'pre-token protocols, ranked' }),
      ]),
      h('div', { class: 'top-meta' }, [
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' }),
      ]),
    ]);
  }

  function lede() {
    var top = DATA.rows[0];
    var aboveFloor = DATA.rows.filter(function (r) { return !r.watchlist && r.tvl_usd >= DATA.floor_usd; }).length;
    return h('section', { class: 'lede' }, [
      h('div', null, [
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by what their token would be worth' }),
        h('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols that pass the same screen, ' + aboveFloor + ' of them above that floor: the board ranks what the live market would pay, not the watchlist\u2019s cutoff. Implied value is priced off a size curve fitted on the live market in this same snapshot: log market cap on log TVL, with one offset per category — exchange tokens left out of the fit, because their multiples price the exchange, not the protocol. Size itself predicts the multiple — larger protocols trade at lower multiples — and the curve is tested out of sample four ways before the board is trusted. It is a model, not a price.' }),
      ]),
      h('div', { class: 'facts' }, [
        fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'every watchlist protocol is ranked'),
        fact('Pre-token rows', String(DATA.board_size), DATA.early_size + ' early rows that pass the launch screen'),
        fact('Top implied value', top ? money(top.implied_value_usd) : 'n/a', top ? top.name : ''),
        fact('Screened out', String(DATA.screened_out), 'pre-token protocols that fail the launch screen'),
      ]),
    ]);
  }

  function validationPanel() {
    var v = DATA.validation;
    if (!v) return null;
    var verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
    DATA.rows.forEach(function (r) { verdicts[r.farm_verdict]++; });
    return h('section', { class: 'panel validation' }, [
      h('h2', { text: 'The model, tested out of sample — four held-out ways' }),
      h('p', { class: 'sub', text: 'The curve is fitted on the live market in this same snapshot — so before the board is trusted, it is tested on data the fit never saw. Leave-one-out refits the curve without each live protocol and predicts its market cap from its TVL; the time-split fits on older listings and tests on newer ones; the walk-forward grows the training window and predicts every dated protocol once as a future listing; leave-one-category-out predicts a whole category blind, with no offset of its own. The conformal intervals are built from those errors, and the bootstrap resamples the live comparables and rebuilds the board. A curve is a pricing kernel, not a price: the median protocol is mispriced by a factor of ' + Math.max(1, Math.round(v.loocv.median_error_multiple)) + ', so a row is a candidate to research, never a valuation to trade on.' }),
      h('div', { class: 'facts' }, [
        fact('Leave-one-out, median error', 'x' + v.loocv.median_error_multiple.toFixed(2), v.loocv.n + ' live protocols; ' + Math.round(v.loocv.within_2x * 100) + '% within 2x, ' + Math.round(v.loocv.within_3x * 100) + '% within 3x'),
        fact('Time-split, median error', 'x' + v.time_split.median_error_multiple.toFixed(2), 'fitted on ' + v.time_split.n_train + ' listings before ' + v.time_split.cut_date + ', tested on ' + v.time_split.n_test + ' newer ones'),
        fact('Walk-forward, median error', 'x' + v.walk_forward.median_error_multiple.toFixed(2), 'every one of ' + v.walk_forward.n_test + ' dated protocols predicted once as a future listing; ' + Math.round(v.walk_forward.within_2x * 100) + '% within 2x'),
        fact('Leave-one-category-out', 'x' + v.leave_one_category_out.median_error_multiple.toFixed(2), v.leave_one_category_out.n_categories + ' categories predicted blind; ' + Math.round(v.leave_one_category_out.within_2x * 100) + '% within 2x'),
        fact('Conformal 90% intervals', Math.round(v.conformal.coverage * 100) + '% covered', 'true market cap inside its interval for ' + Math.round(v.conformal.coverage * 100) + '% of ' + v.conformal.n + ' protocols; median interval spans x' + v.conformal.median_interval_factor.toFixed(2)),
        fact('Bootstrap top 10', v.bootstrap.top10_overlap_mean.toFixed(2) + ' / 10', v.bootstrap.rounds + ' resamples; each top-10 row moves ' + v.bootstrap.top10_rank_shift_mean.toFixed(2) + ' ranks, rank 1 stays in ' + Math.round(v.bootstrap.rank1_stays_share * 100) + '%'),
        fact('Farm verdicts', verdicts.FARM + ' FARM', verdicts.THIN + ' THIN, ' + verdicts.SKIP + ' SKIP of ' + DATA.board_size + ' rows, netted at the band\u2019s low end'),
      ]),
    ]);
  }

  function modelPanel() {
    var m = DATA.model;
    var rows = DATA.comparables.slice(0, 10).map(function (c) {
      return h('tr', null, [
        h('td', { text: c.category }),
        h('td', { class: 'num', text: String(c.n) }),
        h('td', { class: 'num', text: (c.offset >= 0 ? '+' : '') + c.offset.toFixed(3) }),
        h('td', { class: 'num', text: c.multiple.toFixed(3) + 'x' }),
      ]);
    });
    var reasons = DATA.screen_reasons.map(function (r) { return r.count + ' ' + r.reason; }).join('; ');
    var aboveFloor = DATA.rows.filter(function (r) { return !r.watchlist && r.tvl_usd >= DATA.floor_usd; }).length;
    return h('section', { class: 'panel model' }, [
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'One function scores every protocol. No name is special-cased, and no row is hand-picked. The size curve is fitted on the live-token protocols in this same snapshot, leaving out exchange tokens: ln(market cap) = ' + DATA.curve.intercept.toFixed(3) + ' + ' + DATA.curve.slope.toFixed(3) + ' x ln(TVL), plus one offset per category — the mean residual of its live protocols, shrunk toward zero with ' + m.shrink_pseudo + ' pseudo-observations, so a category with one live protocol does not inherit its offset wholesale. A protocol\u2019s fitted multiple is the curve\u2019s prediction at its own TVL, clamped to ' + m.multiple_floor + 'x–' + m.multiple_cap + 'x.' }),
      h('div', { class: 'formula' }, 'implied = round( exp(' + DATA.curve.intercept.toFixed(3) + ' + ' + DATA.curve.slope.toFixed(3) + ' x ln TVL + offset) x (1 + clamp(7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x ' + m.pre_token_discount + ' )'),
      h('table', { class: 'mini' }, [
        h('caption', { class: 'sub', text: 'Live comparables by category: the ten largest categories. Offset is the category\u2019s shrunk log-point offset in the curve; multiple is the fitted multiple at the category\u2019s median live TVL.' }),
        h('thead', null, [h('tr', null, [
          h('th', { text: 'Category' }),
          h('th', { class: 'num', text: 'Live n' }),
          h('th', { class: 'num', text: 'Curve offset' }),
          h('th', { class: 'num', text: 'Multiple at median TVL' }),
        ])]),
        h('tbody', null, rows),
      ]),
      h('p', { class: 'sub', text: 'Screened out: ' + DATA.screened_out + ' pre-token protocols fail the launch screen — ' + reasons + '. Above the floor, protocols the watchlist leaves out are ranked too when they pass the same screen — ' + aboveFloor + ' of them — because the board ranks what the live market would pay, not the watchlist\u2019s cutoff. A protocol records no token; that is not proof it has none.' }),
    ]);
  }

  // -- controls ----------------------------------------------------------------

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: view.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { view.q = search.value; writeHash(); render(); });
    var cat = h('select', { id: 'category', 'aria-label': 'Filter by category' }, [
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, text: c, selected: c === view.category ? 'selected' : null }); }),
    ]);
    cat.addEventListener('change', function () { view.category = cat.value; writeHash(); render(); });
    var chain = h('select', { id: 'chain', 'aria-label': 'Filter by chain' }, [
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null }); }),
    ]);
    chain.addEventListener('change', function () { view.chain = chain.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return h('button', { type: 'button', 'aria-pressed': view.tab === tab ? 'true' : 'false', text: label, onclick: function () { view.tab = tab; writeHash(); render(); } });
    }
    var count = view.tab === 'live' ? DATA.live.length + ' live-token protocols' : visibleRows().length + ' rows shown';
    return h('div', { class: 'controls' }, [
      h('div', { class: 'field' }, [h('label', { for: 'q', text: 'Search' }), search]),
      h('div', { class: 'field' }, [h('label', { for: 'category', text: 'Category' }), cat]),
      h('div', { class: 'field' }, [h('label', { for: 'chain', text: 'Chain' }), chain]),
      h('div', { class: 'field' }, [h('span', { class: 'sub', text: 'View' }), h('div', { class: 'tabs' }, [tabBtn('pre-token', 'Pre-token'), tabBtn('watchlist', 'Watchlist'), tabBtn('live', 'Live token')])]),
      h('span', { class: 'count', text: count }),
    ]);
  }

  // -- tables ------------------------------------------------------------------

  function sortHeader(key, label) {
    var arrow = view.sort === key ? h('span', { 'aria-hidden': 'true', text: view.dir < 0 ? ' v' : ' ^' }) : null;
    return h('th', { scope: 'col' }, [
      h('button', { type: 'button', onclick: function () { if (view.sort === key) view.dir = -view.dir; else { view.sort = key; view.dir = -1; } render(); } }, [label, arrow]),
    ]);
  }

  function boardRowNode(r, max) {
    var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
    var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
    var badge = h('span', { class: 'badge ' + (r.watchlist ? 'watch' : 'early'), text: r.watchlist ? 'Watchlist' : 'Early' });
    return h('tr', {
      'data-selected': view.selected === r.slug ? 'true' : 'false',
      tabindex: '0',
      onclick: function () { openDetail(r.slug); },
      onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } },
    }, [
      h('td', { class: 'num', text: String(r.rank) }),
      h('td', null, [h('div', { class: 'name' }, [
        h('span', null, [h('b', { text: r.name }), badge]),
        h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainList((r.chains || []).slice(0, 2)) }),
      ])]),
      h('td', { class: 'num', text: money(r.tvl_usd) }),
      h('td', { class: 'num ' + growthClass, text: growth }),
      h('td', { class: 'num', text: age(r.age_days) }),
      h('td', null, [h('div', { class: 'implied' }, [
        h('div', { class: 'bar', 'aria-hidden': 'true' }, [h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })]),
        h('span', { class: 'num', text: money(r.implied_value_usd) }),
      ])]),
      h('td', null, [h('div', { class: 'verdict' }, [
        h('span', { class: 'badge verdict-' + r.farm_verdict.toLowerCase(), text: r.farm_verdict }),
        h('span', { class: 'num ' + (r.farm_net_low_usd >= 0 ? 'pos' : 'neg'), text: (r.farm_net_low_usd >= 0 ? '+' : '') + '$' + Math.round(Math.abs(r.farm_net_low_usd)).toLocaleString('en-US') }),
      ])]),
      h('td', null, [h('span', { class: 'status', text: 'no token' })]),
    ]);
  }

  function boardTable() {
    var list = sortedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, [h('div', { class: 'empty' }, [
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { view.q = ''; view.category = 'all'; view.chain = 'all'; writeHash(); render(); } }),
      ])]);
    }
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = h('tbody', null, list.map(function (r) { return boardRowNode(r, max); }));
    return h('div', { class: 'panel' }, [
      h('div', { class: 'table-wrap' }, [
        h('table', { class: 'board' }, [
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan.' }),
          h('thead', null, [h('tr', null, [
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('implied', 'Implied value'),
            sortHeader('verdict', 'Farm verdict'),
            h('th', { scope: 'col', text: 'Token' }),
          ])]),
          tbody,
        ]),
      ]),
    ]);
  }

  function liveTable() {
    var tbody = h('tbody', null, DATA.live.map(function (r) {
      return h('tr', null, [
        h('td', { class: 'num', text: 'live' }),
        h('td', null, [h('div', { class: 'name' }, [
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + chainList((r.chains || []).slice(0, 2)) }),
        ])]),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : r.mcap_tvl.toFixed(2) + 'x' }),
        h('td', null, [h('span', { class: 'status', text: 'already trades' })]),
      ]);
    }));
    return h('div', { class: 'panel' }, [
      h('div', { class: 'table-wrap' }, [
        h('table', { class: 'board' }, [
          h('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. The size curve fitted on them is what prices the pre-token board.' }),
          h('thead', null, [h('tr', null, [
            h('th', { scope: 'col', text: 'Status' }),
            h('th', { scope: 'col', text: 'Protocol' }),
            h('th', { scope: 'col', text: 'TVL' }),
            h('th', { scope: 'col', text: '7d' }),
            h('th', { scope: 'col', text: 'Market cap' }),
            h('th', { scope: 'col', text: 'Mcap / TVL' }),
            h('th', { scope: 'col', text: 'Token' }),
          ])]),
          tbody,
        ]),
      ]),
    ]);
  }

  // -- detail dialog -------------------------------------------------------------

  var dialog = h('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { view.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    view.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recomputed = impliedOf(row);
    var steps = row.farm_steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return h('li', null, [h('b', { text: action }), h('span', { class: 'cost', text: tail })]);
    });
    dialog.appendChild(h('div', { class: 'detail-head' }, [
      h('div', null, [
        h('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? '  ·  Watchlist' : '  ·  Early') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + chainList(row.chains, 4) + (row.listed_at ? '  ·  listed ' + row.listed_at : '') }),
      ]),
      h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } }),
    ]));
    dialog.appendChild(h('section', { class: 'detail-section' }, [
      h('h3', { text: 'Implied value' }),
      h('div', { class: 'equation' }, [
        kv('TVL', money(row.tvl_usd)),
        kv((row.category || 'Other') + ' multiple (' + row.comparables_n + ' live comparables)', row.category_multiple.toFixed(3) + 'x'),
        kv('Seven-day growth', pct(row.change_7d) + '  →  ' + row.growth_multiplier.toFixed(3) + 'x'),
        kv('Age with no token', age(row.age_days) + '  →  ' + row.maturity_multiplier.toFixed(3) + 'x'),
        kv('Pre-token discount', DATA.model.pre_token_discount.toFixed(2) + 'x'),
        kv('Implied value', money(row.implied_value_usd), 'total'),
      ]),
      h('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') }),
    ]));
    dialog.appendChild(h('section', { class: 'detail-section' }, [
      h('h3', { text: 'Farm plan' }),
      h('ol', { class: 'steps' }, steps),
      h('div', { class: 'note', text: 'No token is promised by this protocol\u2019s record. Farm for usage history across weeks, not for a guaranteed airdrop, and never pay anyone to claim one.' }),
    ]));
    dialog.appendChild(h('section', { class: 'detail-section' }, [
      h('h3', { text: 'Farm verdict: ' + row.farm_verdict }),
      h('div', { class: 'equation' }, [
        kv('Farm plan\u2019s total cost (gas + time + carry)', '$' + row.farm_cost_usd.toFixed(2)),
        kv('Implied value at the band\u2019s low end', money(row.farm_low_end_usd)),
        kv('Expected payout at the low end', '$' + Math.round(row.farm_expected_usd).toLocaleString('en-US')),
        h('div', { class: 'total' }, [
          h('span', { text: 'Net at the low end' }),
          h('b', { class: 'num ' + (row.farm_net_low_usd >= 0 ? 'pos' : 'neg'), text: signedDollars(row.farm_net_low_usd) }),
        ]),
      ]),
      h('p', { class: 'sub', text: 'The plan\u2019s cost is gas plus time at $' + DATA.farm_assumptions.time_value_per_hour_usd + ' an hour plus carry on the locked capital at ' + Math.round(DATA.farm_assumptions.carry_apr * 100) + '% a year. The payout is the low-end value times a stated farmer\u2019s share of ' + (DATA.farm_assumptions.farmer_share * 100).toFixed(4) + '% (5% of supply to about 2,000 qualifying wallets) — an assumption, not a promise. FARM clears a $' + DATA.farm_assumptions.farm_threshold_usd + ' low-end net, THIN covers its cost, SKIP does not.' }),
    ]));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  // -- render ----------------------------------------------------------------------

  function render() {
    mount.textContent = '';
    var shell = h('div', { class: 'shell' }, [
      pageHeader(),
      lede(),
      validationPanel(),
      controls(),
      view.tab === 'live' ? liveTable() : boardTable(),
      view.tab !== 'live' ? modelPanel() : null,
      h('footer', { class: 'foot' }, [h('p', { text: 'Token Radar ' + DATA.model_version + ' · Snapshot ' + DATA.as_of + ' · ' + DATA.source + ' · Implied values are the model\u2019s claim, never a price. Farm plans are suggestions, not financial advice.' })]),
    ]);
    mount.appendChild(shell);
    mount.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) mount.appendChild(dialog);
    if (view.selected) openDetail(view.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
