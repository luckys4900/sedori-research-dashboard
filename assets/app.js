/* =========================================================================
   Sedori Research Dashboard — app.js   (consumer of CONTRACT.md v1.1.0)
   Shared by index.html (data-page="index") and product.html (data-page="product").

   Rendering rules this file enforces:
     * A null field renders as「不明」in a muted style. Never 0, never blank,
       never a guessed date.
     * 定価 (list_price_jpy) and 取得原価 (acquisition_cost_jpy) are different
       things. The list price is NEVER shown as an acquisition cost, and an
       unverified acquisition cost renders「未確認」— never a substituted number.
     * `closing_soon_band` is the ONLY authority for 締切間近. A near deadline
       whose acceptance state was not confirmed is shown under its own
       explicitly-labelled section, never as 締切間近.
     * A raw internal enum token is never printed. A status basis is rendered
       from `status_basis_label_ja`; when that is null, nothing is rendered.
     * A month-precision release date renders `release_date_display` verbatim.
     * DISCOVERY_UNVERIFIED rows are visually distinct (dashed frame + tint +
       an explicit 未検証 badge). They must never look like verified rows.
     * No buy recommendation, profit figure, expected value, score or ranking is
       computed, displayed or implied. `is_attention` / `attention_reasons` come
       from the build only and mean "evidence-backed signals are present".
     * Every string from JSON goes through textContent. There is no HTML-string
       attribute case). The JSON is treated as untrusted text.
     * Human decision marks live only in localStorage and are never sent.
     * A field the build has not emitted yet renders as 不明 / an empty block —
       never an exception.
   ========================================================================= */
'use strict';

/* ---------------------------------------------------------------- constants */

var DATA_PRODUCTS = 'data/products.json';
var DATA_STATS = 'data/stats.json';
var DATA_METADATA = 'data/metadata.json';
var MARKS_KEY = 'sedori_dashboard_marks_v1';
var UNKNOWN_TEXT = '不明';
var UNVERIFIED_COST_TEXT = '未確認';
var UNKNOWN_ENUM_TEXT = '区分未確認';

/* A highlight section never repeats the whole catalogue: it shows the top N of
   its own sort and hands the rest to 全商品一覧 through「すべて見る」. */
var SECTION_CAP = 12;

/* A flag badge that applies to almost every row carries no information, so the
   per-card 新着 badge is suppressed once its share of the corpus reaches this.
   Threshold, not a hardcode: it disappears while the corpus is freshly seeded
   and comes back by itself once 新着 becomes a minority again. */
var NEW_BADGE_MAX_SHARE = 0.6;

/* Human decision marks (browser only). Order is the button order. */
var MARKS = [{ id: 'UNDECIDED', label: '未判断' }, { id: 'CANDIDATE', label: '購入候補' },
  { id: 'WATCH', label: '監視' }, { id: 'SKIP', label: '見送り' }];
var MARK_IDS = MARKS.map(function (m) { return m.id; });

/* Semantic colour group per `status` enum. */
var STATUS_GROUP = {
  OPEN_NOW: 'open', RESTOCKED: 'restock', CLOSING_SOON: 'closing',
  NOT_STARTED: 'pending', RESULT_PENDING: 'pending', PAYMENT_PENDING: 'pending',
  PICKUP_PENDING: 'pending', SHIPPING_PENDING: 'pending',
  CLOSED: 'closed', ENDED: 'closed', RELEASED: 'closed', UNKNOWN: 'unknown'
};

/* Canonical display order for the 現在状態 select. */
var STATUS_ORDER = [
  'CLOSING_SOON', 'OPEN_NOW', 'NOT_STARTED', 'RESULT_PENDING', 'PAYMENT_PENDING',
  'PICKUP_PENDING', 'SHIPPING_PENDING', 'RESTOCKED', 'RELEASED', 'CLOSED',
  'ENDED', 'UNKNOWN'
];

var CATEGORY_LABEL = {
  TCG: 'トレーディングカード', FIGURE: 'フィギュア', TOY: '玩具・ホビー',
  CHARACTER_GOODS: 'キャラクターグッズ', BOOK_MOOK: '書籍・ムック',
  ONLINE_LOTTERY: 'オンラインくじ', COLLAB: 'コラボ商品', OTHER: 'その他',
  UNKNOWN: '不明'
};

var SALE_MODE_LABEL = {
  LOTTERY: '抽選', PREORDER: '予約', MADE_TO_ORDER: '受注生産',
  GENERAL_SALE: '一般販売', OFFICIAL_EC: '公式EC', STORE_LIMITED: '店舗限定',
  EC_LIMITED: 'EC限定', RESTOCK: '再販', UNKNOWN: '不明'
};

var DEADLINE_KIND_LABEL = {
  LOTTERY: '抽選締切', RESERVATION: '予約締切', APPLICATION: '応募締切', SALES: '販売終了'
};

var TIER_LABEL = {
  CANONICAL_VERIFIED: '一次情報の照合済み', CANONICAL_PARTIAL: '一部のみ照合',
  DISCOVERY_UNVERIFIED: '未検証（発見候補）'
};

var URL_KIND_LABEL = { OFFICIAL: '公式ページ', RETAILER: '販売ページ' };

/* profit_evidence_status — a display ladder, never a verdict. NOT_EVALUATED is
   step 1 ("not started"), styled exactly as neutrally as every other step. */
var PROFIT_LADDER = ['NOT_EVALUATED', 'PARTIAL', 'ROUTE_EVIDENCE_PARTIAL',
  'PRICE_EVIDENCE_READY', 'FORMAL_READY'];
var PROFIT_STEP_LABEL = {
  NOT_EVALUATED: '未評価', PARTIAL: '一部のみ確認', ROUTE_EVIDENCE_PARTIAL: '取得経路のみ確認',
  PRICE_EVIDENCE_READY: '過去の成約価格を確認', FORMAL_READY: '必要な材料がそろう'
};
var PROFIT_DETAIL_LABEL = {
  linked_comparables: '比較対象の紐付け数',
  comparables_with_price_evidence: 'うち過去の成約価格が確認できた数',
  comparables_with_verified_route: 'うち取得経路が確認できた数',
  strict_completed_sales: '厳格に数えた成約件数',
  profit_usable_comparables: '利益計算に使える比較対象数',
  minimum_profit_sample: '必要な最低件数'
};
var PROFIT_DETAIL_ORDER = ['linked_comparables', 'comparables_with_price_evidence',
  'comparables_with_verified_route', 'strict_completed_sales',
  'profit_usable_comparables', 'minimum_profit_sample'];

var PROFIT_NOTE_JA =
  '利益の自動評価はまだ利用できません。ここに出るのは「確認がどこまで進んだか」だけで、' +
  '利益額・期待値・推奨ではありません。最終判断は読者が行います。';

/* opportunity_signals carry their own `label_ja`; this map is only a fallback
   for the closed code set, so a chip is never rendered as a raw token. */
var SIGNAL_LABEL = {
  LOTTERY_ONLY: '抽選のみ', EC_LIMITED: 'EC限定', STORE_LIMITED: '店舗限定',
  PURCHASE_LIMIT: '購入制限あり', MADE_TO_ORDER: '受注生産',
  SHORT_ORDER_WINDOW: '受付期間が短い', RESTOCK: '再販あり', END_OF_SALE: '販売終了が近い',
  HISTORICAL_PRICE_EVIDENCE: '過去の成約価格の記録あり',
  STRICT_COMPLETED_SALES: '厳格な成約記録あり', SUPPLY_LIMITED: '供給が限られる',
  REPRINT_RISK: '再録・再版の可能性', UNKNOWN: '注目理由は未確定'
};

/* route_evidence — shadow model. Labels only; no raw token ever reaches the DOM. */
var ROUTE_STATUS_LABEL = {
  VERIFIED: '取得経路を一次情報で確認', ENUMERATED_NOT_EVIDENCED: '経路の候補は列挙済み・裏付けなし',
  SHADOW_UNVERIFIED: '申告のみで未検証', NONE: '経路情報なし'
};
var ROUTE_CLASS_LABEL = {
  STORE_PICKUP: '店頭受取', STORE_PURCHASE: '店頭購入', OFFICIAL_EC: '公式EC',
  OFFICIAL_EC_LOTTERY: '公式ECの抽選', RETAILER_EC: '小売EC', OTHER: 'その他の経路'
};
/* Routes are grouped by how each row was established, and the groups are never
   merged: an availability-verified route and a seller's declaration are
   different claims. A group with no Japanese heading is not invented. */
var ROUTE_GROUPS = [
  { status: 'VERIFIED', title: '当時利用できた経路（一次情報で日付まで確認）' },
  { status: 'ENUMERATED_NOT_EVIDENCED', title: '列挙されただけで裏付けのない経路' },
  { status: 'SHADOW_UNVERIFIED', title: '出品者が申告した経路（未検証）' }
];
var ROUTE_GROUP_OTHER = '確認区分が不明な経路';

var PRICE_SAMPLE_STATUS_LABEL = {
  STRICT: '厳格な成約のみ', REPRESENTATIVE: '代表性あり', INSUFFICIENT: '件数不足',
  PARTIAL: '一部のみ', UNKNOWN: '不明', NOT_EVALUATED: '未評価'
};

/* Pseudo value for the status select meaning「受付中（抽選・予約）」. */
var GROUP_OPEN = 'GROUP_OPEN';
var OPEN_STATUSES = ['OPEN_NOW', 'CLOSING_SOON'];
function isOpenStatus(p) { return OPEN_STATUSES.indexOf(p.status) !== -1; }

var BAND_DAYS = { WITHIN_24H: 1, WITHIN_3D: 3, WITHIN_7D: 7 };

/* ---------------------------------------------------------------- utilities */

/** Escape a value for safe use in an HTML attribute / markup context. */

/** true when the value counts as UNKNOWN for display purposes. */
function isUnknown(v) {
  return v === null || v === undefined || v === '' ||
    (Array.isArray(v) && v.length === 0);
}

function $(id) { return document.getElementById(id); }

/** Enum -> Japanese label. An unmapped ALL_CAPS token is never printed raw. */
/** Prefer the label the build published; only then the local map. A value the producer
    understands must never collapse to 「区分未確認」 in the UI. */
function own(map, key) {
  /* A data value like "constructor" or "toString" resolves to an inherited Object.prototype
     member. Left unguarded that promoted a row into 締切間近 — the page must never declare an
     urgency the status engine refused to declare. Every enum map read goes through here. */
  return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key)) ? map[key] : undefined;
}

function lblOf(obj, labelKey, map, rawKey) {
  var given = obj ? obj[labelKey] : null;
  if (!isUnknown(given)) { return String(given); }
  return lbl(map, obj ? obj[rawKey] : null);
}

function lbl(map, v) {
  if (isUnknown(v)) { return null; }
  var got = own(map, v);
  if (got !== undefined) { return got; }
  /* Looks like an internal enum we have no wording for: say so instead of
     leaking the token. Free-form text (which is not ALL_CAPS) passes through. */
  if (/^[A-Z][A-Z0-9_]*$/.test(String(v))) { return UNKNOWN_ENUM_TEXT; }
  return String(v);
}

/** Minimal element builder. `text` is always applied via textContent. */
function el(tag, className, text) {
  var n = document.createElement(tag);
  if (className) { n.className = className; }
  if (text !== undefined && text !== null) { n.textContent = String(text); }
  return n;
}

function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

/** Format YYYY-MM-DD (a plain calendar date, no timezone) as 2026年9月23日. */
function fmtDate(d) {
  if (isUnknown(d)) { return null; }
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d));
  if (!m) { return String(d); }            /* unexpected shape: show verbatim */
  return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日';
}

/**
 * Format `generated_at`. The contract guarantees an ISO-8601 string with a
 * +09:00 offset, so the literal fields already ARE JST — parse them directly
 * instead of going through Date (which would shift by the viewer's timezone).
 */
function fmtGeneratedAt(s) {
  if (isUnknown(s)) { return null; }
  var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(s));
  if (m) {
    return Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日 ' +
      m[4] + ':' + m[5] + ' (JST)';
  }
  return String(s);
}

/** ¥5,280 — only for a real integer. null stays UNKNOWN. */
function fmtPrice(v) {
  if (num(v) === null) { return null; }
  return '¥' + Math.round(v).toLocaleString('ja-JP');
}

function fmtCount(v) {
  return num(v) === null ? null : String(Math.round(v)) + '件';
}

/**
  * 定価 — the officially published list price, and nothing else. A document that
  * has not been rebuilt yet simply has no list price, which renders 「不明」: the
  * removed v1.0.0 field is never read as a stand-in.
  */
function listPriceOf(p) {
  return num(p.list_price_jpy);
}

/**
 * `acquisition_cost_jpy` (取得原価) — a verified route acquisition price, or null.
 * A number without a VERIFIED status is suppressed: an unproven cost is 未確認,
 * not a figure. The list price is never substituted here.
 */
function acquisitionCostOf(p) {
  if (p.acquisition_cost_status !== 'VERIFIED') { return null; }
  return num(p.acquisition_cost_jpy);
}

function signalsOf(p) {
  if (!Array.isArray(p.opportunity_signals)) { return []; }
  return p.opportunity_signals.filter(function (s) { return s && typeof s === 'object'; });
}

/** Chip text for one signal: data label first, closed-set fallback second. */
function signalText(s) {
  if (!isUnknown(s.label_ja)) { return String(s.label_ja); }
  if (!isUnknown(s.code) && Object.prototype.hasOwnProperty.call(SIGNAL_LABEL, s.code)) {
    return SIGNAL_LABEL[s.code];
  }
  return null;                              /* unlabelled signal: render nothing */
}

function attentionReasonsOf(p) {
  if (p.is_attention !== true || !Array.isArray(p.attention_reasons)) { return []; }
  return p.attention_reasons.filter(function (r) { return !isUnknown(r); }).map(String);
}

function hostOf(url) {
  try { return new URL(String(url)).hostname; } catch (e) { return null; }
}

/**
 * A data-driven URL may become an href ONLY if it is https.
 *
 * Everything in products.json is untrusted external text. `new URL()` is used as the
 * parser (it normalises case, whitespace and control characters, so `JaVaScRiPt:`,
 * ` javascript:` and `java\tscript:` all resolve to the `javascript:` protocol), and the
 * protocol is then matched exactly. http:, javascript:, data:, file:, vbscript:, blob:
 * and about: are all rejected. A protocol-relative `//host/path` has no protocol of its
 * own and fails to parse without a base, so it is rejected too — it is never resolved
 * against the page origin.
 */
function isSafeHttpUrl(url) {
  if (isUnknown(url)) { return false; }
  var raw = String(url);
  if (raw.slice(0, 2) === '//') { return false; }   /* protocol-relative */
  try {
    return new URL(raw).protocol === 'https:';
  } catch (e) { return false; }
}

/* ------------------------------------------------------- marks (localStorage)
   Every read and write is wrapped: storage can be disabled, full, or throw.  */

var marksAvailable = true;

function readMarks() {
  try {
    var raw = window.localStorage.getItem(MARKS_KEY);
    if (!raw) { return {}; }
    var obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) { return {}; }
    var out = {};
    Object.keys(obj).forEach(function (k) {
      if (MARK_IDS.indexOf(obj[k]) !== -1) { out[k] = obj[k]; }
    });
    return out;
  } catch (e) {
    marksAvailable = false;
    return {};
  }
}

function writeMarks(marks) {
  try {
    window.localStorage.setItem(MARKS_KEY, JSON.stringify(marks));
    return true;
  } catch (e) {
    marksAvailable = false;
    return false;
  }
}

function getMark(marks, id) {
  return (marks && Object.prototype.hasOwnProperty.call(marks, id)) ? marks[id] : 'UNDECIDED';
}

/* ---------------------------------------------- status / deadline predicates */

/**
 * 締切間近 — `closing_soon_band` is the ONLY authority. The build clears the
 * band for every row whose acceptance state is not OPEN_NOW / CLOSING_SOON, and
 * the status check here restates that invariant on the reading side so the page
 * can never declare an urgency the status engine refused to declare.
 */
function isClosingSoonRow(p) {
  return own(BAND_DAYS, p.closing_soon_band) !== undefined && isOpenStatus(p);
}

/**
 * A published date within 7 days whose acceptance state was NOT confirmed.
 * Worth showing — but never as 締切間近.
 */
function isNearTermUnconfirmed(p) {
  if (isClosingSoonRow(p)) { return false; }
  var d = num(p.days_to_deadline);
  return d !== null && d >= 0 && d <= 7;
}

function isRestockRow(p) {
  return p.status === 'RESTOCKED' || p.sale_mode === 'RESTOCK' || !isUnknown(p.restock_status);
}

/**
 * 購入可能 = an acceptance state the engine declared open, with a sale mode that
 * is not a lottery. This is the same predicate `stats.counts.buyable_now` uses,
 * so the section can never disagree with the published counter. A row whose sale
 * mode is UNKNOWN is included by that definition — the card still says
 * 「販売方式 不明」 and the section caption says so, rather than the page quietly
 * using a different rule than the data document.
 */
function isBuyableRow(p) {
  return isOpenStatus(p) && p.sale_mode !== 'LOTTERY';
}

/* ------------------------------------------------------------- shared pieces */

/** Status badge: label text from data, colour from the semantic group. */
function statusBadge(p) {
  var group = own(STATUS_GROUP, p.status) || 'unknown';
  /* Within 24h is escalated to the urgent colour — only for a row the status
     engine actually declared open. */
  if (isClosingSoonRow(p) && p.closing_soon_band === 'WITHIN_24H') { group = 'urgent'; }
  var label = isUnknown(p.status_label_ja) ? UNKNOWN_TEXT : p.status_label_ja;
  return el('span', 'badge badge--' + group, label);
}

/**
 * Evidence badge. The label comes from `evidence_label_ja`; the style comes
 * from `evidence_state` so a non-VERIFIED row can never wear the verified look.
 * Evidence badges are OUTLINE badges while state badges are FILLED, so colour
 * alone never conflates "what state is it in" with "how well is it confirmed".
 */
function evidenceBadge(p) {
  var variant = 'ev-none';
  if (p.evidence_state === 'VERIFIED') { variant = 'ev-verified'; }
  else if (p.evidence_state === 'PARTIAL') { variant = 'ev-partial'; }
  var label = isUnknown(p.evidence_label_ja) ? UNKNOWN_TEXT : p.evidence_label_ja;
  /* Defensive: never show 確認済み for a non-VERIFIED row. */
  if (p.evidence_state !== 'VERIFIED' && label === '確認済み') { label = '未検証'; }
  return el('span', 'badge badge--' + variant, label);
}

function isUnverifiedRow(p) {
  return p.verification_tier === 'DISCOVERY_UNVERIFIED' || p.evidence_state === 'UNVERIFIED';
}

/** Release text, precision-honest: month precision shows the display string. */
function releaseText(p) {
  if (!isUnknown(p.release_date_display)) { return String(p.release_date_display); }
  if (p.release_date_precision === 'day' && !isUnknown(p.release_date)) {
    return fmtDate(p.release_date);
  }
  return null;                              /* unknown or month without display */
}

/** Relative wording for a deadline. `confirmed` false adds the caveat. */
function deadlineRelText(p) {
  var d = num(p.days_to_deadline);
  if (d === null) { return null; }
  if (d < 0) { return '終了済み'; }
  var base = d === 0 ? '本日まで' : 'あと' + d + '日';
  if (isClosingSoonRow(p)) { return base; }
  return base + '（受付状態は未確認）';
}

/** One labelled cell. Renders「不明」muted when the value is unknown. */
function cell(extraClass, label, value, unknownText) {
  var wrap = el('div', 'cell ' + extraClass);
  wrap.appendChild(el('span', 'lbl', label));
  if (isUnknown(value)) {
    wrap.appendChild(el('span', 'val is-unknown', unknownText || UNKNOWN_TEXT));
  } else {
    wrap.appendChild(el('span', 'val', value));
  }
  return wrap;
}

/** The neutral 5-step evidence ladder. Never coloured as good or bad. */
function profitLadder(p, withLabel) {
  var status = isUnknown(p.profit_evidence_status) ? null : String(p.profit_evidence_status);
  var idx = status === null ? -1 : PROFIT_LADDER.indexOf(status);
  var box = el('div', 'ladder');
  var reached = idx < 0 ? 0 : idx + 1;
  box.setAttribute('role', 'img');
  var text = !isUnknown(p.profit_evidence_label_ja) ? String(p.profit_evidence_label_ja)
    : (idx >= 0 ? PROFIT_STEP_LABEL[status] : UNKNOWN_TEXT);
  box.setAttribute('aria-label', '確認の進み方 ' + (idx < 0 ? UNKNOWN_TEXT : (reached + '/5')) +
    '：' + text);
  for (var i = 0; i < PROFIT_LADDER.length; i++) {
    var step = el('span', 'ladder-step' + (i < reached ? ' is-reached' : ''));
    step.title = PROFIT_STEP_LABEL[PROFIT_LADDER[i]];
    box.appendChild(step);
  }
  if (!withLabel) { return box; }
  var wrap = el('div', 'ladder-wrap');
  wrap.appendChild(box);
  wrap.appendChild(el('span', 'ladder-label', text));
  return wrap;
}

/**
 * Signal chips. `max` caps the visible chips and adds a 「+N」 counter.
 *
 * A chip may be visually truncated in the dense list, so the full label and its basis must be
 * reachable without hovering: `title` is a convenience for a mouse, never the only fallback
 * (a touch device cannot open it reliably). Each chip carries its full label + basis as an
 * accessible name, the group announces where the complete text lives, and the whole card is a
 * link to the product detail page, which renders every signal unabbreviated.
 */
function signalChips(p, max) {
  var sigs = signalsOf(p);
  if (sigs.length === 0) { return null; }
  var box = el('div', 'chips');
  var full = [];
  var shown = 0;
  for (var i = 0; i < sigs.length; i++) {
    var text = signalText(sigs[i]);
    if (text === null) { continue; }
    var basis = isUnknown(sigs[i].basis_ja) ? null : String(sigs[i].basis_ja);
    full.push(basis ? (text + '：' + basis) : text);
    if (max && shown >= max) { continue; }
    var unknown = sigs[i].code === 'UNKNOWN';
    var chip = el('span', 'chip' + (unknown ? ' chip--unknown' : ''), text);
    /* The accessible name always carries the whole thing, truncated or not. */
    chip.setAttribute('aria-label', basis ? (text + '：' + basis) : text);
    if (basis) { chip.title = basis; }
    box.appendChild(chip);
    shown++;
  }
  if (shown === 0) { return null; }
  var rest = full.length - shown;
  if (rest > 0) {
    var more = el('span', 'chip chip--more', '+' + rest);
    more.setAttribute('aria-label', 'ほか' + rest + '件の注目理由。全文は詳細ページに表示されます。');
    box.appendChild(more);
  }
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label',
    '注目理由（' + full.length + '件）。' + full.join('／') + ' 全文は商品の詳細ページで確認できます。');
  return box;
}

/** The 4-way mark control. `onPick` receives the chosen mark id. */
function markControl(productId, current, onPick, wrapClass) {
  var box = el('div', wrapClass || 'card-marks');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', '判断マーク（このブラウザのみに保存）');
  MARKS.forEach(function (m) {
    var b = el('button', 'mark-btn', m.label);
    b.type = 'button';
    b.dataset.mark = m.id;
    b.setAttribute('aria-pressed', String(m.id === current));
    b.setAttribute('aria-label', m.label + 'にする');
    b.addEventListener('click', function () { onPick(m.id, box); });
    box.appendChild(b);
  });
  return box;
}

function syncMarkButtons(box, current) {
  var btns = box.querySelectorAll('.mark-btn');
  for (var i = 0; i < btns.length; i++) {
    btns[i].setAttribute('aria-pressed', String(btns[i].dataset.mark === current));
  }
}

function showError(message) {
  var panel = $('error-panel');
  var detail = $('error-detail');
  if (detail) { detail.textContent = message; }
  if (panel) { panel.hidden = false; }
  var loading = $('loading');
  if (loading) { loading.hidden = true; }
}

/** Fetch + parse products.json with readable Japanese failure messages. */
function loadProducts() {
  return fetch(DATA_PRODUCTS, { cache: 'no-cache' })
    .then(function (res) {
      if (!res.ok) {
        throw new Error('データファイルの取得に失敗しました（HTTP ' + res.status + '）。');
      }
      return res.text();
    })
    .then(function (text) {
      var doc;
      try { doc = JSON.parse(text); }
      catch (e) { throw new Error('データファイルの JSON を解釈できませんでした。'); }
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc.products)) {
        throw new Error('データファイルの形式が想定と異なります（products 配列がありません）。');
      }
      /* Drop anything without a usable id rather than rendering a broken link. */
      doc.products = doc.products.filter(function (p) {
        return p && typeof p === 'object' && typeof p.product_id === 'string' && p.product_id !== '';
      });
      return doc;
    });
}

/** Optional side document. A failure is never fatal: the page degrades. */
function loadOptionalJson(url) {
  return fetch(url, { cache: 'no-cache' })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (doc) { return (doc && typeof doc === 'object') ? doc : null; })
    .catch(function () { return null; });
}

function renderHeaderMeta(doc) {
  var g = $('generated-at');
  if (g) { g.textContent = fmtGeneratedAt(doc.generated_at) || UNKNOWN_TEXT; }
  var a = $('as-of');
  if (a) { a.textContent = fmtDate(doc.as_of) || UNKNOWN_TEXT; }
}

/* ========================================================================= */
/*  INDEX PAGE                                                               */
/* ========================================================================= */

function initIndex() {
  var state = {
    doc: null,
    stats: null,
    metadata: null,
    products: [],
    marks: readMarks(),
    showNewBadge: true,
    /* card element registry so a mark change can re-sync every copy of a card */
    markBoxes: {}
  };
  var filters = {
    q: '', cat: '', mode: '', status: '', ev: '', profit: '', signal: '',
    deadline: '', release: '', mark: '', sec: '',
    onlyNew: false, onlyRestock: false, onlyAttention: false, sort: 'deadline'
  };

  /* ------------------------------------------------------------ URL <-> state */
  var URL_KEYS = {
    q: 'q', cat: 'cat', mode: 'mode', status: 'st', ev: 'ev', profit: 'pe',
    signal: 'sig', deadline: 'dl', release: 'rel', mark: 'mark', sec: 'sec',
    sort: 'sort'
  };
  function readUrl() {
    var sp = new URLSearchParams(window.location.search);
    Object.keys(URL_KEYS).forEach(function (k) {
      var v = sp.get(URL_KEYS[k]);
      if (v !== null) { filters[k] = v; }
    });
    filters.onlyNew = sp.get('new') === '1';
    filters.onlyRestock = sp.get('restock') === '1';
    filters.onlyAttention = sp.get('attn') === '1';
    if (['deadline', 'new', 'release', 'price', 'updated'].indexOf(filters.sort) === -1) {
      filters.sort = 'deadline';
    }
    if (filters.sec && !sectionById(filters.sec)) { filters.sec = ''; }
  }
  function writeUrl() {
    var sp = new URLSearchParams();
    Object.keys(URL_KEYS).forEach(function (k) {
      if (filters[k] && !(k === 'sort' && filters[k] === 'deadline')) {
        sp.set(URL_KEYS[k], filters[k]);
      }
    });
    if (filters.onlyNew) { sp.set('new', '1'); }
    if (filters.onlyRestock) { sp.set('restock', '1'); }
    if (filters.onlyAttention) { sp.set('attn', '1'); }
    var qs = sp.toString();
    try {
      window.history.replaceState(null, '',
        window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } catch (e) { /* replaceState can fail on the local file protocol — filtering still works */ }
  }

  /* ------------------------------------------------------------ card builder */

  /**
   * One product card. The same markup is used for the highlight sections and
   * for the dense desktop list — only the parent's CSS grid template differs.
   * The first four fields (商品名 / 状態 / 締切 / 定価) always sit at the top so
   * they are readable without scrolling the card.
   */
  function buildCard(p) {
    var li = el('li', 'card' + (isUnverifiedRow(p) ? ' is-unverified' : ''));
    li.dataset.id = p.product_id;
    var a = el('a', 'card-main');
    a.href = 'product.html?id=' + encodeURIComponent(p.product_id);

    /* 1. 商品名 (+ the caveat that makes 「不明」 comprehensible) */
    var name = el('div', 'c-name');
    name.appendChild(el('span', null, isUnknown(p.product_name) ? UNKNOWN_TEXT : p.product_name));
    if (!isUnknown(p.status_note_ja)) {
      name.appendChild(el('span', 'c-note', String(p.status_note_ja)));
    }
    a.appendChild(name);

    /* 2. 現在状態 (+ flags) */
    var st = el('div', 'c-status');
    st.appendChild(statusBadge(p));
    if (p.is_new === true && state.showNewBadge) {
      st.appendChild(el('span', 'badge badge--flag', '新着'));
    }
    if (p.status !== 'RESTOCKED' && isRestockRow(p)) {
      st.appendChild(el('span', 'badge badge--restock', '再販'));
    }
    if (p.is_attention === true) {
      st.appendChild(el('span', 'badge badge--attention', '注目候補'));
    }
    a.appendChild(st);

    /* 3. 締切 — an unconfirmed acceptance state never gets the urgency colour */
    var dText = null;
    if (!isUnknown(p.deadline)) {
      var kind = lbl(DEADLINE_KIND_LABEL, p.deadline_kind);
      dText = fmtDate(p.deadline) + (kind && kind !== UNKNOWN_ENUM_TEXT ? '（' + kind + '）' : '');
    }
    var dCell = cell('c-deadline', '締切', dText);
    if (dText !== null) {
      var rel = deadlineRelText(p);
      if (rel) {
        dCell.appendChild(el('span', 'deadline-rel' +
          (isClosingSoonRow(p) ? '' : ' is-unconfirmed'), rel));
      }
      if (isClosingSoonRow(p)) {
        dCell.classList.add(p.closing_soon_band === 'WITHIN_24H' ? 'is-urgent' : 'is-soon');
      }
    }
    a.appendChild(dCell);

    /* 4. 定価 — the published list price. NOT an acquisition price. */
    a.appendChild(cell('c-list-price', '定価', fmtPrice(listPriceOf(p))));

    /* 5. 取得原価 — only when a route price provenance record exists. */
    a.appendChild(cell('c-acq', '取得原価', fmtPrice(acquisitionCostOf(p)), UNVERIFIED_COST_TEXT));

    /* 6. 発売日 — precision honest */
    a.appendChild(cell('c-release', '発売日', releaseText(p)));

    /* 7. 販売方式 */
    a.appendChild(cell('c-mode', '販売方式', lbl(SALE_MODE_LABEL, p.sale_mode)));

    /* 8. 購入先 */
    a.appendChild(cell('c-channel', '購入先',
      (Array.isArray(p.channel) && p.channel.length) ? p.channel.join('・') : null));

    /* 9. 注目理由 (opportunity signals — not a score) */
    var sigBox = el('div', 'c-signals');
    var chips = signalChips(p, 3);
    if (chips) {
      sigBox.appendChild(chips);
      /* Visible, not hover-only: a truncated chip must announce where its full text is. */
      sigBox.appendChild(el('span', 'c-signals-more', '注目理由の全文は詳細ページ'));
    }
    a.appendChild(sigBox);

    /* 10. 確認状況 */
    var ev = el('div', 'c-ev');
    ev.appendChild(evidenceBadge(p));
    a.appendChild(ev);

    /* 11. 確認の進み方 (neutral ladder) */
    var pe = el('div', 'c-profit');
    pe.appendChild(profitLadder(p, true));
    a.appendChild(pe);

    /* 12. 注目候補の理由 — build-provided only */
    var reasons = attentionReasonsOf(p);
    if (reasons.length) {
      var attn = el('div', 'c-attn');
      attn.appendChild(el('span', 'c-attn-lbl', '注目候補の理由'));
      attn.appendChild(el('span', 'c-attn-val', reasons.join('／')));
      a.appendChild(attn);
    }

    li.appendChild(a);

    /* Human decision marks — outside the anchor so the buttons are real buttons */
    var box = markControl(p.product_id, getMark(state.marks, p.product_id), onMarkPick);
    li.appendChild(box);
    if (!state.markBoxes[p.product_id]) { state.markBoxes[p.product_id] = []; }
    state.markBoxes[p.product_id].push(box);
    return li;
  }
  function onMarkPick(markId, box) {
    var li = box.closest('.card');
    if (!li) { return; }
    var id = li.dataset.id;
    if (markId === 'UNDECIDED') { delete state.marks[id]; }
    else { state.marks[id] = markId; }
    writeMarks(state.marks);
    (state.markBoxes[id] || []).forEach(function (b) { syncMarkButtons(b, markId); });
    /* Re-filter only when the mark filter is active, so the list stays stable. */
    if (filters.mark) { renderList(); }
  }

  /* ----------------------------------------------------------------- filters */

  /** Concatenated lower-cased haystack for the free-text search. */
  function haystack(p) {
    if (p.__hay) { return p.__hay; }
    var parts = [p.product_name, p.ip, p.category, own(CATEGORY_LABEL, p.category),
      p.category_raw, p.sale_mode, own(SALE_MODE_LABEL, p.sale_mode), p.sale_mode_raw];
    if (Array.isArray(p.channel)) { parts = parts.concat(p.channel); }
    signalsOf(p).forEach(function (s) { parts.push(s.label_ja); });
    p.__hay = parts.filter(function (x) { return !isUnknown(x); })
      .join(' ').toLowerCase().replace(/\s+/g, ' ');
    return p.__hay;
  }
  function matchesQuery(p, q) {
    if (!q) { return true; }
    var hay = haystack(p);
    /* whitespace tolerant: every token must appear somewhere */
    return q.split(/\s+/).every(function (t) { return t === '' || hay.indexOf(t) !== -1; });
  }

  /**
   * Deadline filter. `closing_soon_band` is authoritative and there is NO
   * days_to_deadline fallback: a row the status engine left without a band is
   * not 締切間近, and its own bucket is `near_unconfirmed`.
   */
  function matchesDeadline(p, band) {
    if (!band) { return true; }
    if (band === 'near_unconfirmed') { return isNearTermUnconfirmed(p); }
    var limit = band === '24h' ? 1 : (band === '3d' ? 3 : 7);
    if (!isClosingSoonRow(p)) { return false; }
    return own(BAND_DAYS, p.closing_soon_band) <= limit;
  }

  /**
   * Release filter. Day precision compares the date to as_of. Month precision
   * is classified only when the whole month is unambiguously before or after
   * the as_of month; a same-month or unknown value matches NEITHER bucket
   * rather than being guessed into one.
   */
  function matchesRelease(p, want) {
    if (!want) { return true; }
    var asOf = state.doc && state.doc.as_of ? String(state.doc.as_of) : null;
    if (!asOf) { return false; }
    if (p.release_date_precision === 'day' && !isUnknown(p.release_date)) {
      var past = String(p.release_date) <= asOf;  /* 発売日当日は発売済み扱い */
      return want === 'released' ? past : !past;
    }
    if (p.release_date_precision === 'month' && !isUnknown(p.release_date_display)) {
      var m = /(\d{4})年\s*(\d{1,2})月/.exec(String(p.release_date_display));
      if (!m) { return false; }
      var ym = m[1] + '-' + ('0' + m[2]).slice(-2);
      var asOfYm = asOf.slice(0, 7);
      if (ym === asOfYm) { return false; }        /* ambiguous — excluded */
      return want === 'released' ? (ym < asOfYm) : (ym > asOfYm);
    }
    return false;
  }
  function matchesMark(p) {
    if (!filters.mark) { return true; }
    return getMark(state.marks, p.product_id) === filters.mark;
  }
  function matchesSignal(p) {
    if (!filters.signal) { return true; }
    return signalsOf(p).some(function (s) { return s.code === filters.signal; });
  }
  function applyFilters() {
    var q = filters.q.trim().toLowerCase().replace(/\s+/g, ' ');
    var sec = filters.sec ? sectionById(filters.sec) : null;
    return state.products.filter(function (p) {
      /* The section filter reuses the section's OWN predicate, so 「すべて見る」
         can never show a different set than the section it came from. */
      if (sec && !sec.pick(p)) { return false; }
      if (filters.cat && p.category !== filters.cat) { return false; }
      if (filters.mode && p.sale_mode !== filters.mode) { return false; }
      if (filters.status) {
        if (filters.status === GROUP_OPEN) {
          if (!isOpenStatus(p)) { return false; }
        } else if (p.status !== filters.status) { return false; }
      }
      if (filters.ev && p.evidence_state !== filters.ev) { return false; }
      if (filters.profit && p.profit_evidence_status !== filters.profit) { return false; }
      if (!matchesSignal(p)) { return false; }
      if (!matchesDeadline(p, filters.deadline)) { return false; }
      if (!matchesRelease(p, filters.release)) { return false; }
      if (filters.onlyNew && p.is_new !== true) { return false; }
      if (filters.onlyRestock && !isRestockRow(p)) { return false; }
      if (filters.onlyAttention && p.is_attention !== true) { return false; }
      if (!matchesMark(p)) { return false; }
      if (!matchesQuery(p, q)) { return false; }
      return true;
    });
  }

  /* -------------------------------------------------------------------- sort
     Nulls always sort last. A null is never treated as 0 and never as a date. */

  /** Comparator factory: rank(null last) then the per-mode ordering. */
  function cmpNullsLast(keyFn, dir) {
    return function (a, b) {
      var ka = keyFn(a), kb = keyFn(b);
      var na = (ka === null || ka === undefined), nb = (kb === null || kb === undefined);
      if (na && nb) { return a.product_id < b.product_id ? -1 : 1; }
      if (na) { return 1; }
      if (nb) { return -1; }
      if (ka < kb) { return -dir; }
      if (ka > kb) { return dir; }
      return a.product_id < b.product_id ? -1 : 1;
    };
  }

  /**
   * 締切が近い順: upcoming deadlines ascending first, then already-passed
   * deadlines (most recent first), then rows with no deadline at all.
   */
  function cmpDeadline(a, b) {
    function rank(p) {
      var d = num(p.days_to_deadline);
      if (d === null) { return 2; }
      return d >= 0 ? 0 : 1;
    }
    var ra = rank(a), rb = rank(b);
    if (ra !== rb) { return ra - rb; }
    if (ra === 2) { return a.product_id < b.product_id ? -1 : 1; }
    if (ra === 0) {
      if (a.days_to_deadline !== b.days_to_deadline) { return a.days_to_deadline - b.days_to_deadline; }
    } else {
      if (a.days_to_deadline !== b.days_to_deadline) { return b.days_to_deadline - a.days_to_deadline; }
    }
    return a.product_id < b.product_id ? -1 : 1;
  }

  /**
   * Sort key for 発売日順. Month precision sorts at that month (YYYY-MM-00) so
   * it lands before any day in the same month. This key is used for ORDERING
   * ONLY — it is never rendered, so no day is ever invented for display.
   */
  function releaseSortKey(p) {
    if (p.release_date_precision === 'day' && !isUnknown(p.release_date)) {
      return String(p.release_date);
    }
    if (!isUnknown(p.release_date_display)) {
      var m = /(\d{4})年\s*(\d{1,2})月/.exec(String(p.release_date_display));
      if (m) { return m[1] + '-' + ('0' + m[2]).slice(-2) + '-00'; }
    }
    return null;
  }
  function sortRows(rows) {
    var copy = rows.slice();
    switch (filters.sort) {
      case 'new': copy.sort(byFirstSeenDesc); break;
      case 'release': copy.sort(cmpNullsLast(releaseSortKey, 1)); break;
      case 'price':
        /* 定価 only. An acquisition cost is never used as a sort key. */
        copy.sort(cmpNullsLast(function (p) { return listPriceOf(p); }, 1));
        break;
      case 'updated': copy.sort(byUpdatedDesc); break;
      default:
        copy.sort(cmpDeadline);
    }
    return copy;
  }

  /* ------------------------------------------------------------- KPI + select
     Every KPI is taken from stats.json when it is available; the local fallback
     uses the IDENTICAL predicate the build uses, so the two can never drift. */

  function statNum() {
    var path = Array.prototype.slice.call(arguments);
    var node = state.stats;
    for (var i = 0; i < path.length; i++) {
      if (!node || typeof node !== 'object') { return null; }
      node = node[path[i]];
    }
    return num(node);
  }
  function derived(fn) { return state.products.filter(fn).length; }
  /* First non-null wins: a published counter beats a derived one. */
  function pick() {
    for (var i = 0; i < arguments.length; i++) {
      if (arguments[i] !== null && arguments[i] !== undefined) { return arguments[i]; }
    }
    return 0;
  }

  function renderKpis() {
    var total = pick(statNum('counts', 'total'), state.products.length);
    /* 受付中 = status OPEN_NOW or CLOSING_SOON — exactly the GROUP_OPEN filter. */
    var openStat = statNum('by_status', 'OPEN_NOW');
    var closingStat = statNum('by_status', 'CLOSING_SOON');
    /* Read the published counter rather than adding two of them here: a UI-side sum is
       exactly how the rendered KPI and stats.json drifted apart before. */
    var open = pick(statNum('counts', 'accepting_now'),
      (openStat === null || closingStat === null) ? null : (openStat + closingStat),
      derived(isOpenStatus));
    /* 締切間近 = a non-null closing_soon_band, which the build only assigns to
       an OPEN_NOW / CLOSING_SOON row. stats keeps it as three band counters. */
    var b24 = statNum('counts', 'closing_soon_24h');
    var b3 = statNum('counts', 'closing_soon_3d');
    var b7 = statNum('counts', 'closing_soon_7d');
    var closing = (b24 === null || b3 === null || b7 === null)
      ? derived(isClosingSoonRow) : (b24 + b3 + b7);
    var newCount = pick(statNum('counts', 'new_items'),
      derived(function (p) { return p.is_new === true; }));
    $('kpi-total').textContent = String(total);
    $('kpi-open').textContent = String(open);
    $('kpi-closing').textContent = String(closing);
    $('kpi-new').textContent = String(newCount);
    syncKpiPressed();
  }

  /** The collection-window caveat behind 新着, straight from metadata when present. */
  function renderKpiNote() {
    var notes = state.metadata && Array.isArray(state.metadata.data_notes)
      ? state.metadata.data_notes : [];
    var hit = null;
    notes.forEach(function (n) {
      if (n && n.field === 'is_new' && !isUnknown(n.note)) { hit = n; }
    });
    if (!hit) { return; }
    var span = $('sec-new-note');
    if (span) { span.textContent = String(hit.note); }
    var kpiNote = $('kpi-note');
    if (kpiNote) {
      kpiNote.textContent = String(hit.note) +
        '「締切間近」は受付中と確認できた行の締切だけを数えます。';
    }
  }

  function syncKpiPressed() {
    var noFilter = !filters.q && !filters.cat && !filters.mode && !filters.status &&
      !filters.ev && !filters.profit && !filters.signal && !filters.deadline &&
      !filters.release && !filters.mark && !filters.sec &&
      !filters.onlyNew && !filters.onlyRestock && !filters.onlyAttention;
    var pressed = {
      total: noFilter,
      open: filters.status === GROUP_OPEN,
      closing: filters.deadline === '7d',
      new: filters.onlyNew
    };
    var btns = document.querySelectorAll('.kpi');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(!!pressed[btns[i].dataset.kpi]));
    }
  }

  /** Populate a select from the values actually present in the data. */
  function fillSelect(selectEl, values, labelFor) {
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v;
      o.textContent = labelFor(v);
      selectEl.appendChild(o);
    });
  }
  function buildSelects() {
    var cats = [], modes = [], statuses = [], statusLabels = {}, signals = [], sigLabels = {};
    state.products.forEach(function (p) {
      if (!isUnknown(p.category) && cats.indexOf(p.category) === -1) { cats.push(p.category); }
      if (!isUnknown(p.sale_mode) && modes.indexOf(p.sale_mode) === -1) { modes.push(p.sale_mode); }
      if (!isUnknown(p.status) && statuses.indexOf(p.status) === -1) {
        statuses.push(p.status);
        statusLabels[p.status] = isUnknown(p.status_label_ja) ? UNKNOWN_ENUM_TEXT : p.status_label_ja;
      }
      signalsOf(p).forEach(function (s) {
        if (isUnknown(s.code) || signals.indexOf(s.code) !== -1) { return; }
        var text = signalText(s);
        if (text === null) { return; }
        signals.push(s.code);
        sigLabels[s.code] = text;
      });
    });
    /* Order each select by the declared enum order; unknown tokens go last. */
    function byOrder(order) {
      return function (a, b) {
        var ka = order.indexOf(a), kb = order.indexOf(b);
        return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
      };
    }
    cats.sort(byOrder(Object.keys(CATEGORY_LABEL)));
    modes.sort(byOrder(Object.keys(SALE_MODE_LABEL)));
    statuses.sort(byOrder(STATUS_ORDER));
    signals.sort(byOrder(Object.keys(SIGNAL_LABEL)));
    fillSelect($('f-cat'), cats, function (v) { return lbl(CATEGORY_LABEL, v); });
    fillSelect($('f-mode'), modes, function (v) { return lbl(SALE_MODE_LABEL, v); });
    var statusSel = $('f-status');
    var grp = document.createElement('option');
    grp.value = GROUP_OPEN;
    grp.textContent = '受付中（抽選・予約）';
    statusSel.appendChild(grp);
    fillSelect(statusSel, statuses, function (v) { return statusLabels[v] || UNKNOWN_ENUM_TEXT; });
    fillSelect($('f-signal'), signals, function (v) { return sigLabels[v]; });
  }

  /* ----------------------------------------------------------- section render */
  var byFirstSeenDesc = cmpNullsLast(function (p) {
    return isUnknown(p.first_seen_at) ? null : String(p.first_seen_at);
  }, -1);
  var byUpdatedDesc = cmpNullsLast(function (p) {
    return isUnknown(p.updated_at) ? null : String(p.updated_at);
  }, -1);

  var SECTIONS = [
    { id: 'sec-closing', name: '締切間近', sort: cmpDeadline, pick: isClosingSoonRow },
    { id: 'sec-nearterm', name: '期日が近い（受付状態は未確認）', sort: cmpDeadline,
      pick: isNearTermUnconfirmed },
    { id: 'sec-lottery', name: '抽選受付中', sort: cmpDeadline,
      pick: function (p) { return p.sale_mode === 'LOTTERY' && isOpenStatus(p); } },
    { id: 'sec-preorder', name: '予約受付中', sort: cmpDeadline,
      pick: function (p) {
        return (p.sale_mode === 'PREORDER' || p.sale_mode === 'MADE_TO_ORDER') && isOpenStatus(p);
      } },
    { id: 'sec-buyable', name: '購入可能', sort: cmpDeadline, pick: isBuyableRow },
    /* Restocked is the STATUS the engine declared, which is what stats.restocked
       counts. A row that merely carries a 再販 fact wears the 再販 badge and is
       reachable through the 「再販情報あり」 filter, but it is not claimed to be
       back in stock right now. */
    { id: 'sec-restock', name: '再販・在庫復活', sort: byUpdatedDesc,
      pick: function (p) { return p.status === 'RESTOCKED'; } },
    { id: 'sec-new', name: '新着（14日以内）', sort: byFirstSeenDesc,
      pick: function (p) { return p.is_new === true; } },
    { id: 'sec-attention', name: '注目候補', sort: cmpDeadline,
      pick: function (p) { return p.is_attention === true; } }
  ];
  function sectionById(id) {
    for (var i = 0; i < SECTIONS.length; i++) {
      if (SECTIONS[i].id === id) { return SECTIONS[i]; }
    }
    return null;
  }

  /**
   * Every section is capped at SECTION_CAP and sorted by its own sort. An empty
   * section stays VISIBLE and shows its own explicit reason — a mandated
   * section that silently disappears hides the fact that nothing qualified.
   */
  function renderSections() {
    SECTIONS.forEach(function (sec) {
      var root = $(sec.id);
      if (!root) { return; }
      var rows = state.products.filter(sec.pick).sort(sec.sort);
      var list = root.querySelector('[data-sec-list]');
      var count = root.querySelector('[data-sec-count]');
      var emptyNode = root.querySelector('[data-sec-empty]');
      var moreBtn = root.querySelector('[data-sec-more]');
      list.textContent = '';
      if (count) { count.textContent = rows.length === 0 ? '0件' : ('全' + rows.length + '件'); }
      if (emptyNode) { emptyNode.hidden = rows.length !== 0; }
      if (moreBtn) {
        moreBtn.hidden = rows.length <= SECTION_CAP;
        moreBtn.textContent = 'すべて見る（' + rows.length + '件）';
      }
      if (rows.length === 0) { return; }
      var shown = rows.slice(0, SECTION_CAP);
      var frag = document.createDocumentFragment();
      shown.forEach(function (p) { frag.appendChild(buildCard(p)); });
      list.appendChild(frag);
      if (rows.length > SECTION_CAP && count) {
        count.textContent = '全' + rows.length + '件中 ' + shown.length + '件を表示';
      }
    });
  }

  function wireSectionMoreButtons() {
    SECTIONS.forEach(function (sec) {
      var root = $(sec.id);
      if (!root) { return; }
      var btn = root.querySelector('[data-sec-more]');
      if (!btn) { return; }
      btn.addEventListener('click', function () {
        clearFilters();
        filters.sec = sec.id;
        syncControlsFromFilters();
        writeUrl();
        renderList();
        var target = $('sec-all');
        if (target) { target.scrollIntoView({ block: 'start' }); }
      });
    });
  }

  function renderActiveSection() {
    var box = $('active-sec');
    if (!box) { return; }
    var sec = filters.sec ? sectionById(filters.sec) : null;
    box.hidden = !sec;
    $('active-sec-name').textContent = sec ? sec.name : '';
  }

  /* -------------------------------------------------------------- list render */
  function renderList() {
    var rows = sortRows(applyFilters());
    var list = $('list');
    var head = $('list-head');
    var empty = $('list-empty');
    list.textContent = '';
    $('result-count').textContent = '該当 ' + rows.length + ' 件';
    empty.hidden = rows.length !== 0;
    head.hidden = rows.length === 0;
    var frag = document.createDocumentFragment();
    rows.forEach(function (p) { frag.appendChild(buildCard(p)); });
    list.appendChild(frag);
    /* Re-index every card now in the document (sections + this list). */
    rebuildMarkRegistry();
    renderActiveSection();
    syncKpiPressed();
  }

  /** Rebuild the mark-box registry from the cards currently in the document. */
  function rebuildMarkRegistry() {
    state.markBoxes = {};
    var boxes = document.querySelectorAll('.card .card-marks');
    for (var i = 0; i < boxes.length; i++) {
      var card = boxes[i].closest('.card');
      if (!card) { continue; }
      var id = card.dataset.id;
      if (!state.markBoxes[id]) { state.markBoxes[id] = []; }
      state.markBoxes[id].push(boxes[i]);
    }
  }

  /* ---------------------------------------------------------------- controls */
  function syncControlsFromFilters() {
    $('f-q').value = filters.q;
    $('f-cat').value = filters.cat;
    $('f-mode').value = filters.mode;
    $('f-status').value = filters.status;
    $('f-ev').value = filters.ev;
    $('f-profit').value = filters.profit;
    $('f-signal').value = filters.signal;
    $('f-deadline').value = filters.deadline;
    $('f-release').value = filters.release;
    $('f-mark').value = filters.mark;
    $('f-sort').value = filters.sort;
    $('f-new').checked = filters.onlyNew;
    $('f-restock').checked = filters.onlyRestock;
    $('f-attn').checked = filters.onlyAttention;
    /* A value coming from the URL may not be a real option — fall back to すべて. */
    var selects = { 'f-cat': 'cat', 'f-mode': 'mode', 'f-status': 'status', 'f-ev': 'ev',
      'f-profit': 'profit', 'f-signal': 'signal', 'f-deadline': 'deadline',
      'f-release': 'release', 'f-mark': 'mark', 'f-sort': 'sort' };
    Object.keys(selects).forEach(function (id) {
      if ($(id).selectedIndex === -1) { $(id).value = (id === 'f-sort') ? 'deadline' : ''; }
      filters[selects[id]] = $(id).value;
    });
  }
  function onControlChange() {
    filters.q = $('f-q').value;
    filters.cat = $('f-cat').value;
    filters.mode = $('f-mode').value;
    filters.status = $('f-status').value;
    filters.ev = $('f-ev').value;
    filters.profit = $('f-profit').value;
    filters.signal = $('f-signal').value;
    filters.deadline = $('f-deadline').value;
    filters.release = $('f-release').value;
    filters.mark = $('f-mark').value;
    filters.sort = $('f-sort').value;
    filters.onlyNew = $('f-new').checked;
    filters.onlyRestock = $('f-restock').checked;
    filters.onlyAttention = $('f-attn').checked;
    writeUrl();
    renderList();
  }
  /** Reset every filter (sort is intentionally left alone). */
  function clearFilters() {
    filters.q = ''; filters.cat = ''; filters.mode = ''; filters.status = '';
    filters.ev = ''; filters.profit = ''; filters.signal = ''; filters.deadline = '';
    filters.release = ''; filters.mark = ''; filters.sec = '';
    filters.onlyNew = false; filters.onlyRestock = false; filters.onlyAttention = false;
  }

  function wireControls() {
    var form = $('toolbar');
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    ['f-q', 'f-cat', 'f-mode', 'f-status', 'f-ev', 'f-profit', 'f-signal', 'f-deadline',
      'f-release', 'f-mark', 'f-sort', 'f-new', 'f-restock', 'f-attn'].forEach(function (id) {
      var node = $(id);
      node.addEventListener('change', onControlChange);
      if (node.tagName === 'INPUT' && node.type === 'search') {
        node.addEventListener('input', onControlChange);
      }
    });
    $('btn-reset').addEventListener('click', function () {
      clearFilters();
      filters.sort = 'deadline';
      syncControlsFromFilters(); writeUrl(); renderList();
    });
    $('active-sec-clear').addEventListener('click', function () {
      filters.sec = '';
      writeUrl(); renderList();
    });

    /* KPI tiles act as one-tap filters into the full list. Each one maps to the
       same predicate the KPI counts, so the number and the list always agree. */
    var kpis = document.querySelectorAll('.kpi');
    for (var i = 0; i < kpis.length; i++) {
      kpis[i].addEventListener('click', function (e) {
        var kind = e.currentTarget.dataset.kpi;
        clearFilters();
        if (kind === 'open') { filters.status = GROUP_OPEN; }
        else if (kind === 'closing') { filters.deadline = '7d'; }
        else if (kind === 'new') { filters.onlyNew = true; }
        syncControlsFromFilters(); writeUrl(); renderList();
        var target = $('sec-all');
        if (target) { target.scrollIntoView({ block: 'start' }); }
      });
    }
  }

  /* -------------------------------------------------------------------- boot */
  loadProducts().then(function (doc) {
    state.doc = doc;
    state.products = doc.products;
    /* A flag that is true for (almost) everything carries no information. */
    var newShare = state.products.length
      ? state.products.filter(function (p) { return p.is_new === true; }).length / state.products.length
      : 0;
    state.showNewBadge = newShare < NEW_BADGE_MAX_SHARE;
    return Promise.all([loadOptionalJson(DATA_STATS), loadOptionalJson(DATA_METADATA)])
      .then(function (side) {
        state.stats = side[0];
        state.metadata = side[1];
        renderHeaderMeta(doc);
        renderKpis();
        renderKpiNote();
        buildSelects();
        readUrl();
        syncControlsFromFilters();
        wireControls();
        wireSectionMoreButtons();
        renderSections();
        renderList();
        if (!marksAvailable) {
          var note = document.querySelector('#sec-all .note-line');
          if (note) {
            note.textContent = 'このブラウザでは保存領域が使えないため、判断マークは保持されません。';
          }
        }
        $('loading').hidden = true;
        $('app').hidden = false;
      });
  }).catch(function (err) {
    showError(err && err.message ? err.message : 'データの読み込み中に不明なエラーが発生しました。');
  });
}

/* ========================================================================= */
/*  PRODUCT DETAIL PAGE                                                      */
/* ========================================================================= */

function initProduct() {
  var marks = readMarks();

  /** Definition-list row. `valueNode` overrides the plain-text rendering. */
  function row(dl, label, value, valueNode, unknownText) {
    var wrap = document.createElement('div');
    wrap.appendChild(el('dt', null, label));
    var dd;
    if (valueNode) { dd = el('dd'); dd.appendChild(valueNode); }
    else if (isUnknown(value)) { dd = el('dd', 'is-unknown', unknownText || UNKNOWN_TEXT); }
    else { dd = el('dd', null, value); }
    wrap.appendChild(dd);
    dl.appendChild(wrap);
  }

  /** External link node with the hostname shown, or null when unusable. */
  function linkNode(url, label) {
    if (!isSafeHttpUrl(url)) { return null; }
    var span = el('span', 'ext-link');
    var a = el('a', null, label);
    a.href = String(url);              /* data-driven anchor, validated above */
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    span.appendChild(a);
    var host = hostOf(url);
    if (host) { span.appendChild(el('span', 'ext-host', '(' + host + ')')); }
    return span;
  }
  function group(title, spanFull) {
    var g = el('section', 'dl-group' + (spanFull ? ' dl-span' : ''));
    g.appendChild(el('h2', null, title));
    var dl = el('dl', 'kv');
    g.appendChild(dl);
    return { node: g, dl: dl };
  }

  /** A price the reader can act on, with its meaning spelled out. */
  function pricePair(p) {
    var box = el('div', 'price-pair');
    var listPrice = fmtPrice(listPriceOf(p));
    var acq = fmtPrice(acquisitionCostOf(p));
    [[isUnknown(p.list_price_label_ja) ? '定価' : String(p.list_price_label_ja),
      listPrice, UNKNOWN_TEXT],
      ['取得原価', acq, UNVERIFIED_COST_TEXT]].forEach(function (pair) {
      var item = el('div', 'price-item');
      item.appendChild(el('span', 'price-lbl', pair[0]));
      item.appendChild(el('span', 'price-val' + (pair[1] === null ? ' is-unknown' : ''),
        pair[1] === null ? pair[2] : pair[1]));
      box.appendChild(item);
    });
    return box;
  }

  function horizonText(v) {
    if (isUnknown(v)) { return null; }
    var m = /^P?(\d+)D?$/i.exec(String(v));
    if (m) { return '直近' + Number(m[1]) + '日'; }
    return lbl({}, v);
  }

  /** 供給制約: the signals, each with its basis in plain Japanese. */
  function buildSignalsBlock(p) {
    var g = group('供給制約', true);
    var sigs = signalsOf(p);
    if (sigs.length === 0) {
      row(g.dl, '注目理由', null, null, '注目理由は未確定');
      return g.node;
    }
    var ul = el('ul', 'sig-list');
    var rendered = 0;
    sigs.forEach(function (s) {
      var text = signalText(s);
      if (text === null) { return; }
      var li = el('li');
      li.appendChild(el('span', 'sig-name' + (s.code === 'UNKNOWN' ? ' is-unknown' : ''), text));
      if (!isUnknown(s.basis_ja)) {
        li.appendChild(el('span', 'sig-basis', String(s.basis_ja)));
      }
      ul.appendChild(li);
      rendered++;
    });
    if (rendered === 0) { row(g.dl, '注目理由', null, null, '注目理由は未確定'); return g.node; }
    row(g.dl, '注目理由', null, ul);
    if (p.is_attention === true) {
      var reasons = attentionReasonsOf(p);
      row(g.dl, '注目候補', reasons.length ? reasons.join('／') : null);
      row(g.dl, '注目候補の意味', null,
        el('span', 'plain-note',
          '裏付けのある材料がそろっているという印です。おすすめ・買い・期待値ではありません。' +
          '買うかどうかの判断は読者が行います。'));
    }
    return g.node;
  }

  /** 過去の成約Evidence: the ladder, its counters, and a DIFFERENT product's prices. */
  function buildProfitBlock(p) {
    var g = group('過去の成約Evidence', true);
    row(g.dl, '確認の進み方', null, profitLadder(p, true));
    row(g.dl, '注記', null, el('span', 'plain-note', PROFIT_NOTE_JA));
    var d = (p.profit_evidence_detail && typeof p.profit_evidence_detail === 'object')
      ? p.profit_evidence_detail : null;
    if (d) {
      PROFIT_DETAIL_ORDER.forEach(function (k) {
        if (!(k in d)) { return; }
        row(g.dl, PROFIT_DETAIL_LABEL[k], fmtCount(d[k]));
      });
    }
    var refs = Array.isArray(p.historical_price_evidence) ? p.historical_price_evidence : [];
    refs = refs.filter(function (r) { return r && typeof r === 'object'; });
    if (refs.length === 0) {
      row(g.dl, '過去の実売価格', null, null, '比較できる記録は未確認');
      return g.node;
    }
    var box = el('div', 'cmp-box');
    box.appendChild(el('p', 'warn-inline',
      '以下はこの商品の価格ではありません。比較のために選んだ' +
      '別の商品について、過去に観測された再販価格の記録です。' +
      'この商品の利益や想定価格を示すものではありません。'));
    refs.forEach(function (r) {
      var item = el('div', 'cmp-item');
      item.appendChild(el('div', 'cmp-name',
        isUnknown(r.comparable_name) ? '比較対象名は' + UNKNOWN_TEXT : String(r.comparable_name)));
      var dl = el('dl', 'kv kv--tight');
      row(dl, '集計期間', isUnknown(r.horizon_label_ja) ? horizonText(r.horizon) : String(r.horizon_label_ja));
      row(dl, '標本件数', fmtCount(r.sample_count));
      row(dl, '標本の区分', lblOf(r, 'sample_status_label_ja', PRICE_SAMPLE_STATUS_LABEL, 'sample_status'));
      row(dl, '中央値', fmtPrice(r.median_price_jpy));
      row(dl, '最小', fmtPrice(r.minimum_price_jpy));
      row(dl, '最大', fmtPrice(r.maximum_price_jpy));
      item.appendChild(dl);
      box.appendChild(item);
    });
    row(g.dl, '別商品（比較対象）の過去の実売価格', null, box);
    return g.node;
  }

  /** 取得経路の状況: a SHADOW model, never connected to a profit calculation. */
  function buildRouteBlock(p) {
    var g = group('別商品（比較対象）の取得経路（参考）', true);
    var re = (p.route_evidence && typeof p.route_evidence === 'object') ? p.route_evidence : null;
    if (!re) {
      row(g.dl, '経路情報', null, null, '経路情報は未確認');
      return g.node;
    }
    row(g.dl, '読み方', null, el('span', 'warn-inline',
      'ここに出る経路と金額は、この商品のものではありません。参照した別商品（比較対象）で' +
      '確認された取得経路です。この商品の取得原価としては使えません。'));
    if (re.shadow_only !== false) {
      row(g.dl, '取り扱い', null, el('span', 'warn-inline',
        'さらにこれは試算用の影データ（shadow）で、公開されている利益計算には一切' +
        'つながっていません。参考情報としてのみ扱ってください。'));
    }
    row(g.dl, '経路の確認状況', lbl(ROUTE_STATUS_LABEL, re.status));
    var routes = Array.isArray(re.routes) ? re.routes.filter(function (r) {
      return r && typeof r === 'object';
    }) : [];
    if (routes.length === 0) {
      row(g.dl, '経路', null, null, '経路の記録なし');
      return g.node;
    }
    /* Grouped by how each row was established. 「当時利用できた経路」 and
       「出品者が申告した経路」 are different claims and are never merged. */
    var used = [];
    ROUTE_GROUPS.forEach(function (grp) {
      var rows = routes.filter(function (r) { return r.evidence_status === grp.status; });
      rows.forEach(function (r) { used.push(r); });
      if (rows.length === 0) { return; }
      row(g.dl, grp.title, null, routeList(rows));
    });
    var rest = routes.filter(function (r) { return used.indexOf(r) === -1; });
    if (rest.length) { row(g.dl, ROUTE_GROUP_OTHER, null, routeList(rest)); }
    return g.node;
  }

  function routeList(rows) {
    var box = el('div', 'route-box');
    rows.forEach(function (r) {
      var item = el('div', 'route-item');
      /* A route belongs to a COMPARABLE product, not to the product on this page. Naming it
         first is a correctness requirement: without it a 240 yen pack appears to have a
         5,280 yen acquisition route of its own. */
      var cname = isUnknown(r.comparable_name) ? null : String(r.comparable_name);
      item.appendChild(el('div', 'route-owner',
        cname ? ('対象商品（別商品）: ' + cname) : '対象商品（別商品）: 名称不明'));
      item.appendChild(el('div', 'route-head',
        lblOf(r, 'route_class_label_ja', ROUTE_CLASS_LABEL, 'route_class') || UNKNOWN_ENUM_TEXT));
      var dl = el('dl', 'kv kv--tight');
      row(dl, '販売店', r.retailer);
      row(dl, '購入方法', r.purchase_mechanism);
      var from = fmtDate(r.available_from), until = fmtDate(r.available_until);
      row(dl, '入手できた期間',
        (from || until) ? ((from || UNKNOWN_TEXT) + ' 〜 ' + (until || UNKNOWN_TEXT)) : null);
      /* Never substitute the list price here. A claim printed on the source page and an
         amount backed by a provenance record are two different things, so they get
         two rows and the claim is always named as a claim. */
      row(dl, '取得価格（確認済み）', fmtPrice(num(r.acquisition_price_jpy)), null, '未確認');
      var claim = num(r.acquisition_price_claim_jpy);
      if (claim !== null) {
        row(dl, '取得価格（出典の記載値）', fmtPrice(claim) + '（未検証の記載。確認済みの取得原価ではありません）');
      }
      row(dl, '送料', fmtPrice(num(r.acquisition_shipping_jpy)), null, '未確認');
      if (num(r.acquisition_shipping_jpy) !== null && !isUnknown(r.acquisition_shipping_note_ja)) {
        row(dl, '送料の適用範囲', String(r.acquisition_shipping_note_ja));
      }
      row(dl, '確認区分', lblOf(r, 'evidence_status_label_ja', ROUTE_STATUS_LABEL, 'evidence_status'));
      item.appendChild(dl);
      box.appendChild(item);
    });
    return box;
  }

  function render(doc, p) {
    var root = $('detail');
    var unverified = isUnverifiedRow(p);
    var card = el('div', 'detail-card' + (unverified ? ' is-unverified' : ''));
    card.appendChild(el('h1', 'detail-title',
      isUnknown(p.product_name) ? UNKNOWN_TEXT : p.product_name));
    var badges = el('div', 'detail-badges');
    badges.appendChild(statusBadge(p));
    badges.appendChild(evidenceBadge(p));
    if (p.is_new === true) { badges.appendChild(el('span', 'badge badge--flag', '新着')); }
    if (isRestockRow(p)) { badges.appendChild(el('span', 'badge badge--restock', '再販')); }
    if (p.is_attention === true) {
      badges.appendChild(el('span', 'badge badge--attention', '注目候補'));
    }
    card.appendChild(badges);
    if (unverified) {
      card.appendChild(el('div', 'warn-box',
        '未検証の発見候補です。公開情報の一次確認が済んでいないため、確認済みの商品と同等に扱わないでください。'));
    }
    card.appendChild(pricePair(p));
    card.appendChild(el('p', 'price-note',
      '「定価」は公式に公表された価格で、仕入れ価格ではありません。' +
      '「取得原価」は経路ごとの価格の裏付けが取れた場合だけ表示し、取れていなければ「未確認」と書きます。'));
    if (!isUnknown(p.status_note_ja)) {
      card.appendChild(el('p', 'note-box', p.status_note_ja));
    }
    var wrap2 = el('div', 'detail-wrap');

    /* --- 基本情報 --- */
    var g1 = group('基本情報');
    row(g1.dl, '商品名', isUnknown(p.product_name) ? null : p.product_name);
    row(g1.dl, 'カテゴリ', lbl(CATEGORY_LABEL, p.category));
    row(g1.dl, 'ジャンル（原文）', p.category_raw);
    row(g1.dl, 'IP / 作品', p.ip);
    /* Precision-honest: the display string is used verbatim. */
    row(g1.dl, '発売日', releaseText(p));
    wrap2.appendChild(g1.node);

    /* --- 販売情報 --- */
    var g2 = group('販売情報');
    row(g2.dl, isUnknown(p.list_price_label_ja) ? '定価' : String(p.list_price_label_ja),
      fmtPrice(listPriceOf(p)));
    row(g2.dl, '取得原価', fmtPrice(acquisitionCostOf(p)), null, UNVERIFIED_COST_TEXT);
    row(g2.dl, '販売方式', lbl(SALE_MODE_LABEL, p.sale_mode));
    row(g2.dl, '販売方式（原文）', p.sale_mode_raw);
    row(g2.dl, '現在状態', isUnknown(p.status_label_ja) ? null : p.status_label_ja);
    /* v1.1.0 supplies the Japanese label; a raw token is never printed. */
    row(g2.dl, '判定の根拠', isUnknown(p.status_basis_label_ja) ? null : String(p.status_basis_label_ja));
    row(g2.dl, '補足', p.status_note_ja);
    row(g2.dl, '購入先', (Array.isArray(p.channel) && p.channel.length) ? p.channel.join('・') : null);
    row(g2.dl, '再販状況', p.restock_status);
    row(g2.dl, '販売終了', fmtDate(p.sales_end));
    var urlKind = lbl(URL_KIND_LABEL, p.official_url_kind);
    var urlLabel = (urlKind && urlKind !== UNKNOWN_ENUM_TEXT) ? urlKind : '公式ページ';
    row(g2.dl, urlLabel, null, linkNode(p.official_url, urlLabel + 'を開く'));
    row(g2.dl, '購入ページ', null, linkNode(p.purchase_url, '購入ページを開く'));
    wrap2.appendChild(g2.node);

    /* --- 予約・抽選・応募情報 --- */
    var g3 = group('予約・抽選・応募情報');
    var dKind = lbl(DEADLINE_KIND_LABEL, p.deadline_kind);
    var dVal = isUnknown(p.deadline) ? null :
      fmtDate(p.deadline) + (dKind && dKind !== UNKNOWN_ENUM_TEXT ? '（' + dKind + '）' : '') +
      (deadlineRelText(p) ? ' / ' + deadlineRelText(p) : '');
    row(g3.dl, '直近の期日', dVal);
    row(g3.dl, '予約開始', fmtDate(p.reservation_start));
    row(g3.dl, '予約終了', fmtDate(p.reservation_end));
    row(g3.dl, '抽選開始', fmtDate(p.lottery_start));
    row(g3.dl, '抽選終了', fmtDate(p.lottery_end));
    row(g3.dl, '応募開始', fmtDate(p.application_start));
    row(g3.dl, '応募終了', fmtDate(p.application_end));
    row(g3.dl, '結果発表', fmtDate(p.result_date));
    row(g3.dl, '支払期限', fmtDate(p.payment_deadline));
    row(g3.dl, '受取期間', p.pickup_period);
    row(g3.dl, '発送予定', p.shipping_period);
    wrap2.appendChild(g3.node);

    /* --- 購入制限 --- */
    var g4 = group('購入制限');
    row(g4.dl, '購入制限', p.purchase_limit);
    wrap2.appendChild(g4.node);

    /* --- 確認状況 --- */
    var g5 = group('確認状況');
    row(g5.dl, '確認の区分', isUnknown(p.evidence_label_ja) ? null : p.evidence_label_ja);
    row(g5.dl, '検証区分', lbl(TIER_LABEL, p.verification_tier));
    row(g5.dl, '最終確認日', fmtDate(p.last_verified_at));
    row(g5.dl, '初回確認', fmtDate(p.first_seen_at));
    row(g5.dl, '更新日', fmtDate(p.updated_at));
    var refs = Array.isArray(p.source_references) ? p.source_references : [];
    var usable = refs.filter(function (r) { return r && isSafeHttpUrl(r.url); });
    if (usable.length === 0) {
      row(g5.dl, '出典（公開一次情報）', null);
    } else {
      var ul = el('ul', 'src-list');
      usable.forEach(function (r) {
        var li = el('li');
        var node = linkNode(r.url, isUnknown(r.name) ? String(hostOf(r.url) || 'リンク') : String(r.name));
        if (node) { li.appendChild(node); }
        var kind = lbl(URL_KIND_LABEL, r.kind);
        if (kind && kind !== UNKNOWN_ENUM_TEXT) { li.appendChild(el('span', 'src-kind', kind)); }
        ul.appendChild(li);
      });
      row(g5.dl, '出典（公開一次情報）', null, ul);
    }
    wrap2.appendChild(g5.node);

    /* --- 供給制約 / 過去の成約Evidence / 取得経路の状況 --- */
    wrap2.appendChild(buildSignalsBlock(p));
    wrap2.appendChild(buildProfitBlock(p));
    wrap2.appendChild(buildRouteBlock(p));

    /* --- 調査メモ --- */
    var g6 = group('調査メモ', true);
    row(g6.dl, '備考', p.notes_ja);
    wrap2.appendChild(g6.node);

    card.appendChild(wrap2);

    /* --- あなたの判断 (browser only) --- */
    var g7 = el('section', 'dl-group dl-span');
    g7.appendChild(el('h2', null, 'あなたの判断'));
    var current = getMark(marks, p.product_id);
    var box = markControl(p.product_id, current, function (markId, boxEl) {
      if (markId === 'UNDECIDED') { delete marks[p.product_id]; }
      else { marks[p.product_id] = markId; }
      writeMarks(marks);
      syncMarkButtons(boxEl, markId);
      if (!marksAvailable) { noteEl.textContent = 'このブラウザでは保存領域が使えないため、判断マークは保持されません。'; }
    }, 'detail-marks');
    g7.appendChild(box);
    var noteEl = el('p', 'note-line',
      '判断マークはこのブラウザの中だけに保存されます。どこにも送信されません。' +
      'このページは推奨も利益予測も行いません。買うかどうかを決めるのはあなたです。');
    g7.appendChild(noteEl);
    card.appendChild(g7);
    root.appendChild(card);
    root.hidden = false;
  }
  var id = null;
  try { id = new URLSearchParams(window.location.search).get('id'); }
  catch (e) { id = null; }
  loadProducts().then(function (doc) {
    renderHeaderMeta(doc);
    $('loading').hidden = true;
    if (!id) {
      $('notfound-detail').textContent = '商品 ID が指定されていません（例: product.html?id=…）。';
      $('notfound-panel').hidden = false;
      return;
    }
    var found = null;
    for (var i = 0; i < doc.products.length; i++) {
      if (doc.products[i].product_id === id) { found = doc.products[i]; break; }
    }
    if (!found) {
      $('notfound-detail').textContent =
        '指定された商品 ID「' + id + '」はこのデータセットに存在しません。';
      $('notfound-panel').hidden = false;
      return;
    }
    var name = isUnknown(found.product_name) ? UNKNOWN_TEXT : String(found.product_name);
    document.title = name + ' | Sedori Research Dashboard';
    render(doc, found);
  }).catch(function (err) {
    showError(err && err.message ? err.message : 'データの読み込み中に不明なエラーが発生しました。');
  });
}

/* ---------------------------------------------------------------- dispatch */

(function () {
  var page = document.body.getAttribute('data-page');
  if (page === 'index') { initIndex(); }
  else if (page === 'product') { initProduct(); }
})();
