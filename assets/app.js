/* =========================================================================
   Sedori Research Dashboard — app.js   (consumer of CONTRACT.md v1.1.0)
   Shared by index.html (data-page="index") and product.html (data-page="product").

   Rendering rules this file enforces:
     * An unconfirmed value is NOT RENDERED (owner's rule: 未確認の項目は表示しない).
       A null field — or a published string that itself says it is unconfirmed —
       produces no label, no placeholder and no badge. It is never turned into
       0, なし or a guessed date either: hiding is the only allowed outcome.
       The one layout exception is the desktop screener, whose 7 columns keep an
       EMPTY cell so the columns stay aligned.
     * 定価 (list_price_jpy) and 取得原価 (acquisition_cost_jpy) are different
       things. The list price is NEVER shown as an acquisition cost, and an
       unverified acquisition cost is not shown at all — never a substituted number.
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
     * A field the build has not emitted yet is simply not rendered —
       never an exception.
   ========================================================================= */
'use strict';

/* ---------------------------------------------------------------- constants */

var DATA_PRODUCTS = 'data/products.json';
var DATA_STATS = 'data/stats.json';
var DATA_METADATA = 'data/metadata.json';
var MARKS_KEY = 'sedori_dashboard_marks_v1';
/* A published string that itself declares the value unconfirmed (「受付状況は未確認」,
   「…（日付の精度は未確認）」, 「不明」) carries no confirmed value: it is handled exactly
   like null, i.e. not rendered. */
var UNCONFIRMED_WORDING = /未確認|不明/;

/* A highlight section never repeats the whole catalogue: it shows the top N of
   its own sort and hands the rest to 全商品一覧 through「すべて見る」. */
var SECTION_CAP = 12;

/* A flag badge that applies to almost every row carries no information, so the
   per-card 新着 badge is suppressed once its share of the corpus reaches this.
   Threshold, not a hardcode: it disappears while the corpus is freshly seeded
   and comes back by itself once 新着 becomes a minority again. */
var NEW_BADGE_MAX_SHARE = 0.6;

/* Human decision marks (browser only). Order is the button order. */
var MARKS = [{ id: 'UNDECIDED', label: '印なし' }, { id: 'CANDIDATE', label: '購入候補' },
  { id: 'WATCH', label: '様子見' }, { id: 'SKIP', label: '見送り' }];
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
  ONLINE_LOTTERY: 'オンラインくじ', COLLAB: 'コラボ商品', OTHER: 'その他'
};

var SALE_MODE_LABEL = {
  LOTTERY: '抽選', PREORDER: '予約', MADE_TO_ORDER: '受注生産',
  GENERAL_SALE: '一般販売', OFFICIAL_EC: '公式EC', STORE_LIMITED: '店舗限定',
  EC_LIMITED: 'EC限定', RESTOCK: '再販'
};

/* sale_mode_raw values as the source records them. Anything not listed here is not shown. */
var SALE_MODE_RAW_LABEL = {
  retail: '一般販売（店頭・通販）', lottery: '抽選販売', reservation: '予約販売',
  made_to_order: '受注生産', event_venue_sale: 'イベント会場での販売',
  event_or_official_shop: 'イベント会場・公式ショップでの販売',
  retail_with_launch_day_entry_lottery: '一般販売（発売日の入店抽選あり）'
};

/* Same wording as the build's HORIZON_LABEL_JA (the shared post-release day ranges). */
var HORIZON_LABEL = {
  release_market: '発売直後（0〜3日）', d0: '発売直後（0〜3日）', d7: '発売後1週（4〜10日）',
  d30: '発売後1か月（23〜37日）', d90: '発売後3か月（75〜105日）', d180: '発売後半年（159〜201日）',
  long_term: '発売後202日以降', pre_release: '発売前'
};

var DEADLINE_KIND_LABEL = {
  LOTTERY: '抽選締切', RESERVATION: '予約締切', APPLICATION: '応募締切', SALES: '販売終了'
};

var TIER_LABEL = {
  CANONICAL_VERIFIED: '公式情報で確認済み', CANONICAL_PARTIAL: '一部を公式情報で確認',
  DISCOVERY_UNVERIFIED: '未検証（新しく見つかった商品）'
};

var URL_KIND_LABEL = { OFFICIAL: '公式ページ', RETAILER: '販売ページ' };

/* profit_evidence_status — a display ladder, never a verdict. NOT_EVALUATED is
   step 1 ("not started"), styled exactly as neutrally as every other step. */
var PROFIT_LADDER = ['NOT_EVALUATED', 'PARTIAL', 'ROUTE_EVIDENCE_PARTIAL',
  'PRICE_EVIDENCE_READY', 'FORMAL_READY'];
var PROFIT_STEP_LABEL = {
  NOT_EVALUATED: '未評価', PARTIAL: '一部を確認', ROUTE_EVIDENCE_PARTIAL: '購入経路のみ確認',
  PRICE_EVIDENCE_READY: '過去の取引価格を確認', FORMAL_READY: '必要な材料がそろった'
};
var PROFIT_DETAIL_LABEL = {
  linked_comparables: '比べる類似品の数',
  comparables_with_price_evidence: 'うち過去の取引価格を確認できた数',
  comparables_with_verified_route: 'うち購入経路を確認できた数',
  strict_completed_sales: '条件を満たす取引の件数',
  profit_usable_comparables: '利益の試算に使える類似品の数',
  minimum_profit_sample: '試算に必要な件数'
};
var PROFIT_DETAIL_ORDER = ['linked_comparables', 'comparables_with_price_evidence',
  'comparables_with_verified_route', 'strict_completed_sales',
  'profit_usable_comparables', 'minimum_profit_sample'];

var PROFIT_NOTE_JA =
  'ここでは、利益を考えるための材料がどこまで集まったかをお伝えしています。' +
  '利益額や期待値、おすすめや点数を示すものではありません。';

/* opportunity_signals carry their own `label_ja`; this map is only a fallback
   for the closed code set, so a chip is never rendered as a raw token. */
var SIGNAL_LABEL = {
  LOTTERY_ONLY: '抽選のみ', EC_LIMITED: 'EC限定', STORE_LIMITED: '店舗限定',
  PURCHASE_LIMIT: '購入・応募数の条件', MADE_TO_ORDER: '受注生産',
  SHORT_ORDER_WINDOW: '受付期間が短い', RESTOCK: '再販あり', END_OF_SALE: '販売終了が近い',
  HISTORICAL_PRICE_EVIDENCE: '類似品の過去の取引価格あり',
  STRICT_COMPLETED_SALES: '類似品の取引実績あり', SUPPLY_LIMITED: '供給が限られる',
  REPRINT_RISK: '再録・再版の可能性'
};

/* route_evidence — shadow model. Labels only; no raw token ever reaches the DOM. */
var ROUTE_STATUS_LABEL = {
  VERIFIED: '購入経路を公式情報で確認', ENUMERATED_NOT_EVIDENCED: '経路の候補のみ（未検証）',
  SHADOW_UNVERIFIED: '出品者の申告のみ（未検証）'
};
var ROUTE_CLASS_LABEL = {
  STORE_PICKUP: '店頭受取', STORE_PURCHASE: '店頭購入', OFFICIAL_EC: '公式オンラインストア',
  OFFICIAL_EC_LOTTERY: '公式オンラインストアの抽選', RETAILER_EC: '小売店のオンラインストア', OTHER: 'その他の経路'
};
/* Only a route whose availability was verified is rendered. A candidate without
   evidence, a seller's declaration or a route of unknown status is an unconfirmed
   item and is not shown (owner's rule: 未確認の項目は表示しない). */
var ROUTE_SHOWN_STATUS = 'VERIFIED';
var ROUTE_SHOWN_TITLE = '当時利用できた購入経路（公式情報で日付まで確認）';

var PRICE_SAMPLE_STATUS_LABEL = {
  STRICT: '条件を満たす取引のみ', REPRESENTATIVE: '件数は十分', INSUFFICIENT: '件数が少ない',
  PARTIAL: '一部のみ', NOT_EVALUATED: '未評価'
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

/** Display text for a published string, or null when it is absent or declares itself
    unconfirmed. null means: render nothing. */
function shownText(v) {
  if (isUnknown(v)) { return null; }
  var s = String(v);
  return UNCONFIRMED_WORDING.test(s) ? null : s;
}

function $(id) { return document.getElementById(id); }

/** Enum -> Japanese label. An unmapped ALL_CAPS token is never printed raw. */
/** Prefer the label the build published; only then the local map. A label that declares
    itself unconfirmed counts as no label. */
function own(map, key) {
  /* A data value like "constructor" or "toString" resolves to an inherited Object.prototype
     member. Left unguarded that promoted a row into 締切間近 — the page must never declare an
     urgency the status engine refused to declare. Every enum map read goes through here. */
  return (typeof key === 'string' && Object.prototype.hasOwnProperty.call(map, key)) ? map[key] : undefined;
}

function lblOf(obj, labelKey, map, rawKey) {
  var given = obj ? shownText(obj[labelKey]) : null;
  if (given !== null) { return given; }
  return lbl(map, obj ? obj[rawKey] : null);
}

/** Enum -> Japanese label, or null. UNKNOWN and any enum we have no wording for render
    nothing: a raw token is never printed and 「区分が分からない」 is never shown. */
function lbl(map, v) {
  if (isUnknown(v) || v === 'UNKNOWN') { return null; }
  var got = own(map, v);
  if (got !== undefined) { return got; }
  if (/^[A-Z][A-Z0-9_]*$/.test(String(v))) { return null; }
  return shownText(v);
}

/** Minimal element builder. `text` is always applied via textContent. */
function el(tag, className, text) {
  var n = document.createElement(tag);
  if (className) { n.className = className; }
  if (text !== undefined && text !== null) { n.textContent = String(text); }
  return n;
}

/**
 * Text with the pieces that must not be split kept whole: a signed amount (−¥1,487), a count
 * or ratio with its unit (類似品4件, 1.42倍, 13日), and a short bracketed period （75〜105日）.
 * Only text nodes and nowrap spans are created; the textContent is unchanged.
 */
var KEEP_RE = /あと\d+日|\d{4}年\d{1,2}月(?:\d{1,2}日)?|\d{1,2}月\d{1,2}日|(?:中央値|最大|上限|下限)\s?\d+(?:\.\d+)?(?:倍|%)|類似品\d+件|[−-]?[¥￥][\d,]+(?:〜[−-]?[¥￥][\d,]+)?|\d+(?:\.\d+)?(?:倍|件|日|%|か月|週)(?:\s*\/\s*\d+件中)?|（[^（）]{1,16}）|【[^【】]{1,12}】/g;
function keepText(node, text) {
  var str = String(text);
  var last = 0;
  var m;
  KEEP_RE.lastIndex = 0;
  while ((m = KEEP_RE.exec(str)) !== null) {
    if (m.index > last) { node.appendChild(document.createTextNode(str.slice(last, m.index))); }
    node.appendChild(el('span', 'nb', m[0]));
    last = m.index + m[0].length;
  }
  if (last < str.length) { node.appendChild(document.createTextNode(str.slice(last))); }
  return node;
}
function elKeep(tag, className, text) { return keepText(el(tag, className), text); }

/**
 * A title that wraps only between words: word boundaries from Intl.Segmenter become <wbr>, and
 * CSS (.wrap-words: word-break keep-all) stops the browser from breaking inside a word, so a
 * line never starts with 「ー」 or splits 「ブースター」. Without Segmenter the text is left as is.
 */
function wordWrapText(node, text) {
  var str = String(text);
  if (typeof Intl === 'undefined' || typeof Intl.Segmenter !== 'function') {
    node.textContent = str;
    return node;
  }
  var seg = new Intl.Segmenter('ja', { granularity: 'word' });
  var parts = [];
  var it = seg.segment(str);
  var arr = Array.from ? Array.from(it) : [];
  arr.forEach(function (x) { parts.push(x.segment); });
  node.classList.add('wrap-words');
  parts.forEach(function (piece, i) {
    if (i > 0 && !/^[\s）】」』、。・:：,.!?！？ー]/.test(piece) && !/[（【「『\s]$/.test(parts[i - 1])) {
      node.appendChild(document.createElement('wbr'));
    }
    node.appendChild(document.createTextNode(piece));
  });
  return node;
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
  * has not been rebuilt yet simply has no list price, which is then not rendered: the
  * removed v1.0.0 field is never read as a stand-in.
  */
function listPriceOf(p) {
  return num(p.list_price_jpy);
}

/**
 * `acquisition_cost_jpy` (取得原価) — a verified route acquisition price, or null.
 * A number without a VERIFIED status is suppressed: an unproven cost is not shown,
 * and is never replaced by a figure. The list price is never substituted here.
 */
function acquisitionCostOf(p) {
  if (p.acquisition_cost_status !== 'VERIFIED') { return null; }
  return num(p.acquisition_cost_jpy);
}

function signalsOf(p) {
  if (!Array.isArray(p.opportunity_signals)) { return []; }
  return p.opportunity_signals.filter(function (s) { return s && typeof s === 'object'; });
}

/** Chip text for one signal: data label first, closed-set fallback second. The UNKNOWN
    code (「注目理由は未確認」) is not a reason and renders nothing. */
function signalText(s) {
  if (s.code === 'UNKNOWN') { return null; }
  if (shownText(s.label_ja) !== null) { return String(s.label_ja); }
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

/* A restock_status that says the restock information is unconfirmed is not a restock fact:
   it neither earns the 再販 badge nor matches the 再販情報あり filter. */
function isRestockRow(p) {
  return p.status === 'RESTOCKED' || p.sale_mode === 'RESTOCK' || shownText(p.restock_status) !== null;
}

/**
 * 購入可能 = an acceptance state the engine declared open, with a sale mode that
 * is not a lottery. This is the same predicate `stats.counts.buyable_now` uses,
 * so the section can never disagree with the published counter. A row whose sale
 * mode is UNKNOWN is included by that definition (the card simply shows no sale mode)
 * and the section caption says so, rather than the page quietly using a different
 * rule than the data document.
 */
function isBuyableRow(p) {
  return isOpenStatus(p) && p.sale_mode !== 'LOTTERY';
}

/* ------------------------------------------------------------- shared pieces */

/** true when the acceptance state is confirmed and has a label that can be shown. */
function hasShownStatus(p) {
  return !isUnknown(p.status) && p.status !== 'UNKNOWN' && own(STATUS_GROUP, p.status) !== undefined &&
    shownText(p.status_label_ja) !== null;
}

/** Status badge: label text from data, colour from the semantic group. null — no badge at
    all — when the acceptance state is not confirmed. */
function statusBadge(p) {
  if (!hasShownStatus(p)) { return null; }
  var group = own(STATUS_GROUP, p.status);
  /* Within 24h is escalated to the urgent colour — only for a row the status
     engine actually declared open. */
  if (isClosingSoonRow(p) && p.closing_soon_band === 'WITHIN_24H') { group = 'urgent'; }
  return el('span', 'badge badge--' + group, String(p.status_label_ja));
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
  var label = shownText(p.evidence_label_ja);
  /* No label: no badge. A discovery row still says 未検証 — that is its state, not a gap. */
  if (label === null) { return isUnverifiedRow(p) ? el('span', 'badge badge--ev-none', '未検証') : null; }
  /* Defensive: never show 確認済み for a non-VERIFIED row. */
  if (p.evidence_state !== 'VERIFIED' && label === '確認済み') { label = '未検証'; }
  return el('span', 'badge badge--' + variant, label);
}

function isUnverifiedRow(p) {
  return p.verification_tier === 'DISCOVERY_UNVERIFIED' || p.evidence_state === 'UNVERIFIED';
}

/** Release text, precision-honest: month precision shows the display string. A display
    string that says the date is unconfirmed hides the release date entirely — the bare
    date is then NOT used in its place, because that would drop the caveat. */
function releaseText(p) {
  if (!isUnknown(p.release_date_display)) { return shownText(p.release_date_display); }
  if (p.release_date_precision === 'day' && !isUnknown(p.release_date)) {
    return fmtDate(p.release_date);
  }
  return null;                              /* unknown or month without display */
}

/** Relative wording for a deadline. Urgency is never expressed here: a row that is not a
    closing_soon_band row is styled muted by the caller, never as 締切間近. */
function deadlineRelText(p) {
  var d = num(p.days_to_deadline);
  if (d === null) { return null; }
  if (d < 0) { return '終了済み'; }
  return d === 0 ? '本日まで' : 'あと' + d + '日';
}

/**
 * The deadline split into what the eye needs first: a short DATE and a separate
 * RELATIVE count. Presentation only — urgency still comes from isClosingSoonRow,
 * i.e. from `closing_soon_band`; `urgent` / `soon` are never set for any other row.
 * Returns null when there is no deadline (the caller then renders no deadline at all).
 */
function deadlineParts(p, asOf) {
  if (isUnknown(p.deadline)) { return null; }
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(p.deadline));
  var shortDate = m ? (Number(m[2]) + '/' + Number(m[3])) : String(p.deadline);
  if (m && asOf && String(asOf).slice(0, 4) !== m[1]) { shortDate = m[1] + '/' + shortDate; }
  var kind = lbl(DEADLINE_KIND_LABEL, p.deadline_kind);
  var d = num(p.days_to_deadline);
  var rel = null;
  if (d !== null) {
    if (d < 0) { rel = '終了済み'; }
    else if (d === 0) { rel = '本日締切'; }
    else { rel = '残り' + d + '日'; }
  }
  var confirmed = isClosingSoonRow(p);
  var open = isOpenStatus(p);
  return {
    date: shortDate,
    fullDate: fmtDate(p.deadline),
    kind: kind || null,
    rel: rel,
    confirmed: confirmed,
    /* acceptance NOT confirmed open: muted + dashed, never urgent */
    muted: !open,
    urgent: confirmed && p.closing_soon_band === 'WITHIN_24H',
    soon: confirmed && p.closing_soon_band !== 'WITHIN_24H',
    passed: d !== null && d < 0
  };
}

/**
 * The outbound call to action, or null. Only an https URL that passed isSafeHttpUrl
 * becomes an href, and the two URLs are never conflated: a purchase_url is labelled
 * 「販売・応募ページ」, an official_url alone 「公式情報を確認」.
 *
 * `.cta-disclosure` is a dormant hook for a future sponsored / affiliate disclosure.
 * It is hidden and carries no link or tracking; nothing on the page is an ad today.
 */
function outboundCta(p, className) {
  var isPurchase = isSafeHttpUrl(p.purchase_url);
  var url = isPurchase ? p.purchase_url : (isSafeHttpUrl(p.official_url) ? p.official_url : null);
  if (!url) { return null; }
  var label = isPurchase ? '販売・応募ページ' : '公式情報を確認';
  var a = el('a', className);
  a.appendChild(el('span', 'cta-text', label));
  /* Where the link actually goes, visible rather than only in the accessible name: a reader
     deciding whether to leave the page should not have to hover a link to find out. */
  var ctaHost = hostOf(url);
  if (ctaHost) { a.appendChild(el('span', 'cta-host', ctaHost.replace(/^www\./, ''))); }
  /* The hook is EMPTY on purpose. 「PR」 is an advertising disclosure in Japan, so a
     non-sponsored link must not carry that text anywhere in its DOM — hidden text still
     surfaces in copy/paste, reader modes, CSS-off views and textContent scrapes, where it
     would label an ordinary official link as an ad. The text is written only for a link
     that is genuinely sponsored, which no link is today. */
  var disclosure = el('span', 'cta-disclosure');
  disclosure.hidden = true;
  a.appendChild(disclosure);
  a.href = String(url);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.dataset.monetization = 'none';
  var host = hostOf(url);
  a.setAttribute('aria-label', label + '（外部サイト' + (host ? '・' + host : '') + '、新しいタブで開きます）');
  return a;
}

/**
 * The published entry conditions: when applications open, when the result is announced,
 * and how many units one person may buy or apply for. Returns null when none of the three
 * is known — an empty row would read as "nothing applies", which is not the same thing.
 *
 * Deliberately NOT a chance of winning. Applicant counts and winner counts are never
 * published, so a probability cannot be derived, and an approximation here would be a
 * guess dressed as a fact. Dates and limits are what the sources actually state.
 */
function entryFacts(p) {
  var items = [];
  var opens = null;
  if (!isUnknown(p.lottery_start)) { opens = ['応募開始', fmtDate(p.lottery_start)]; }
  else if (!isUnknown(p.application_start)) { opens = ['応募開始', fmtDate(p.application_start)]; }
  else if (!isUnknown(p.reservation_start)) { opens = ['予約開始', fmtDate(p.reservation_start)]; }
  if (opens && opens[1]) { items.push(opens); }
  if (!isUnknown(p.result_date)) {
    var announced = fmtDate(p.result_date);
    if (announced) { items.push(['当選発表', announced]); }
  }
  if (shownText(p.purchase_limit) !== null) { items.push(['購入・応募上限：', String(p.purchase_limit)]); }

  if (items.length === 0) { return null; }
  var box = el('div', 'f-lottery');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', '公表されている応募条件');
  items.forEach(function (pair) {
    var item = el('span', 'f-lottery-item');
    item.appendChild(el('span', 'f-lottery-lbl', pair[0]));
    item.appendChild(elKeep('span', 'f-lottery-val', pair[1]));
    item.title = pair[0] + pair[1];   /* a long condition is clamped on feed cards; full text on the detail page */
    box.appendChild(item);
  });
  return box;
}

/* ------------------------------------------------------------ analog backtest */

/** The published backtest when at least one analog could be evaluated, else null. */
/* ------------------------------------------------------------ 買いの目安（参考）
   One level per product, taken from the build. The page never computes
   it: it only shows the level, the reason, and — when evidence is missing — what is missing. */
var BUY_LEVELS = ['LEAN_BUY', 'MIXED_SIGNALS', 'LEAN_SKIP', 'NOT_ENOUGH_EVIDENCE'];
var BUY_GLYPH = { LEAN_BUY: '●', MIXED_SIGNALS: '◐', LEAN_SKIP: '○', NOT_ENOUGH_EVIDENCE: '－' };
function buySignalOf(p) {
  var b = p && p.buy_signal;
  return (b && BUY_LEVELS.indexOf(b.level) !== -1) ? b : null;
}
function buyPill(b, big) {
  var pill = el('span', 'buy-pill buy--' + b.level + (big ? ' buy-pill--big' : ''));
  pill.appendChild(el('span', 'buy-glyph', BUY_GLYPH[b.level]));
  pill.appendChild(el('span', 'buy-lbl', String(b.label_ja)));
  pill.setAttribute('aria-label', '買いの目安（参考）：' + b.label_ja);
  return pill;
}
/** One-line reason: the result when there is one, otherwise the first missing piece. */
function buyWhy(b) {
  if (b.level === 'NOT_ENOUGH_EVIDENCE') {
    var m = Array.isArray(b.missing_ja) && b.missing_ja.length ? b.missing_ja[0] : null;
    return m ? '足りないもの：' + m : String(b.reason_ja);
  }
  return String(b.reason_ja);
}
function buyLine(p) {
  var b = buySignalOf(p);
  if (!b) { return null; }
  var box = el('div', 'c-buy');
  var head = el('span', 'c-buy-head');
  head.appendChild(el('span', 'c-buy-cap', '買いの目安'));
  head.appendChild(buyPill(b, false));
  box.appendChild(head);
  box.appendChild(el('span', 'c-buy-why', buyWhy(b)));
  return box;
}

function backtestOf(p) {
  var bt = p && p.analog_backtest;
  if (!bt || typeof bt !== 'object') { return null; }
  return bt;
}
function hasEvaluableBacktest(p) {
  var bt = backtestOf(p);
  return !!(bt && num(bt.analogs_evaluable) !== null && bt.analogs_evaluable > 0);
}

/** Signed yen: a negative headroom is written −¥1,083, never ¥-1,083. */
function fmtSignedYen(v) {
  var n = num(v);
  if (n === null) { return null; }
  var abs = Math.abs(Math.round(n)).toLocaleString('ja-JP');
  return (n < 0 ? '−¥' : '¥') + abs;
}

/** Median of the evaluable analogs' price-to-list ratios, for the one-line summary. */
function backtestMedianRatio(bt) {
  var r = (bt.analogs || []).filter(function (a) {
    return a && num(a.price_to_list_ratio) !== null && a.strict_sales >= 3 && a.list_price_jpy !== null &&
      a.result !== 'INSUFFICIENT_SAMPLE';
  }).map(function (a) { return a.price_to_list_ratio; }).sort(function (x, y) { return x - y; });
  if (!r.length) { return null; }
  var mid = Math.floor(r.length / 2);
  return r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2;
}

/**
 * One line on a card. Always says 参考 and always names what the number is: the most the
 * still-unknown costs could absorb, not a profit.
 */
function backtestLine(p) {
  if (!hasEvaluableBacktest(p)) { return null; }
  var bt = backtestOf(p);
  /* Compact: a title row (label + 数え方), one count line, and everything else behind 「詳しく」,
     so a card with this box is only ~80px taller than one without. The counts stay visible. */
  var box = el('div', 'bt-line' + ((bt.counter_signal_names || []).length ? ' has-counter' : ''));
  box.appendChild(el('span', 'bt-line-lbl', '類似品の過去相場（参考）'));
  /* one tap to the counting rules on this page (the explainer under 類似品の過去相場) */
  var how = el('a', 'bt-line-how', '数え方');
  how.href = '#how-counted';
  box.appendChild(how);

  var ratio = backtestMedianRatio(bt);
  var parts = [];
  parts.push('類似品' + bt.analogs_evaluable + '件');
  if (ratio !== null) { parts.push('定価の' + ratio.toFixed(2) + '倍（中央値）'); }
  /* No yen here: a card has no room for the unit caveat, and a ¥250 pack must not be read
     against a box-sized amount. The yen amounts, labelled with their unit, are on the detail page. */
  if ((bt.analog_units || []).length) { parts.push('類似品は' + bt.analog_units.join('・') + '単位での取引'); }
  var valNode = el('span', 'bt-line-val');
  parts.forEach(function (part, i) {
    /* each ・ item wraps as a unit (a phrase never splits across two lines) */
    valNode.appendChild(keepText(el('span', 'phrase-unit'), part + (i < parts.length - 1 ? '・' : '')));
  });

  /* 何件中何件 for the headline period, counts only */
  var main = (Array.isArray(bt.evidence_notes) ? bt.evidence_notes : []).filter(function (n) {
    return n && n.horizon === bt.horizon && num(n.evaluable) !== null && n.evaluable > 0 &&
      num(n.cleared) !== null && n.cleared <= n.evaluable;
  })[0];
  var more = el('details', 'bt-line-more');
  more.appendChild(el('summary', null, '詳しく'));
  if (main) {
    var cnt = el('span', 'bt-line-count');
    if (main.evaluable <= EV_DOT_MAX) {
      var dots = el('span', 'ev-dots ev-dots--sm');
      dots.setAttribute('aria-hidden', 'true');
      for (var i = 0; i < main.evaluable; i++) { dots.appendChild(el('i', i < main.cleared ? 'is-on' : null)); }
      cnt.appendChild(dots);
    }
    var hl = shownText(main.horizon_label_ja);
    var hShort = hl ? hl.replace(/（.*$/, '').replace(/^発売後/, '') : null;
    cnt.appendChild(elKeep('span', null, '似た商品' + main.evaluable + '件中' + main.cleared + '件が定価超え' +
      (hShort ? '（' + hShort + '）' : '') + (main.evaluable < 3 ? '・少数' : '')));
    box.appendChild(cnt);
    /* the full sentence (with the fee and the small-sample caveat) and the ratio are one tap away */
    more.appendChild(elKeep('p', 'bt-line-full', (hl ? hl.replace(/（.*$/, '') + '、' : '') +
      '手数料を引いても定価を上回ったのは' + main.evaluable + '件中' + main.cleared + '件' +
      (main.evaluable < 3 ? '（件数が少なく傾向とは言えません）' : '') + '。'));
    more.appendChild(valNode);
  } else {
    box.appendChild(valNode);
  }
  var spark = buildSparkline(bt);
  if (spark) { more.appendChild(spark); }
  if (more.children.length > 1) { box.appendChild(more); }
  if ((bt.counter_signal_names || []).length) {
    box.appendChild(el('span', 'bt-line-warn', '取引の少ない類似品に定価割れの兆候あり'));
  }
  return box;
}

/* ------------------------------------------------------- price-path charts
   Completed-sale prices of OTHER, similar past products, as a ratio to each one's own list
   price (1.0 = 定価). Inline SVG only, built with createElementNS; every label is textContent.
   Colours come from the --series-N / --chart-* tokens in style.css (validated palette), and a
   series keeps its slot by its position in `trends`, so a colour always means the same product. */

var CHART_MAX_SERIES = 5;
var CHART_DAY_MAX = 180;
var CHART_TICKS = [
  { d: 0, t: '発売日', key: true }, { d: 3, t: '3日' }, { d: 7, t: '1週', key: true },
  { d: 14, t: '2週' }, { d: 30, t: '1か月', key: true }, { d: 60, t: '2か月' },
  { d: 90, t: '3か月' }, { d: 180, t: '6か月', key: true }
];
/* Words that open a long product name without identifying it; the part after them is kept. */
var TREND_NAME_CUT = ['エクストラブースター', 'プレミアムブースター', 'ブースターパック', '強化拡張パック',
  '拡張パック', 'スタートデッキ'];

/** Horizontal position 0..1 for a day count: log-like, so launch week and month six both fit. */
function dayPos(d) {
  var v = Math.max(0, Math.min(CHART_DAY_MAX, d));
  return Math.log(1 + v) / Math.log(1 + CHART_DAY_MAX);
}
function bucketPos(b) { return (dayPos(b.day_from) + dayPos(b.day_to)) / 2; }
function bucketKey(b) { return b.day_from + '-' + b.day_to; }

function dayRangeText(b) {
  if (b.day_from === 0 && b.day_to === 0) { return '発売日'; }
  if (b.day_from === b.day_to) { return '発売後' + b.day_from + '日'; }
  return '発売後' + b.day_from + '〜' + b.day_to + '日';
}
function fmtRatio(r) { return r.toFixed(2) + '倍'; }

function trendCode(name) {
  var m = /【([^】]{1,12})】/.exec(name);
  return m ? m[1] : null;
}
/** A name short enough for a legend row; the full name stays in the title and the table. */
function trendLegendName(name) {
  var s = String(name);
  var at = -1;
  var len = 0;
  TREND_NAME_CUT.forEach(function (w) {
    var k = s.lastIndexOf(w);
    if (k > at) { at = k; len = w.length; }
  });
  if (at >= 0 && s.slice(at + len).trim()) { s = s.slice(at + len).trim(); }
  var code = trendCode(s);
  if (code) { s = code + ' ' + s.replace(/【[^】]*】/g, '').trim(); }
  s = s.trim();
  return s.length > 24 ? s.slice(0, 23) + '…' : s;
}
/** The tag written at a line's end: the set code when there is one, else a clipped name. */
function trendTag(name) {
  var code = trendCode(String(name));
  if (code) { return code; }
  var s = trendLegendName(name).split(/\s+/)[0];
  return s.length > 9 ? s.slice(0, 8) + '…' : s;
}

/** The usable trends, in published order. `slot` is fixed by that order, never by value. */
function trendSeries(bt) {
  var list = (bt && Array.isArray(bt.trends)) ? bt.trends : [];
  var out = [];
  list.forEach(function (t, i) {
    if (!t || typeof t !== 'object' || !Array.isArray(t.buckets)) { return; }
    var bs = t.buckets.filter(function (b) {
      return b && num(b.ratio) !== null && num(b.day_from) !== null && num(b.day_to) !== null &&
        b.day_from <= CHART_DAY_MAX && b.day_to >= b.day_from;
    }).slice().sort(function (a, b) { return a.day_from - b.day_from; });
    if (!bs.length) { return; }
    /* An unnamed trend is labelled by its position, never with 「名称未確認」. */
    var name = shownText(t.comparable_name) || ('類似品' + (i + 1));
    out.push({
      name: name, legend: trendLegendName(name), tag: trendTag(name),
      strength: t.strength, slot: i + 1, buckets: bs
    });
  });
  return out;
}

function outlookMonth(bt) {
  var hit = null;
  (bt && Array.isArray(bt.outlook) ? bt.outlook : []).forEach(function (o) {
    if (o && o.horizon === 'd30' && num(o.ratio_min) !== null && num(o.ratio_max) !== null &&
        num(o.ratio_median) !== null) { hit = o; }
  });
  return hit;
}

/** Rough text width in px (CJK ~1em, ASCII ~0.6em), so layout never waits on measurement. */
function textWidth(s, px) {
  var w = 0;
  for (var i = 0; i < s.length; i++) { w += s.charCodeAt(i) > 255 ? px : px * 0.6; }
  return w;
}

var CELL_SHORT = { '期間': '', '取引件数': '件数', '取引価格の中央値': '中央値', '定価に対する倍率': '倍率', '最安〜最高': '範囲' };
/** Copies each column head onto its cells (data-label), so a narrow screen can stack a row. */
function labelCells(table) {
  var heads = [].map.call(table.querySelectorAll('thead th'), function (th) { return th.textContent; });
  var rows = table.querySelectorAll('tbody tr');
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < rows[i].children.length; j++) {
      var short = own(CELL_SHORT, heads[j]);
      var lab = short === undefined ? heads[j] : short;
      if (lab) { rows[i].children[j].setAttribute('data-label', lab); }
    }
  }
}

/** Does a label box touch any drawn segment or marker (other than those of series `own`)? */
function hitsMarks(b, marks, own) {
  function inBox(x, y, pad) { return x >= b.x0 - pad && x <= b.x1 + pad && y >= b.y0 - pad && y <= b.y1 + pad; }
  for (var i = 0; i < marks.length; i++) {
    var mk = marks[i];
    if (own !== null && mk.s === own) { continue; }
    if (mk.dot) { if (inBox(mk.dot[0], mk.dot[1], 5)) { return true; } continue; }
    var sg = mk.seg;
    var len = Math.max(Math.abs(sg[2] - sg[0]), Math.abs(sg[3] - sg[1]));
    var steps = Math.max(1, Math.ceil(len / 2));
    for (var k = 0; k <= steps; k++) {
      var t = k / steps;
      if (inBox(sg[0] + (sg[2] - sg[0]) * t, sg[1] + (sg[3] - sg[1]) * t, 1.5)) { return true; }
    }
  }
  return false;
}

function lineKey(slotClass, dashed, hollow) {
  /* A legend / readout key drawn with CSS, not SVG: the chart's plot is the only <svg> in the
     figure, so "the chart" is never confused with a 22px legend swatch. */
  var key = el('span', 'pchart-key ' + slotClass);
  key.setAttribute('aria-hidden', 'true');
  key.appendChild(el('i', 'pchart-key-line' + (dashed ? ' is-thin' : '')));
  if (hollow !== null) { key.appendChild(el('b', 'pchart-key-dot' + (hollow ? ' is-thin' : ''))); }
  return key;
}

/** Card sparkline: the first STRONG trend (else the first), its ratio path and the 1.0 line. */
function buildSparkline(bt) {
  var all = trendSeries(bt);
  var s = all.filter(function (x) { return x.strength === 'STRONG'; })[0] || all[0];
  if (!s || s.buckets.length < 2) { return null; }
  var W = 120;
  var H = 36;
  var pad = 4;
  var lo = 1;
  var hi = 1;
  s.buckets.forEach(function (b) { lo = Math.min(lo, b.ratio); hi = Math.max(hi, b.ratio); });
  /* a floor on the vertical span, so a 1.00 -> 1.04 wobble is not drawn as a plunge */
  if (hi - lo < 0.8) {
    var mid = (hi + lo) / 2;
    lo = mid - 0.4;
    hi = mid + 0.4;
  }
  var span = hi - lo;
  function Y(r) { return pad + (hi - r) / span * (H - 2 * pad); }
  function X(b) { return pad + bucketPos(b) * (W - 2 * pad); }
  var box = el('div', 'bt-spark');
  var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', 'class': 'bt-spark-svg',
    'aria-hidden': 'true', focusable: 'false' });
  svg.appendChild(svgEl('line', { x1: 0, y1: Y(1), x2: W, y2: Y(1), 'class': 'spark-ref' }));
  svg.appendChild(svgEl('path', {
    'class': 'spark-line s' + Math.min(s.slot, CHART_MAX_SERIES),
    d: s.buckets.map(function (b, i) { return (i ? 'L' : 'M') + X(b).toFixed(1) + ' ' + Y(b.ratio).toFixed(1); }).join(' ')
  }));
  box.appendChild(svg);
  var last = s.buckets[s.buckets.length - 1];
  box.appendChild(el('span', 'bt-spark-cap',
    '類似品1件（' + s.tag + '）の値動き（横線が定価）・' + dayRangeText(last) + 'は定価の' + fmtRatio(last.ratio) +
    (last.thin === true ? '・件数少なめ' : '')));
  return box;
}

/**
 * Detail chart 「似た過去の商品の取引価格の推移」. Returns a <figure> or null when no trend has a
 * usable bucket. Drawn on first layout and redrawn when the container width changes.
 */
function buildTrendChart(bt) {
  var series = trendSeries(bt);
  if (!series.length) { return null; }
  var shown = series.filter(function (s) { return s.slot <= CHART_MAX_SERIES; });
  if (!shown.length) { shown = series.slice(0, CHART_MAX_SERIES); }
  var ol = outlookMonth(bt);
  var anyThin = shown.some(function (s) { return s.buckets.some(function (b) { return b.thin === true; }); });

  var fig = el('figure', 'pchart');
  var cap = el('figcaption', 'pchart-cap');
  cap.appendChild(el('span', 'pchart-title', '似た過去の商品の取引価格の推移'));
  cap.appendChild(el('span', 'pchart-sub',
    '似た過去の商品が実際に取引された価格を、定価を1.0倍とした倍率で表しています（この商品の価格ではありません）。' +
    '横軸は発売からの日数で、目盛りの間隔は均等ではありません。'));
  fig.appendChild(cap);

  var legend = el('ul', 'pchart-legend');
  shown.forEach(function (s) {
    var li = el('li', 'pchart-legend-item');
    li.appendChild(lineKey('s' + s.slot, false, false));
    var nm = el('span', 'pchart-legend-name', s.legend);
    nm.title = s.name;
    li.appendChild(nm);
    legend.appendChild(li);
  });
  if (anyThin) {
    var liThin = el('li', 'pchart-legend-item pchart-legend-aux');
    liThin.appendChild(lineKey('s-neutral', true, true));
    liThin.appendChild(el('span', 'pchart-legend-name', '白抜き・点線は件数が少なめ（3件未満・参考値）'));
    legend.appendChild(liThin);
  }
  if (ol) {
    var liOl = el('li', 'pchart-legend-item pchart-legend-aux');
    var k = el('span', 'pchart-key');
    k.setAttribute('aria-hidden', 'true');
    k.appendChild(el('i', 'pchart-key-band'));
    liOl.appendChild(k);
    liOl.appendChild(el('span', 'pchart-legend-name', '見通し（倍率）は発売1か月時点の範囲'));
    legend.appendChild(liOl);
  }
  fig.appendChild(legend);

  var stage = el('div', 'pchart-stage');
  var tip = el('div', 'pchart-tip');
  tip.hidden = true;
  tip.setAttribute('aria-live', 'polite');
  fig.appendChild(stage);

  if (series.length > shown.length) {
    fig.appendChild(el('p', 'pchart-more', 'ほかの' + (series.length - shown.length) + '件は「表で見る」でご覧いただけます。'));
  }

  /* 表で見る: the same numbers, reachable without hovering. */
  var det = el('details', 'pchart-table');
  det.appendChild(el('summary', null, '表で見る'));
  var scroll = el('div', 'pchart-scroll');
  var table = el('table');
  var thead = el('thead');
  var hr = el('tr');
  ['似た過去の商品', '期間', '取引件数', '取引価格の中央値', '定価に対する倍率'].forEach(function (h) {
    var th = el('th', null, h);
    th.setAttribute('scope', 'col');
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  var tbody = el('tbody');
  series.forEach(function (s) {
    s.buckets.forEach(function (b, bi) {
      var tr = el('tr', b.thin === true ? 'is-thin' : null);
      var th = el('th', null, bi === 0 ? s.legend : '');
      th.setAttribute('scope', 'row');
      if (bi === 0) { th.title = s.name; } else { th.className = 'is-repeat'; th.appendChild(el('span', 'visually-hidden', s.legend)); }
      tr.appendChild(th);
      tr.appendChild(el('td', null, dayRangeText(b)));
      /* An unknown count or median leaves its table cell EMPTY (the column stays), never 0. */
      tr.appendChild(el('td', 'num', num(b.n) === null ? '' : (b.n + '件' + (b.thin === true ? '・少なめ' : ''))));
      tr.appendChild(el('td', 'num', num(b.median_jpy) === null ? '' : fmtPrice(b.median_jpy)));
      tr.appendChild(el('td', 'num', fmtRatio(b.ratio)));
      tbody.appendChild(tr);
    });
  });
  table.appendChild(tbody);
  labelCells(table);
  scroll.appendChild(table);
  det.appendChild(scroll);
  fig.appendChild(det);

  /* ---- geometry (in CSS px: the viewBox is the measured width) ---- */
  var lo = 1;
  var hi = 1;
  shown.forEach(function (s) {
    s.buckets.forEach(function (b) { lo = Math.min(lo, b.ratio); hi = Math.max(hi, b.ratio); });
  });
  if (ol) { lo = Math.min(lo, ol.ratio_min); hi = Math.max(hi, ol.ratio_max); }
  var yMin = Math.max(0, Math.min(0.5, Math.floor((lo - 0.05) * 2) / 2));
  var yMax = Math.ceil((hi + 0.1) * 2) / 2;
  var yStep = (yMax - yMin) > 2.5 ? 1 : 0.5;

  /* the x slots the crosshair snaps to: every bucket any shown series has */
  var slotMap = {};
  shown.forEach(function (s) {
    s.buckets.forEach(function (b) {
      var key = bucketKey(b);
      if (!slotMap[key]) { slotMap[key] = { key: key, pos: bucketPos(b), sample: b }; }
    });
  });
  var slots = Object.keys(slotMap).map(function (k2) { return slotMap[k2]; })
    .sort(function (a, b) { return a.pos - b.pos; });

  var state = { width: 0, cur: -1, geo: null, svg: null };

  function draw(width, noTags) {
    var narrow = width < 480;
    var H = narrow ? 250 : 300;
    stage.classList.toggle('is-narrow', narrow);
    var useTags = shown.length <= 4 && !noTags;
    var tagW = 0;
    if (useTags) { shown.forEach(function (s) { tagW = Math.max(tagW, textWidth(s.tag, 12)); }); }
    var m = { l: 42, r: useTags ? Math.min(72, Math.ceil(tagW) + 14) : 14, t: 22, b: 30 };
    var pw = Math.max(40, width - m.l - m.r);
    var ph = H - m.t - m.b;
    function X(p) { return m.l + p * pw; }
    function Y(r) { return m.t + (yMax - r) / (yMax - yMin) * ph; }
    var svg = svgEl('svg', { viewBox: '0 0 ' + width + ' ' + H, width: '100%', height: H,
      'class': 'pchart-svg', role: 'group', tabindex: '0',
      'aria-label': '似た過去の商品' + shown.length + '件の、発売後の取引価格（定価に対する倍率）の折れ線グラフです。' +
        '左右の矢印キーで期間を移動できます。同じ数値は「表で見る」でもご覧いただけます。' });

    /* 定価割れ band, then grid, then axis */
    var y1 = Y(1);
    svg.appendChild(svgEl('rect', { x: m.l, y: y1, width: pw, height: Math.max(0, m.t + ph - y1), 'class': 'pchart-under' }));
    for (var t = Math.ceil(yMin / yStep) * yStep; t <= yMax + 1e-9; t += yStep) {
      if (Math.abs(t - 1) < 1e-9) { continue; }
      svg.appendChild(svgEl('line', { x1: m.l, y1: Y(t), x2: m.l + pw, y2: Y(t), 'class': 'pchart-grid' }));
      var yl = svgEl('text', { x: m.l - 6, y: Y(t) + 4, 'text-anchor': 'end', 'class': 'pchart-tick' });
      yl.textContent = t.toFixed(1) + '倍';
      svg.appendChild(yl);
    }
    svg.appendChild(svgEl('line', { x1: m.l, y1: m.t + ph, x2: m.l + pw, y2: m.t + ph, 'class': 'pchart-axis' }));
    CHART_TICKS.forEach(function (tk) {
      if (narrow && !tk.key) { return; }
      var x = X(dayPos(tk.d));
      svg.appendChild(svgEl('line', { x1: x, y1: m.t + ph, x2: x, y2: m.t + ph + 4, 'class': 'pchart-axis' }));
      var tx = svgEl('text', { x: x, y: m.t + ph + 18, 'text-anchor': tk.d === 0 ? 'start' : (tk.d === CHART_DAY_MAX ? 'end' : 'middle'),
        'class': 'pchart-tick' });
      if (tk.d === 0) { tx.setAttribute('x', String(x - 4)); }
      tx.textContent = tk.t;
      svg.appendChild(tx);
    });

    /* 見通し: a secondary range at the 1-month position, behind the lines */
    if (ol) {
      var ox = X(dayPos(30));
      svg.appendChild(svgEl('rect', { x: ox - 5, y: Y(ol.ratio_max), width: 10,
        height: Math.max(2, Y(ol.ratio_min) - Y(ol.ratio_max)), rx: 3, 'class': 'pchart-ol-band' }));
      svg.appendChild(svgEl('line', { x1: ox - 8, y1: Y(ol.ratio_median), x2: ox + 8, y2: Y(ol.ratio_median),
        'class': 'pchart-ol-mid' }));
      /* no in-plot label: on a crowded chart it lands on the lines. The legend row names the band. */
    }

    /* the 定価 reference line, labelled */
    svg.appendChild(svgEl('line', { x1: m.l, y1: y1, x2: m.l + pw, y2: y1, 'class': 'pchart-ref' }));
    var y1l = svgEl('text', { x: m.l - 6, y: y1 + 4, 'text-anchor': 'end', 'class': 'pchart-tick pchart-tick--ref' });
    y1l.textContent = '定価';
    svg.appendChild(y1l);

    /* lines + markers; every drawn segment and marker is kept for the label collision test */
    var dotsByKey = {};
    var tags = [];
    var marks = [];
    if (ol) {
      var olx = X(dayPos(30));
      marks.push({ s: -1, seg: [olx - 8, Y(ol.ratio_median), olx + 8, Y(ol.ratio_median)] });
      marks.push({ s: -1, seg: [olx, Y(ol.ratio_max), olx, Y(ol.ratio_min)] });
    }
    shown.forEach(function (s) {
      var g = svgEl('g', { 'class': 'pchart-series s' + s.slot });
      for (var k3 = 1; k3 < s.buckets.length; k3++) {
        var a = s.buckets[k3 - 1];
        var b = s.buckets[k3];
        g.appendChild(svgEl('line', { x1: X(bucketPos(a)), y1: Y(a.ratio), x2: X(bucketPos(b)), y2: Y(b.ratio),
          'class': 'pchart-seg' + (a.thin === true || b.thin === true ? ' is-thin' : '') }));
        marks.push({ s: s.slot, seg: [X(bucketPos(a)), Y(a.ratio), X(bucketPos(b)), Y(b.ratio)] });
      }
      s.buckets.forEach(function (b) {
        var c = svgEl('circle', { cx: X(bucketPos(b)), cy: Y(b.ratio), r: 4,
          'class': 'pchart-dot' + (b.thin === true ? ' is-thin' : '') });
        var key = bucketKey(b);
        marks.push({ s: s.slot, dot: [X(bucketPos(b)), Y(b.ratio)] });
        (dotsByKey[key] = dotsByKey[key] || []).push(c);
        g.appendChild(c);
      });
      svg.appendChild(g);
      if (useTags) {
        var last = s.buckets[s.buckets.length - 1];
        tags.push({ s: s, x: X(bucketPos(last)), y: Y(last.ratio) });
      }
    });

    /* direct end-labels (<= 4 series); if any two would collide, the legend carries identity alone */
    if (tags.length) {
      var boxes = tags.map(function (tg) {
        var w = textWidth(tg.s.tag, 12);
        var right = tg.x + 7 + w <= width - 2;
        return { tg: tg, x0: right ? tg.x + 7 : tg.x - 7 - w, x1: right ? tg.x + 7 + w : tg.x - 7,
          y: right ? tg.y + 4 : tg.y - 8, anchor: right ? 'start' : 'end' };
      });
      var clash = boxes.some(function (p, i) {
        return boxes.some(function (q, j) {
          return j > i && Math.abs(p.y - q.y) < 13 && p.x0 < q.x1 && q.x0 < p.x1;
        });
      }) || boxes.some(function (bx) {
        /* a name may touch its own line's end, never another series' line or marker */
        return hitsMarks({ x0: bx.x0 - 1, x1: bx.x1 + 1, y0: bx.y - 10, y1: bx.y + 3 }, marks, bx.tg.s.slot);
      });
      if (clash) { draw(width, true); return; }
      boxes.forEach(function (bx) {
        var tt = svgEl('text', { x: bx.anchor === 'start' ? bx.x0 : bx.x1, y: bx.y, 'text-anchor': bx.anchor,
          'class': 'pchart-tag pchart-halo' });
        tt.textContent = bx.tg.s.tag;
        svg.appendChild(tt);
      });
    }
    /* 定価割れ: only where it touches no line or marker */
    if (y1 < m.t + ph - 16) {
      var uw = textWidth('定価割れ', 12);
      var ub = { x0: m.l + 5, x1: m.l + 7 + uw, y0: m.t + ph - 17, y1: m.t + ph - 2 };
      if (!hitsMarks(ub, marks, null)) {
        var uLbl = svgEl('text', { x: m.l + 6, y: m.t + ph - 6, 'class': 'pchart-note pchart-halo' });
        uLbl.textContent = '定価割れ';
        svg.appendChild(uLbl);
      }
    }

    /* crosshair + hit layer (the whole plot, bigger than any mark) */
    var cross = svgEl('line', { x1: 0, y1: m.t, x2: 0, y2: m.t + ph, 'class': 'pchart-cross' });
    cross.setAttribute('visibility', 'hidden');
    svg.appendChild(cross);
    var hit = svgEl('rect', { x: m.l - 8, y: 0, width: pw + 16, height: m.t + ph + 8, 'class': 'pchart-hit' });
    svg.appendChild(hit);

    state.geo = { X: X, m: m, pw: pw, width: width, cross: cross, dotsByKey: dotsByKey };
    if (state.svg && state.svg.parentNode) { state.svg.parentNode.removeChild(state.svg); }
    state.svg = svg;
    stage.insertBefore(svg, stage.firstChild);
    if (!tip.parentNode) { stage.appendChild(tip); }
    wire(svg, hit);
    if (state.cur >= 0) { show(state.cur); }
  }

  function clearHot() {
    var hot = stage.querySelectorAll('.pchart-dot.is-hot');
    for (var i = 0; i < hot.length; i++) {
      hot[i].classList.remove('is-hot');
      hot[i].setAttribute('r', '4');
    }
  }

  function hide() {
    state.cur = -1;
    clearHot();
    if (state.geo) { state.geo.cross.setAttribute('visibility', 'hidden'); }
    tip.hidden = true;
  }

  function show(idx) {
    if (!state.geo || !slots.length) { return; }
    idx = Math.max(0, Math.min(slots.length - 1, idx));
    state.cur = idx;
    var sl = slots[idx];
    var geo = state.geo;
    var x = geo.X(sl.pos);
    geo.cross.setAttribute('x1', String(x));
    geo.cross.setAttribute('x2', String(x));
    geo.cross.setAttribute('visibility', 'visible');
    clearHot();
    (geo.dotsByKey[sl.key] || []).forEach(function (c) { c.classList.add('is-hot'); c.setAttribute('r', '6'); });

    while (tip.firstChild) { tip.removeChild(tip.firstChild); }
    tip.appendChild(el('div', 'pchart-tip-head', dayRangeText(sl.sample)));
    shown.forEach(function (s) {
      var b = s.buckets.filter(function (x2) { return bucketKey(x2) === sl.key; })[0];
      if (!b) { return; }
      var row = el('div', 'pchart-tip-row');
      row.appendChild(lineKey('s' + s.slot, b.thin === true, null));
      var body = el('div', 'pchart-tip-body');
      var val = el('div', 'pchart-tip-val');
      val.appendChild(el('strong', null, fmtRatio(b.ratio)));
      if (num(b.median_jpy) !== null) { val.appendChild(el('span', null, ' 中央値 ' + fmtPrice(b.median_jpy))); }
      body.appendChild(val);
      body.appendChild(el('div', 'pchart-tip-name', s.legend));
      if (num(b.n) !== null) {
        body.appendChild(el('div', 'pchart-tip-n' + (b.thin === true ? ' is-thin' : ''),
          '取引' + b.n + '件' + (b.thin === true ? '・件数が少なめ' : '')));
      }
      row.appendChild(body);
      tip.appendChild(row);
    });
    tip.hidden = false;
    if (stage.classList.contains('is-narrow')) { return; }
    var tw = tip.offsetWidth || 180;
    var left = x + 12;
    if (left + tw > geo.width - 2) { left = x - 12 - tw; }
    if (left < 2) { left = Math.max(2, geo.width - tw - 2); }
    tip.style.setProperty('left', Math.round(left) + 'px');
    tip.style.setProperty('top', Math.round(geo.m.t) + 'px');
  }

  function nearest(clientX) {
    var r = state.svg.getBoundingClientRect();
    var scale = r.width ? state.geo.width / r.width : 1;
    var px = (clientX - r.left) * scale;
    var best = 0;
    var bestD = Infinity;
    slots.forEach(function (sl, i) {
      var dd = Math.abs(state.geo.X(sl.pos) - px);
      if (dd < bestD) { bestD = dd; best = i; }
    });
    return best;
  }

  function wire(svg, hit) {
    hit.addEventListener('pointermove', function (e) { show(nearest(e.clientX)); });
    hit.addEventListener('pointerdown', function (e) { show(nearest(e.clientX)); });
    hit.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') { hide(); } });
    svg.addEventListener('focus', function () { show(state.cur >= 0 ? state.cur : 0); });
    svg.addEventListener('blur', hide);
    svg.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowRight' || k === 'ArrowDown') { show(state.cur + 1); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp') { show(Math.max(0, state.cur - 1)); e.preventDefault(); }
      else if (k === 'Home') { show(0); e.preventDefault(); }
      else if (k === 'End') { show(slots.length - 1); e.preventDefault(); }
      else if (k === 'Escape') { hide(); }
    });
  }

  /* a tap outside the chart closes a touch-opened readout */
  document.addEventListener('pointerdown', function (e) {
    if (state.cur >= 0 && !stage.contains(e.target)) { hide(); }
  });

  function measure() {
    var w = Math.round(stage.clientWidth);
    if (w > 0 && w !== state.width) { state.width = w; draw(w); }
  }
  if (typeof ResizeObserver === 'function') {
    new ResizeObserver(measure).observe(stage);
  } else {
    window.addEventListener('resize', measure);
    window.setTimeout(measure, 0);
  }
  return fig;
}

/**
 * 「何件中何件」: for each period, how many similar products could be compared and in how many
 * of them the median sale cleared list price after the fee. A row of dots (filled = cleared)
 * plus the published sentence. Counts only: no rate, no probability, no score.
 */
var EV_DOT_MAX = 12;
function evidenceLead(bt) {
  var notes = (bt && Array.isArray(bt.evidence_notes)) ? bt.evidence_notes : [];
  notes = notes.filter(function (n) {
    return n && num(n.evaluable) !== null && n.evaluable > 0 && num(n.cleared) !== null &&
      n.cleared >= 0 && n.cleared <= n.evaluable && shownText(n.horizon_label_ja) !== null;
  });
  if (!notes.length) { return null; }
  var box = el('div', 'ev-lead');
  box.appendChild(el('p', 'ev-lead-title', '手数料を引いても定価を上回った似た商品'));
  /* The headline period (bt.horizon) leads with its sentence; the other periods are one
     compact row each, and their sentences sit one tap away. */
  var mainIdx = 0;
  notes.forEach(function (n, i) { if (n.horizon === bt.horizon) { mainIdx = i; } });
  var ol = el('ol', 'ev-notes');
  var more = [];
  notes.forEach(function (n, i) {
    var isMain = i === mainIdx;
    var li = el('li', 'ev-note' + (isMain ? ' is-main' : '') + (n.evaluable < 3 ? ' is-small' : ''));
    li.appendChild(elKeep('span', 'ev-h', String(n.horizon_label_ja)));
    var vis = el('span', 'ev-dots');
    vis.setAttribute('aria-hidden', 'true');
    if (n.evaluable <= EV_DOT_MAX) {
      for (var k = 0; k < n.evaluable; k++) { vis.appendChild(el('i', k < n.cleared ? 'is-on' : null)); }
    } else {
      vis.classList.add('is-bar');
      var fill = el('i', 'is-on');
      fill.style.setProperty('width', (n.cleared / n.evaluable * 100).toFixed(1) + '%');
      vis.appendChild(fill);
    }
    li.appendChild(vis);
    var cnt = el('span', 'ev-count');
    cnt.appendChild(el('strong', null, String(n.cleared)));
    cnt.appendChild(document.createTextNode('件 / ' + n.evaluable + '件中' + (n.evaluable < 3 ? '・少数' : '')));
    li.appendChild(cnt);
    var text = shownText(n.text_ja);
    if (text !== null) {
      if (isMain) { li.appendChild(elKeep('p', 'ev-text', text)); }
      else { more.push(text); }
    }
    if (isMain) { ol.insertBefore(li, ol.firstChild); } else { ol.appendChild(li); }
  });
  box.appendChild(ol);
  if (more.length) {
    var det = el('details', 'ev-more');
    det.appendChild(el('summary', null, 'ほかの期間の説明を読む'));
    var ul = el('ul', 'ev-more-list');
    more.forEach(function (t) { ul.appendChild(elKeep('li', null, t)); });
    det.appendChild(ul);
    box.appendChild(det);
  }
  return box;
}

/**
 * 「数え方」: one short, plain explanation of every counting rule behind the numbers above.
 * A real <details>, so it is keyboard-reachable and costs no space until opened.
 */
function howCounted(bt, id) {
  var d = el('details', 'howcount');
  if (id) { d.id = id; }
  d.appendChild(el('summary', 'howcount-sum', '数え方（取引・手数料・範囲の意味）'));
  var fee = bt ? num(bt.fee_rate) : null;
  var units = (bt && Array.isArray(bt.analog_units) && bt.analog_units.length) ? bt.analog_units.join('・') : null;
  var ul = el('ul', 'howcount-list');
  [
    ['取引', 'オークションなどで実際に取引が成立したもののうち、未開封・単品・欠品なしのものだけを数えています。出品中の価格は含みません。'],
    ['手数料', '取引価格から販売手数料' + (fee === null ? '' : '（' + Math.round(fee * 100) + '%）') +
      'を引いてから定価と比べています。送料や梱包の費用はまだ確認できていないため、引いていません。'],
    ['定価', '比べる相手は、それぞれの類似品の定価です。この商品の定価ではありません。'],
    ['単位', units ? '類似品の価格は' + units + '単位の取引です。パックとBOXのように単位が違うものは、金額ではなく定価に対する倍率で比べています。'
      : 'パックとBOXのように単位が違うものは、金額ではなく定価に対する倍率で比べています。'],
    ['発売後1か月', '発売から23〜37日の間に成立した取引です。ほかの期間も、表示している日数の範囲で数えています。'],
    ['90%範囲', '集まった取引を何度も抜き出し直して中央値を計算し直したとき、10回のうち9回ほどが入る範囲です。取引が少ないときは表示していません。'],
    ['取引日数', '取引があった日の数です。多くの取引が1日に集中しているときは、その日だけの事情に左右されている可能性があります。'],
    ['見通しの誤差', '各商品を、それより前に発売された商品だけを使って見積もり、実際の取引と比べた差です。後から分かった情報は使っていません。']
  ].forEach(function (pair) {
    var li = el('li');
    li.appendChild(el('strong', null, pair[0]));
    li.appendChild(el('span', null, pair[1]));
    ul.appendChild(li);
  });
  d.appendChild(ul);
  return d;
}

/**
 * A strip under each analog: where its ratio sits against the 1.0 (定価) mark, on one shared
 * scale for the whole list. Decorative twin of the 定価比 text beside it, so aria-hidden.
 */
function ratioStrip(ratio, scaleMax, lo, hi) {
  var r = num(ratio);
  if (r === null || !(scaleMax > 0)) { return null; }
  function pct(v) { return (Math.max(0, Math.min(scaleMax, v)) / scaleMax * 100).toFixed(2) + '%'; }
  var track = el('span', 'bt-strip');
  track.setAttribute('aria-hidden', 'true');
  var bar = el('span', 'bt-strip-bar' + (r < 1 ? ' is-under' : ''));
  bar.style.setProperty('left', pct(Math.min(1, r)));
  bar.style.setProperty('width', ((Math.abs(r - 1) / scaleMax) * 100).toFixed(2) + '%');
  track.appendChild(bar);
  /* 90% range of the 1-month median, as an error bar around the dot (only when published) */
  if (num(lo) !== null && num(hi) !== null && hi >= lo) {
    var ci = el('span', 'bt-strip-ci');
    ci.style.setProperty('left', pct(lo));
    ci.style.setProperty('width', ((Math.min(scaleMax, hi) - Math.min(scaleMax, lo)) / scaleMax * 100).toFixed(2) + '%');
    track.appendChild(ci);
  }
  var one = el('span', 'bt-strip-one');
  one.style.setProperty('left', pct(1));
  track.appendChild(one);
  var dot = el('span', 'bt-strip-dot');
  dot.style.setProperty('left', pct(r));
  track.appendChild(dot);
  return track;
}

/* ---------------------------------------------------------------- thumbnail */

/** Stable non-negative hash of a string. Same id -> same tile, every render, every page. */
function idHash(text) {
  var h = 0;
  var str = String(text || '');
  for (var i = 0; i < str.length; i++) {
    h = ((h * 31) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/* Eight muted hues. Deliberately NOT the state hues (open green / urgent red / flag purple):
   a tile must never look like it is reporting a status. */
var THUMB_HUES = [12, 40, 86, 150, 190, 222, 268, 320];

/** The glyph per category, as plain SVG primitives in a 64x64 box. */
var THUMB_GLYPH = {
  TCG: [['rect', { x: 14, y: 12, width: 26, height: 38, rx: 3 }],
        ['rect', { x: 26, y: 18, width: 26, height: 38, rx: 3 }],
        ['line', { x1: 31, y1: 27, x2: 47, y2: 27 }],
        ['line', { x1: 31, y1: 35, x2: 47, y2: 35 }]],
  FIGURE: [['circle', { cx: 32, cy: 19, r: 7 }],
           ['path', { d: 'M20 52 Q32 28 44 52 Z' }],
           ['line', { x1: 24, y1: 52, x2: 40, y2: 52 }]],
  TOY: [['rect', { x: 14, y: 24, width: 36, height: 26, rx: 3 }],
        ['path', { d: 'M14 24 L22 14 L50 14 L50 24' }],
        ['line', { x1: 32, y1: 24, x2: 32, y2: 50 }]],
  CHARACTER_GOODS: [['circle', { cx: 32, cy: 18, r: 6 }],
                    ['path', { d: 'M32 24 L32 30' }],
                    ['rect', { x: 20, y: 30, width: 24, height: 22, rx: 6 }]],
  BOOK_MOOK: [['path', { d: 'M12 16 Q32 24 32 24 L32 50 Q32 50 12 42 Z' }],
              ['path', { d: 'M52 16 Q32 24 32 24 L32 50 Q32 50 52 42 Z' }]],
  ONLINE_LOTTERY: [['rect', { x: 12, y: 22, width: 40, height: 22, rx: 4 }],
                   ['line', { x1: 26, y1: 22, x2: 26, y2: 44 }],
                   ['line', { x1: 34, y1: 26, x2: 46, y2: 26 }],
                   ['line', { x1: 34, y1: 34, x2: 46, y2: 34 }]],
  COLLAB: [['circle', { cx: 25, cy: 32, r: 11 }],
           ['circle', { cx: 39, cy: 32, r: 11 }]],
  OTHER: [['rect', { x: 14, y: 22, width: 36, height: 28, rx: 3 }],
          ['line', { x1: 14, y1: 32, x2: 50, y2: 32 }],
          ['line', { x1: 32, y1: 22, x2: 32, y2: 50 }]]
};
var THUMB_GLYPH_FALLBACK = 'OTHER';

/**
 * 「何の商品か」の一行: IP・カテゴリ（・詳細では販売方式）。
 * 値が無いときは行そのものを出さない（UNKNOWN のカテゴリ・販売方式は lbl が null を返す）。
 */
function identityMeta(p, withMode) {
  var out = [];
  if (!isUnknown(p.ip)) { out.push(String(p.ip)); }
  var cat = lbl(CATEGORY_LABEL, p.category);
  if (cat) { out.push(cat); }
  if (withMode) {
    var mode = lbl(SALE_MODE_LABEL, p.sale_mode);
    if (mode) { out.push(mode); }
  }
  return out;
}

function svgEl(name, attrs) {
  var node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (var key in attrs) {
    if (Object.prototype.hasOwnProperty.call(attrs, key)) {
      node.setAttribute(key, String(attrs[key]));
    }
  }
  return node;
}

/**
 * The product's drawn tile. Decorative: the category and the name sit beside it as text, and
 * the tile is aria-hidden so a screen reader is not told about a picture that carries nothing.
 *
 * `variant` only changes the size class; the drawing is identical, because the point of the
 * tile is that the card and the detail page show the SAME one.
 */
function productThumb(p, variant) {
  var key = own(THUMB_GLYPH, p.category) !== undefined ? String(p.category) : THUMB_GLYPH_FALLBACK;
  var hue = THUMB_HUES[idHash(p.product_id) % THUMB_HUES.length];
  var box = el('span', 'thumb' + (variant ? ' thumb--' + variant : ''));
  box.setAttribute('aria-hidden', 'true');
  var svg = svgEl('svg', { viewBox: '0 0 64 64', focusable: 'false', role: 'presentation' });
  svg.appendChild(svgEl('rect', {
    x: 0, y: 0, width: 64, height: 64, rx: 10,
    fill: 'hsl(' + hue + ', 44%, 90%)'
  }));
  /* A second, slightly rotated plane behind the glyph: it reads as a cropped photo would,
     without pretending to be one. */
  svg.appendChild(svgEl('path', {
    d: 'M0 46 L64 26 L64 64 L0 64 Z',
    fill: 'hsl(' + hue + ', 40%, 84%)'
  }));
  var strokes = own(THUMB_GLYPH, key);
  for (var i = 0; i < strokes.length; i++) {
    var node = svgEl(strokes[i][0], strokes[i][1]);
    node.setAttribute('fill', strokes[i][0] === 'line' ? 'none' : 'hsl(' + hue + ', 34%, 97%)');
    node.setAttribute('stroke', 'hsl(' + hue + ', 38%, 34%)');
    node.setAttribute('stroke-width', '2.6');
    node.setAttribute('stroke-linejoin', 'round');
    node.setAttribute('stroke-linecap', 'round');
    svg.appendChild(node);
  }
  box.appendChild(svg);
  return box;
}

/* ------------------------------------------------------------ product photo
   Product images: same-origin, square WebP, already cropped to the product by the build.
   Only a path that matches IMG_SRC_RE ever becomes a src — anything else (a URL, a
   protocol, a traversal, an upper-case name) is refused and the drawn tile is used. */

var IMG_SRC_RE = /^assets\/img\/[a-z0-9-]+\.webp$/;

/** The published image object when its src is a same-origin asset path, else null. */
function productImageOf(p) {
  var im = p && p.image;
  if (!im || typeof im !== 'object') { return null; }
  if (typeof im.src !== 'string' || !IMG_SRC_RE.test(im.src)) { return null; }
  return im;
}

/** Short source host for a card caption (「www.」 dropped; the detail page shows it whole). */
function imageHostShort(im) {
  if (isUnknown(im.source_host)) { return null; }
  return String(im.source_host).replace(/^www\./, '');
}

/** Full credit line for the detail page. Falls back to the host when credit_ja is missing. */
function imageCreditText(im) {
  if (!isUnknown(im.credit_ja)) { return String(im.credit_ja); }
  return isUnknown(im.source_host) ? null : '画像: ' + String(im.source_host);
}

function imgPx(v) {
  var n = num(v);
  return (n !== null && n > 0 && n <= 4096) ? Math.round(n) : 480;
}

/** One <img>. `decorative` gives alt="" (the collage and the blurred backdrop). */
function photoEl(p, im, className, decorative, eager) {
  var img = document.createElement('img');
  img.className = className;
  img.width = imgPx(im.width);
  img.height = imgPx(im.height);
  img.decoding = 'async';
  img.loading = eager ? 'eager' : 'lazy';
  if (decorative) {
    img.alt = '';
    img.setAttribute('aria-hidden', 'true');
  } else {
    img.alt = !isUnknown(im.alt_ja) ? String(im.alt_ja)
      : ((isUnknown(p.product_name) ? '' : String(p.product_name)) + 'の商品画像');
  }
  img.src = im.src;                         /* validated against IMG_SRC_RE above */
  return img;
}

/** The drawn tile inside a media frame, tinted with the tile's own hue. */
function fillWithTile(frame, p, note) {
  /* Only the photo parts go; anything overlaid on the frame (status badges) stays. */
  var gone = frame.querySelectorAll('.pmedia-img, .pmedia-backdrop, .pmedia-credit');
  for (var i = 0; i < gone.length; i++) { frame.removeChild(gone[i]); }
  frame.classList.remove('is-photo');
  frame.classList.add('is-tile');
  frame.style.setProperty('--tile-h', String(THUMB_HUES[idHash(p.product_id) % THUMB_HUES.length]));
  frame.insertBefore(productThumb(p, 'fill'), frame.firstChild);
  if (note) { frame.appendChild(el('span', 'pmedia-note', note)); }
}

/**
 * The product's picture in a frame. variant:
 *   'feed' — the image-led top of a highlight card (4:3, blurred backdrop, credit overlay)
 *   'card' — the square at the left of a list card / screener row
 *   'hero' — the large square on the detail page
 * A product without an image — or whose image fails to load — gets the drawn tile instead,
 * so every card still shows the same picture as its detail page.
 */
function productMedia(p, variant, opts) {
  opts = opts || {};
  var frame = el('span', 'pmedia pmedia--' + variant);
  var im = productImageOf(p);
  if (!im) {
    fillWithTile(frame, p, opts.tileNote || null);
    return frame;
  }
  frame.classList.add('is-photo');
  if (variant === 'feed') { frame.appendChild(photoEl(p, im, 'pmedia-backdrop', true, opts.eager)); }
  var img = photoEl(p, im, 'pmedia-img', false, opts.eager);
  img.addEventListener('error', function () {
    fillWithTile(frame, p, opts.tileNote || null);
    if (typeof opts.onFail === 'function') { opts.onFail(); }
  });
  frame.appendChild(img);
  if (opts.overlayCredit) {
    var host = imageHostShort(im);
    if (host) { frame.appendChild(el('span', 'pmedia-credit', shortCreditText(im, host))); }
  }
  return frame;
}

/** 「画像: host」 as a plain text line, for the card view where the photo is small. */
function creditLine(p, className) {
  var im = productImageOf(p);
  if (!im) { return null; }
  var host = imageHostShort(im);
  return host ? el('span', className, shortCreditText(im, host)) : null;
}

/** The compact credit a card can carry. Title art says so, on the card, not only on the detail page. */
function shortCreditText(im, host) {
  return im.kind === 'key_visual' ? ('タイトル画像（商品写真ではありません）・' + host) : ('画像: ' + host);
}

/**
 * One labelled cell. An unconfirmed value renders NOTHING: the cell comes back as an empty
 * `.cell.is-empty` slot with no label and no text. Card views hide the slot (style.css);
 * the desktop screener keeps it as an empty grid cell so its 7 columns stay aligned.
 */
function cell(extraClass, label, value) {
  var shown = shownText(value);
  if (shown === null) {
    var slot = el('div', 'cell is-empty ' + extraClass);
    slot.setAttribute('aria-hidden', 'true');
    return slot;
  }
  var wrap = el('div', 'cell ' + extraClass);
  wrap.appendChild(el('span', 'lbl', label));
  /* dates, 「あと32日」 and short （…） stay whole; lines break only between terms */
  wrap.appendChild(elKeep('span', 'val', shown));
  return wrap;
}

/** Same as cell(), but null instead of an empty slot — for layouts without columns. */
function cellIf(extraClass, label, value) {
  return shownText(value) === null ? null : cell(extraClass, label, value);
}

/** appendChild that ignores null, so an unrendered item leaves no trace. */
function put(parent, child) {
  if (child) { parent.appendChild(child); }
  return child;
}

/** The neutral 5-step evidence ladder. Never coloured as good or bad. null (nothing is
    rendered) when the step is not known — an empty ladder would read as 「0/5」. */
function profitLadder(p, withLabel) {
  var status = isUnknown(p.profit_evidence_status) ? null : String(p.profit_evidence_status);
  var idx = status === null ? -1 : PROFIT_LADDER.indexOf(status);
  if (idx < 0) { return null; }
  var box = el('div', 'ladder');
  var reached = idx + 1;
  box.setAttribute('role', 'img');
  var text = shownText(p.profit_evidence_label_ja) || PROFIT_STEP_LABEL[status];
  box.setAttribute('aria-label', '材料の集まり具合 ' + reached + '/5：' + String(text).replace(/（[^（）]*未[^（）]*）\s*$/, ''));
  for (var i = 0; i < PROFIT_LADDER.length; i++) {
    var step = el('span', 'ladder-step' + (i < reached ? ' is-reached' : ''));
    step.title = PROFIT_STEP_LABEL[PROFIT_LADDER[i]];
    box.appendChild(step);
  }
  if (!withLabel) { return box; }
  var wrap = el('div', 'ladder-wrap');
  wrap.appendChild(box);
  /* the step's own name only; a trailing 「（…未…）」 aside is not repeated here */
  wrap.appendChild(el('span', 'ladder-label', String(text).replace(/（[^（）]*未[^（）]*）\s*$/, '')));
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
    var basis = shownText(sigs[i].basis_ja);
    full.push(basis ? (text + '：' + basis) : text);
    if (max && shown >= max) { continue; }
    var chip = el('span', 'chip', text);
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
    '注目理由（' + full.length + '件）。' + full.join('／') + ' 注目理由の全文は詳細ページでご覧いただけます。');
  return box;
}

/** The 4-way mark control. `onPick` receives the chosen mark id. */
function markControl(productId, current, onPick, wrapClass) {
  var box = el('div', wrapClass || 'card-marks');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-label', 'あなたの印（このブラウザにだけ保存）');
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
  /* Only Japanese, reader-facing text is shown; anything else (a browser's own wording) is replaced. */
  if (!/[぀-ヿ一-鿿]/.test(String(message || ''))) {
    message = 'データを読み込めませんでした。時間をおいて再度お試しください。';
  }
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
        throw new Error(res.status === 404
          ? 'データのファイルが見つかりませんでした。時間をおいて再度お試しください。'
          : 'データを読み込めませんでした。時間をおいて再度お試しください。');
      }
      return res.text();
    }, function () {
      /* fetch itself failed (offline, blocked, server down): the browser's English text stays out */
      throw new Error('通信ができなかったため、データを受け取れませんでした。');
    })
    .then(function (text) {
      var doc;
      try { doc = JSON.parse(text); }
      catch (e) { throw new Error('データを正しく読み込めませんでした。時間をおいて再度お試しください。'); }
      if (!doc || typeof doc !== 'object' || !Array.isArray(doc.products)) {
        throw new Error('データの形式に問題があり、表示できませんでした。');
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
  /* A timestamp the document does not carry: the whole 更新日時 / 基準日 item is hidden. */
  [['generated-at', fmtGeneratedAt(doc.generated_at)], ['as-of', fmtDate(doc.as_of)]].forEach(function (pair) {
    var node = $(pair[0]);
    if (!node) { return; }
    var item = node.closest('.site-meta') || node;
    if (pair[1] === null) { item.hidden = true; return; }
    node.textContent = pair[1];
    item.hidden = false;
  });
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
    deadline: '', release: '', mark: '', sec: '', buy: '',
    onlyNew: false, onlyRestock: false, onlyAttention: false, sort: 'deadline'
  };

  /* ------------------------------------------------------------ URL <-> state */
  var URL_KEYS = {
    q: 'q', cat: 'cat', mode: 'mode', status: 'st', ev: 'ev', profit: 'pe',
    signal: 'sig', deadline: 'dl', release: 'rel', mark: 'mark', sec: 'sec', buy: 'buy',
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
    if (filters.buy && BUY_LEVELS.indexOf(filters.buy) === -1) { filters.buy = ''; }
    if (['deadline', 'buy', 'new', 'release', 'price', 'updated'].indexOf(filters.sort) === -1) {
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

  function renderMyCheck() {
    var counts = { CANDIDATE: 0, WATCH: 0, SKIP: 0 };
    state.products.forEach(function (p) {
      var mark = getMark(state.marks, p.product_id);
      if (Object.prototype.hasOwnProperty.call(counts, mark)) { counts[mark]++; }
    });
    var ids = {
      CANDIDATE: 'my-check-candidate',
      WATCH: 'my-check-watch',
      SKIP: 'my-check-skip'
    };
    Object.keys(ids).forEach(function (key) {
      var node = $(ids[key]);
      if (node) { node.textContent = String(counts[key]); }
    });
    var buttons = document.querySelectorAll('[data-mark-filter]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = !marksAvailable;
    }
  }

  /* ------------------------------------------------------------ card builder */

  /**
   * One product card. The same markup is used for the highlight sections and
   * for the dense desktop screener — only the parent's CSS grid template differs
   * (the dense mode places every cell on an explicit column, so the DOM may stay
   * in reading-priority order while the table stays in column order).
   *
   * The DOM order IS the information priority:
   *   L1 商品名
   *   L2 現在状態 / 締切 / 確認状況        <- where the eye must land first
   *   L3 定価 / 取得原価 / 発売日 / 販売方式 / 購入先
   *   L4 注目理由 / 確認の進み方 / 注目候補の理由 / 補足
   *   L5 判断ボタン (outside the anchor)
   */
  function buildCard(p) {
    var li = el('li', 'card' + (isUnverifiedRow(p) ? ' is-unverified' : ''));
    li.dataset.id = p.product_id;
    var a = el('a', 'card-main');
    a.href = 'product.html?id=' + encodeURIComponent(p.product_id);

    /* --- L1: タイル + 商品名。タイルは詳細ページの先頭と同じ絵で、同じ商品だと見て分かる --- */
    var idRow = el('div', 'c-ident');
    var nameBox = el('div', 'c-ident-text');
    var credit = creditLine(p, 'c-credit');
    idRow.appendChild(productMedia(p, 'card', {
      onFail: function () { if (credit && credit.parentNode) { credit.parentNode.removeChild(credit); } }
    }));
    if (!isUnknown(p.product_name)) { nameBox.appendChild(wordWrapText(el('div', 'c-name'), String(p.product_name))); }
    var cardMeta = identityMeta(p);
    if (cardMeta.length) { nameBox.appendChild(el('div', 'c-cat', cardMeta.join('・'))); }
    if (credit) { nameBox.appendChild(credit); }
    /* A drawn tile sits in the same column as real photos here, so it says what it is (audit F3). */
    if (!productImageOf(p)) { nameBox.appendChild(el('span', 'c-tile-note', '写真未掲載（カテゴリのイメージ図です）')); }
    put(nameBox, buyLine(p));
    idRow.appendChild(nameBox);
    a.appendChild(idRow);

    /* --- L2: 現在状態 (+ flags). An unconfirmed acceptance state has no badge at all. --- */
    var st = el('div', 'c-status');
    put(st, statusBadge(p));
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

    /* --- L2: 締切 — an unconfirmed acceptance state never gets the urgency colour.
           No deadline: an empty slot (screener column) / nothing (card). --- */
    var dText = null;
    if (!isUnknown(p.deadline)) {
      var kind = lbl(DEADLINE_KIND_LABEL, p.deadline_kind);
      dText = fmtDate(p.deadline) + (kind ? '（' + kind + '）' : '');
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

    /* --- L2: 確認状況 — an OUTLINE badge, never the filled state look --- */
    var ev = el('div', 'c-ev');
    put(ev, evidenceBadge(p));
    a.appendChild(ev);

    /* --- L3: 定価 — the published list price. NOT an acquisition price. --- */
    a.appendChild(cell('c-list-price', '定価', fmtPrice(listPriceOf(p))));

    /* --- L3: 取得原価 — only when a verified route price exists; otherwise not shown. --- */
    a.appendChild(cell('c-acq', '取得原価', fmtPrice(acquisitionCostOf(p))));

    /* --- L3: 発売日 — precision honest --- */
    a.appendChild(cell('c-release', '発売日', releaseText(p)));

    /* --- L3: 販売方式 --- */
    a.appendChild(cell('c-mode', '販売方式', lbl(SALE_MODE_LABEL, p.sale_mode)));

    /* --- L3: 当選発表 / 購入・応募上限 — published conditions, card view only --- */
    if (!isUnknown(p.result_date)) {
      a.appendChild(cell('c-result', '当選発表', fmtDate(p.result_date)));
    }
    put(a, cellIf('c-limit', '購入・応募上限：', p.purchase_limit));

    /* --- L3: 購入先 (no column in the dense screener; card view + detail page) --- */
    a.appendChild(cell('c-channel', '購入先',
      (Array.isArray(p.channel) && p.channel.length) ? p.channel.join('・') : null));

    /* --- L4: 注目理由 (opportunity signals — not a score) --- */
    var sigBox = el('div', 'c-signals');
    var chips = signalChips(p, 3);
    if (chips) {
      sigBox.appendChild(chips);
      /* Visible, not hover-only: a truncated chip must announce where its full text is. */
    }
    a.appendChild(sigBox);

    /* --- L4: 類似品バックテスト（参考） --- */
    /* (placed after the link below: it carries its own 「数え方」 link) */
    var cardBt = backtestLine(p);

    /* The 5-step 材料 ladder is NOT on cards: a meter on every card reads as a rating, and its
       first step only says that nothing has been collected yet. It lives on the detail page. */

    /* --- L4: 注目候補の理由 — build-provided only --- */
    var reasons = attentionReasonsOf(p);
    if (reasons.length) {
      var attn = el('div', 'c-attn');
      attn.appendChild(el('span', 'c-attn-lbl', '注目候補の理由'));
      attn.appendChild(el('span', 'c-attn-val', reasons.join('／')));
      a.appendChild(attn);
    }

    /* --- L4: 補足 — a note that only explains an unconfirmed state is not rendered --- */
    var note = shownText(p.status_note_ja);
    if (note !== null) { a.appendChild(el('div', 'c-note', note)); }

    li.appendChild(a);
    if (cardBt) { li.appendChild(cardBt); }

    li.appendChild(cardActions(p));

    /* Human decision marks — outside the anchor so the buttons are real buttons */
    var box = markControl(p.product_id, getMark(state.marks, p.product_id), onMarkPick);
    li.appendChild(box);
    if (!state.markBoxes[p.product_id]) { state.markBoxes[p.product_id] = []; }
    state.markBoxes[p.product_id].push(box);
    return li;
  }

  /* Action row: the detail page carries the full evidence (information first), while the
     external link is only rendered when the published URL passed the HTTPS safety gate. */
  function cardActions(p) {
    var actions = el('div', 'card-actions');
    var detailLink = el('a', 'card-action card-action--detail', '詳細を見る');
    detailLink.href = 'product.html?id=' + encodeURIComponent(p.product_id);
    actions.appendChild(detailLink);
    var ext = outboundCta(p, 'card-action card-action--ext');
    if (ext) { actions.appendChild(ext); }
    return actions;
  }

  /**
   * Feed card (highlight sections only). Reading order is the scan order:
   *   status + flags -> 商品名 -> 締切 (date | 残りN日) -> 定価 + 発売日
   *   -> 販売方式 + 確認状況 -> key signals -> CTAs -> 判断マーク
   * What a feed card leaves out lives on the detail page (and in 全商品一覧):
   * 購入先, the 5-step evidence ladder, 注目候補の理由, route evidence, notes.
   * 取得原価 stays, as a quiet secondary line under 定価.
   */
  function buildFeedCard(p) {
    var li = el('li', 'card card--feed' + (isUnverifiedRow(p) ? ' is-unverified' : ''));
    li.dataset.id = p.product_id;
    var a = el('a', 'card-main');
    a.href = 'product.html?id=' + encodeURIComponent(p.product_id);

    /* 0. the product itself, first: an image-led card is recognised before it is read.
          The status badges sit on the image's corner; the source host sits on its foot. */
    var media = productMedia(p, 'feed', { overlayCredit: true, tileNote: '写真未掲載（カテゴリのイメージ図です）' });
    a.appendChild(media);

    /* 1. flags on the image corner (新着 / 再販 / 注目候補); the acceptance state is read
          with the name, in the 「今どうなっているか」 row below */
    var st = el('div', 'c-status c-flags');
    if (p.is_new === true && state.showNewBadge) {
      st.appendChild(el('span', 'badge badge--flag', '新着'));
    }
    if (p.status !== 'RESTOCKED' && isRestockRow(p)) {
      st.appendChild(el('span', 'badge badge--restock', '再販'));
    }
    if (p.is_attention === true) {
      st.appendChild(el('span', 'badge badge--attention', '注目候補'));
    }
    if (st.children.length) { media.appendChild(st); }

    /* 2. 何か: 商品名 + カテゴリ（写真／タイルは詳細ページの先頭と同じ） */
    var fIdent = el('div', 'c-ident');
    var fText = el('div', 'c-ident-text');
    if (!isUnknown(p.product_name)) {
      var fName = wordWrapText(el('div', 'c-name'), String(p.product_name));
      fName.title = String(p.product_name);   /* clamped to two lines on feed cards */
      fText.appendChild(fName);
    }
    var feedMeta = identityMeta(p);
    if (feedMeta.length) { fText.appendChild(el('div', 'c-cat', feedMeta.join('・'))); }
    fIdent.appendChild(fText);
    a.appendChild(fIdent);
    put(a, buyLine(p));

    /* 3. 今買えるか: state badge (only when confirmed) + 販売方式 + 確認状況, one line */
    var now = el('div', 'f-now');
    var stBadge = statusBadge(p);
    if (stBadge) { now.appendChild(stBadge); }
    var modeTxt = lbl(SALE_MODE_LABEL, p.sale_mode);
    if (modeTxt) { now.appendChild(el('span', 'f-mode', modeTxt)); }
    var evBadge = evidenceBadge(p);
    if (evBadge) { evBadge.classList.add('f-ev'); now.appendChild(evBadge); }
    if (now.children.length) { a.appendChild(now); }

    /* 4. いつまで: DATE and RELATIVE as two pieces. Urgent styling only for a
          non-null closing_soon_band (isClosingSoonRow). No deadline: no box. */
    var parts = deadlineParts(p, state.doc && state.doc.as_of);
    if (parts) {
      var dl = el('div', 'f-deadline');
      dl.appendChild(el('span', 'f-lbl', parts.kind ? parts.kind : '締切'));
      if (parts.urgent) { dl.classList.add('is-urgent'); }
      else if (parts.soon) { dl.classList.add('is-soon'); }
      else if (parts.muted) { dl.classList.add('is-unconfirmed'); }
      var dateNode = el('span', 'f-date', parts.date);
      dateNode.setAttribute('aria-label', parts.fullDate || parts.date);
      dl.appendChild(dateNode);
      if (parts.rel) {
        dl.appendChild(el('span', 'f-rel' + (parts.passed ? ' is-passed' : ''), parts.rel));
      }
      a.appendChild(dl);
    }

    /* 5. 定価 + 発売日 (取得原価 as a secondary line — never the list price, and only when
          a verified amount exists) */
    var row1 = el('div', 'f-row');
    var listP = fmtPrice(listPriceOf(p));
    var acq = fmtPrice(acquisitionCostOf(p));
    if (listP !== null) {
      var price = cell('c-list-price', '定価', listP);
      if (acq !== null) { price.appendChild(el('span', 'f-sub', '取得原価 ' + acq)); }
      row1.appendChild(price);
    } else if (acq !== null) {
      row1.appendChild(cell('c-acq', '取得原価', acq));
    }
    put(row1, cellIf('c-release', '発売日', releaseText(p)));
    if (row1.children.length) { a.appendChild(row1); }

    /* 5b. 応募条件 — published dates and limits only, never a chance of winning */
    var facts = entryFacts(p);
    if (facts) { a.appendChild(facts); }

    /* 5c. key signals — two chips, full text in aria-label and on the detail page */
    var chips = signalChips(p, 2);
    if (chips) {
      var sigBox = el('div', 'c-signals');
      sigBox.appendChild(chips);
      a.appendChild(sigBox);
    }

    /* 6. 似た商品の結果（参考） — last, and only when an analog could be evaluated. Outside the
          card link, because it carries its own 「数え方」 link. */
    var btl = backtestLine(p);

    /* status_note_ja: clamped, full text on the detail page; a note that only says the
       state is unconfirmed is not rendered */
    var fNote = shownText(p.status_note_ja);
    if (fNote !== null) { a.appendChild(el('div', 'c-note', fNote)); }


    li.appendChild(a);
    if (btl) { li.appendChild(btl); }
    li.appendChild(cardActions(p));

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
    renderMyCheck();
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
      if (filters.buy && (buySignalOf(p) || {}).level !== filters.buy) { return false; }
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
  /** 買いの目安順: level order, then (for 判断材料不足) the fewest missing pieces first. */
  function buyRank(p) {
    var b = buySignalOf(p);
    if (!b) { return [9, 9, 0]; }
    var missing = Array.isArray(b.missing_ja) ? b.missing_ja.length : 0;
    var noData = b.level === 'NOT_ENOUGH_EVIDENCE' && !(num(b.analogs_evaluable) > 0) ? 1 : 0;
    return [BUY_LEVELS.indexOf(b.level), noData, missing, -(num(b.analogs_evaluable) || 0)];
  }
  function cmpBuy(a, b) {
    var ra = buyRank(a), rb = buyRank(b);
    for (var i = 0; i < ra.length; i++) { if (ra[i] !== rb[i]) { return ra[i] - rb[i]; } }
    return cmpDeadline(a, b);
  }
  function sortRows(rows) {
    var copy = rows.slice();
    switch (filters.sort) {
      case 'buy': copy.sort(cmpBuy); break;
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

  /* 買いの目安 panel: four counts (each a filter), an honest headline, and the products
     closest to a signal with what they still need. */
  function renderBuyPanel() {
    var panel = $('buy-panel');
    if (!panel) { return; }
    var counts = {};
    BUY_LEVELS.forEach(function (l) { counts[l] = 0; });
    state.products.forEach(function (p) { var b = buySignalOf(p); if (b) { counts[b.level] += 1; } });
    BUY_LEVELS.forEach(function (l) {
      var n = $('buy-n-' + l);
      if (n) { n.textContent = String(counts[l]); }
      var btn = panel.querySelector('[data-buy="' + l + '"]');
      if (btn) { btn.setAttribute('aria-pressed', filters.buy === l ? 'true' : 'false'); }
    });
    var head = $('buy-headline');
    var decided = counts.LEAN_BUY + counts.MIXED_SIGNALS + counts.LEAN_SKIP;
    if (head) {
      head.textContent = counts.LEAN_BUY > 0
        ? '「買い寄り」は ' + counts.LEAN_BUY + ' 件です。条件（定価で買えた場合・送料などは差し引いていない）もあわせてご確認ください。'
        : (decided > 0
          ? '今の時点で「買い寄り」と言える商品はありません。判定が出ている商品は下のボタンから確認できます。'
          : '今の時点で、買い・見送りを判定できる商品はまだありません。判定に近い商品と、足りない根拠は下のとおりです。');
    }
    var list = $('buy-near');
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }
    var near = state.products.filter(function (p) {
      var b = buySignalOf(p);
      return b && b.level === 'NOT_ENOUGH_EVIDENCE' && num(b.analogs_evaluable) > 0;
    }).sort(cmpBuy).slice(0, 5);
    var wrap = $('buy-near-wrap');
    if (wrap) { wrap.hidden = near.length === 0; }
    near.forEach(function (p) {
      var b = buySignalOf(p);
      var li = el('li', 'buy-near-item');
      var a = el('a', 'buy-near-link');
      a.href = 'product.html?id=' + encodeURIComponent(p.product_id);
      a.appendChild(wordWrapText(el('span', 'buy-near-name'), String(p.product_name || '')));
      a.appendChild(el('span', 'buy-near-miss', (b.missing_ja || []).join('／')));
      li.appendChild(a);
      list.appendChild(li);
    });
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
    [['kpi-total', total], ['kpi-open', open], ['kpi-closing', closing], ['kpi-new', newCount]].forEach(function (kv) {
      var btn = $(kv[0]) && $(kv[0]).closest('.kpi');
      if (!btn) { return; }
      btn.classList.toggle('is-zero', kv[1] === 0);
      /* a count equal to the whole list (e.g. 新着 while every item is new) carries no signal */
      btn.classList.toggle('is-all', kv[0] !== 'kpi-total' && kv[1] === total && total > 0);
    });
    syncKpiPressed();
  }

  /**
   * 予約・抽選 card: two published counters shown side by side, never summed.
   * Each links to the section that owns the identical predicate; the local fallback
   * is that section's own pick, so the number and the section can never differ.
   */
  function renderReserveKpi() {
    var pre = sectionById('sec-preorder');
    var lot = sectionById('sec-lottery');
    var preorder = pick(statNum('counts', 'open_preorder'), pre ? derived(pre.pick) : null);
    var lottery = pick(statNum('counts', 'open_lottery'), lot ? derived(lot.pick) : null);
    var a = $('kpi-preorder');
    if (a) { a.textContent = String(preorder); }
    var b = $('kpi-lottery');
    if (b) { b.textContent = String(lottery); }
    if (a) { a.closest('.kpi-split-item').classList.toggle('is-zero', preorder === 0); }
    if (b) { b.closest('.kpi-split-item').classList.toggle('is-zero', lottery === 0); }
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
      /* An option is offered only for a value that has a displayable label: UNKNOWN (and a
         status whose label says it is unconfirmed) is not a choice on the page. */
      if (lbl(CATEGORY_LABEL, p.category) && cats.indexOf(p.category) === -1) { cats.push(p.category); }
      if (lbl(SALE_MODE_LABEL, p.sale_mode) && modes.indexOf(p.sale_mode) === -1) { modes.push(p.sale_mode); }
      if (hasShownStatus(p) && statuses.indexOf(p.status) === -1) {
        statuses.push(p.status);
        statusLabels[p.status] = String(p.status_label_ja);
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
    fillSelect(statusSel, statuses, function (v) { return statusLabels[v]; });
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
    { id: 'sec-nearterm', name: '期日が7日以内（締切間近以外）', sort: cmpDeadline,

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
      pick: function (p) { return p.is_attention === true; } },
    /* Sorted by deadline like every other section — deliberately NOT by headroom, which
       would turn a reference measure into a ranking. */
    { id: 'sec-backtest', name: '類似品の過去相場あり', sort: cmpDeadline, pick: hasEvaluableBacktest }
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
      root.classList.toggle('is-empty', rows.length === 0);
      if (moreBtn) {
        moreBtn.hidden = rows.length <= SECTION_CAP;
        moreBtn.textContent = 'すべて見る（' + rows.length + '件）';
      }
      if (rows.length === 0) { return; }
      var shown = rows.slice(0, SECTION_CAP);
      /* 1 / 2 / many — the grid sizes itself to what it holds (style.css), so a
         one-item section is a readable card, not a third of an empty row. */
      list.dataset.count = shown.length > 3 ? 'many' : String(shown.length);
      var frag = document.createDocumentFragment();
      shown.forEach(function (p) { frag.appendChild(buildFeedCard(p)); });
      list.appendChild(frag);
      if (rows.length > SECTION_CAP && count) {
        count.textContent = '全' + rows.length + '件中 ' + shown.length + '件を表示';
      }
    });
  }

  /**
   * Hero collage: real product photos from the data, purely decorative (aria-hidden, alt="").
   * Accepting / closing rows first, then rows with a backtest, then 注目候補, then upcoming —
   * an ORDER OF RELEVANCE TO TODAY, not a ranking: nothing here is labelled or counted.
   * One photo per source site on the first pass so the strip is not six colour variants
   * of one keychain.
   */
  var COLLAGE_MAX = 7;
  function collageTier(p) {
    if (isOpenStatus(p)) { return 0; }
    if (hasEvaluableBacktest(p)) { return 1; }
    if (p.is_attention === true) { return 2; }
    if (p.status === 'RESULT_PENDING' || p.status === 'NOT_STARTED') { return 3; }
    return 4;
  }
  function renderHeroCollage() {
    var box = $('hero-collage');
    if (!box) { return; }
    box.textContent = '';
    var pool = state.products.filter(function (p) { return productImageOf(p) !== null; })
      .sort(function (a, b) {
        var d = collageTier(a) - collageTier(b);
        if (d) { return d; }
        return a.product_id < b.product_id ? -1 : 1;
      });
    var picked = [];
    var seenHost = {};
    var seenIp = {};
    pool.forEach(function (p) {
      if (picked.length >= COLLAGE_MAX) { return; }
      var host = String(productImageOf(p).source_host || '');
      var ip = String(p.ip || '');
      if (seenHost[host] || (ip && seenIp[ip])) { return; }
      seenHost[host] = true;
      if (ip) { seenIp[ip] = true; }
      picked.push(p);
    });
    pool.forEach(function (p) {
      if (picked.length >= COLLAGE_MAX || picked.indexOf(p) !== -1) { return; }
      picked.push(p);
    });
    if (picked.length < 3) { box.hidden = true; return; }
    box.dataset.count = String(picked.length);
    picked.forEach(function (p, i) {
      var tile = el('span', 'hc-tile hc-tile--' + (i + 1));
      var img = photoEl(p, productImageOf(p), 'hc-img', true, i < 3);
      img.addEventListener('error', function () {
        if (tile.parentNode) { tile.parentNode.removeChild(tile); }
      });
      tile.appendChild(img);
      box.appendChild(tile);
    });
    box.hidden = false;
  }

  /**
   * The hero's one primary action points at the first confirmed-open section that actually
   * has items (same order as the feed), so it never leads to an empty box. With none, it
   * leads to the full list and the secondary link is dropped.
   */
  var PRIMARY_TARGETS = [
    ['sec-closing', '締切が近い商品を見る'], ['sec-lottery', '受付中の抽選を見る'],
    ['sec-preorder', '受付中の予約を見る'], ['sec-buyable', 'いま購入できる商品を見る']
  ];
  function renderPrimaryAction() {
    var btn = $('hero-primary');
    var alt = $('hero-secondary');
    if (!btn) { return; }
    for (var i = 0; i < PRIMARY_TARGETS.length; i++) {
      var sec = sectionById(PRIMARY_TARGETS[i][0]);
      var n = sec ? state.products.filter(sec.pick).length : 0;
      if (n > 0) {
        btn.href = '#' + PRIMARY_TARGETS[i][0];
        btn.textContent = PRIMARY_TARGETS[i][1] + '（' + n + '件）';
        return;
      }
    }
    btn.href = '#sec-all';
    btn.textContent = '全商品から探す';
    if (alt) { alt.hidden = true; }
  }

  /** 「数え方」 under the 類似品 section note, the same text as on every detail page. */
  function mountHowCounted() {
    var root = $('sec-backtest');
    var note = root && root.querySelector('.sec-note');
    if (!note || root.querySelector('.howcount')) { return; }
    var first = null;
    state.products.forEach(function (p) { if (!first && hasEvaluableBacktest(p)) { first = backtestOf(p); } });
    note.parentNode.insertBefore(howCounted(first ? { fee_rate: first.fee_rate } : null, 'how-counted'), note.nextSibling);
  }

  /**
   * A swipe row (phones) is a scroll container: it gets a tab stop and a name so it can be
   * scrolled with the arrow keys. On wide screens the same list is a plain grid: no tab stop.
   */
  function syncRails() {
    var lists = document.querySelectorAll('.sec [data-sec-list]');
    for (var i = 0; i < lists.length; i++) {
      var ul = lists[i];
      var sec = ul.closest('.sec');
      var title = sec ? sec.querySelector('.sec-title') : null;
      if (ul.children.length && ul.scrollWidth > ul.clientWidth + 4) {
        ul.setAttribute('tabindex', '0');
        var name = '';
        if (title) {
          for (var c = 0; c < title.childNodes.length; c++) {
            if (title.childNodes[c].nodeType === 3) { name += title.childNodes[c].textContent; }
          }
        }
        ul.setAttribute('aria-label', (name.trim() || '商品') + '（横にスクロールできます）');
        ul.classList.add('is-rail');
      } else {
        ul.removeAttribute('tabindex');
        ul.removeAttribute('aria-label');
        ul.classList.remove('is-rail');
      }
    }
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

  /**
   * 詳細な絞り込み group. Presentation only: it reports how many of the grouped
   * controls are away from their default and opens the group when any of them is,
   * so a filter can never be active while its control is folded out of sight.
   * It reads `filters`; it never writes one.
   */
  var ADV_KEYS = ['profit', 'signal', 'deadline', 'release', 'mark', 'buy'];
  function renderAdvancedState() {
    var box = $('tb-adv');
    var label = $('tb-adv-state');
    if (!box || !label) { return; }
    var active = 0;
    ADV_KEYS.forEach(function (k) { if (filters[k]) { active++; } });
    if (filters.sort !== 'deadline') { active++; }
    if (filters.onlyNew) { active++; }
    if (filters.onlyRestock) { active++; }
    if (filters.onlyAttention) { active++; }
    label.textContent = active === 0 ? '未設定' : (active + '項目を設定中');
    if (active === 0) { label.classList.remove('is-active'); }
    else { label.classList.add('is-active'); box.open = true; }
  }

  /** The corpus size beside 全商品一覧 — the same published total the KPI shows. */
  function renderAllCount() {
    var node = $('all-count');
    if (!node) { return; }
    var total = pick(statNum('counts', 'total'), state.products.length);
    node.textContent = '全' + total + '件';
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
    renderAdvancedState();
    syncKpiPressed();
    renderBuyPanel();
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
    $('f-buy').value = filters.buy;
    $('f-sort').value = filters.sort;
    $('f-new').checked = filters.onlyNew;
    $('f-restock').checked = filters.onlyRestock;
    $('f-attn').checked = filters.onlyAttention;
    /* A value coming from the URL may not be a real option — fall back to すべて. */
    var selects = { 'f-cat': 'cat', 'f-mode': 'mode', 'f-status': 'status', 'f-ev': 'ev',
      'f-profit': 'profit', 'f-signal': 'signal', 'f-deadline': 'deadline',
      'f-release': 'release', 'f-mark': 'mark', 'f-buy': 'buy', 'f-sort': 'sort' };
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
    filters.buy = $('f-buy').value;
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
    filters.release = ''; filters.mark = ''; filters.sec = ''; filters.buy = '';
    filters.onlyNew = false; filters.onlyRestock = false; filters.onlyAttention = false;
  }

  function wireControls() {
    var form = $('toolbar');
    form.addEventListener('submit', function (e) { e.preventDefault(); });
    ['f-q', 'f-cat', 'f-mode', 'f-status', 'f-ev', 'f-profit', 'f-signal', 'f-deadline',
      'f-release', 'f-mark', 'f-buy', 'f-sort', 'f-new', 'f-restock', 'f-attn'].forEach(function (id) {
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

    /* 買いの目安 tiles: one tap filters the full list to that level, sorted by the signal. */
    var buyJumps = document.querySelectorAll('[data-buy]');
    for (var k = 0; k < buyJumps.length; k++) {
      buyJumps[k].addEventListener('click', function (e) {
        var level = e.currentTarget.dataset.buy || '';
        var again = filters.buy === level;
        clearFilters();
        filters.buy = again ? '' : level;
        filters.sort = 'buy';
        syncControlsFromFilters(); writeUrl(); renderList(); renderBuyPanel();
        var target = $('sec-all');
        if (target) { target.scrollIntoView({ block: 'start' }); }
      });
    }

    var markJumps = document.querySelectorAll('[data-mark-filter]');
    for (var j = 0; j < markJumps.length; j++) {
      markJumps[j].addEventListener('click', function (e) {
        if (!marksAvailable) { return; }
        clearFilters();
        filters.mark = e.currentTarget.dataset.markFilter || '';
        syncControlsFromFilters();
        writeUrl();
        renderList();
        var target = $('sec-all');
        if (target) { target.scrollIntoView({ block: 'start' }); }
      });
    }

    /* KPI tiles act as one-tap filters into the full list. Each one maps to the
       same predicate the KPI counts, so the number and the list always agree. */
    var kpis = document.querySelectorAll('.kpi');
    for (var i = 0; i < kpis.length; i++) {
      kpis[i].addEventListener('click', function (e) {
        var kind = e.currentTarget.dataset.kpi;
        /* A zero leads to the section that explains the zero (and links onward), never to a
           filtered list with nothing in it; a count equal to the whole list leads to its section. */
        if (e.currentTarget.classList.contains('is-zero') || e.currentTarget.classList.contains('is-all')) {
          var why = $(kind === 'closing' ? 'sec-closing' : (kind === 'open' ? 'sec-buyable' : 'sec-new'));
          if (why) { why.scrollIntoView({ block: 'start' }); }
          return;
        }
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
        renderBuyPanel();
        renderReserveKpi();
        renderKpiNote();
        renderMyCheck();
        renderAllCount();
        buildSelects();
        readUrl();
        syncControlsFromFilters();
        wireControls();
        wireSectionMoreButtons();
        renderHeroCollage();
        renderSections();
        renderPrimaryAction();
        mountHowCounted();
        renderList();
        if (!marksAvailable) {
          var note = document.querySelector('#sec-all .note-line');
          if (note) {
            note.textContent = 'お使いのブラウザの設定により、印を保存できません。';
          }
        }
        $('loading').hidden = true;
        $('app').hidden = false;
        /* measured only once the list is laid out (a hidden list has no scroll width) */
        syncRails();
        window.addEventListener('resize', syncRails);
      });
  }).catch(function (err) {
    showError(err && err.message ? err.message : 'データを読み込めませんでした。時間をおいて再度お試しください。');
  });
}

/* ========================================================================= */
/*  PRODUCT DETAIL PAGE                                                      */
/* ========================================================================= */

function initProduct() {
  var marks = readMarks();

  /**
   * Definition-list row. `valueNode` overrides the plain-text rendering. An unconfirmed
   * value (null, or text that declares itself unconfirmed) renders NO row: no label, no
   * placeholder. Returns true when a row was rendered.
   */
  function row(dl, label, value, valueNode) {
    var dd;
    if (valueNode) {
      dd = el('dd');
      dd.appendChild(valueNode);
    } else {
      var shown = shownText(value);
      if (shown === null) { return false; }
      dd = elKeep('dd', null, shown);
    }
    var wrap = document.createElement('div');
    wrap.appendChild(el('dt', null, label));
    wrap.appendChild(dd);
    dl.appendChild(wrap);
    return true;
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
  /** The group's node when at least one row was rendered, else null: a group whose every
      item was unconfirmed is omitted whole (and so never reaches the contents list). */
  function groupIfAny(g) {
    return g.dl.children.length ? g.node : null;
  }

  /** A price the reader can act on, with its meaning spelled out. Only confirmed prices are
      rendered; with neither 定価 nor a verified 取得原価 there is no price block. */
  function pricePair(p) {
    var items = [];
    var listPrice = fmtPrice(listPriceOf(p));
    var acq = fmtPrice(acquisitionCostOf(p));
    if (listPrice !== null) { items.push([shownText(p.list_price_label_ja) || '定価', listPrice]); }
    if (acq !== null) { items.push(['取得原価', acq]); }
    if (!items.length) { return null; }
    var box = el('div', 'price-pair');
    items.forEach(function (pair) {
      var item = el('div', 'price-item');
      item.appendChild(el('span', 'price-lbl', pair[0]));
      item.appendChild(el('span', 'price-val', pair[1]));
      box.appendChild(item);
    });
    return box;
  }

  /** The note under the prices. It explains only the prices that are actually on the page. */
  function priceNoteText(p) {
    var hasList = listPriceOf(p) !== null;
    var hasAcq = acquisitionCostOf(p) !== null;
    if (hasList && hasAcq) {
      return '「定価」はメーカーなどが公式に発表した価格で、仕入れ値ではありません。' +
        '「取得原価」は、購入経路ごとに金額の裏付けが取れた金額です。';
    }
    if (hasList) { return '「定価」はメーカーなどが公式に発表した価格で、仕入れ値ではありません。'; }
    if (hasAcq) { return '「取得原価」は、購入経路ごとに金額の裏付けが取れた金額です。定価とは別のものです。'; }
    return null;
  }

  /* Fallback only: the build sends horizon_label_ja. A code with no wording renders nothing. */
  function horizonText(v) {
    if (isUnknown(v)) { return null; }
    var got = own(HORIZON_LABEL, v);
    return got === undefined ? null : got;
  }
  function horizonOf(o) {
    return shownText(o.horizon_label_ja) || horizonText(o.horizon);
  }

  /** 供給制約: the signals, each with its basis in plain Japanese. null when no signal can be
      shown — 「注目理由は未確認」 is not a reason, so the whole group is left out. */
  function buildSignalsBlock(p) {
    var g = group('注目理由（販売方法・取引実績）', true);
    var ul = el('ul', 'sig-list');
    var sigs = signalsOf(p);
    sigs.forEach(function (s) {
      var text = signalText(s);
      if (text === null) { return; }
      var li = el('li');
      li.appendChild(el('span', 'sig-name', text));
      var basis = shownText(s.basis_ja);
      if (basis !== null) { li.appendChild(el('span', 'sig-basis', basis)); }
      ul.appendChild(li);
    });
    if (ul.children.length === 0) { return null; }
    row(g.dl, '注目理由', null, ul);
    if (p.is_attention === true) {
      var reasons = attentionReasonsOf(p);
      if (row(g.dl, '注目候補', reasons.length ? reasons.join('／') : null)) {
        row(g.dl, '注目候補の意味', null,
          el('span', 'plain-note',
            '裏付けのある情報がそろった商品に付けている印です。おすすめや期待値を示すものではありません。'));
      }
    }
    return g.node;
  }

  /** 過去の成約Evidence: the ladder, its counters, and a DIFFERENT product's prices. null when
      none of them is known (the explanatory note alone is not a section). */
  function buildProfitBlock(p, btNode) {
    var g = group('利益を考えるための材料', true);
    /* The ladder is shown only once it has moved past its first step: 「まだ集めていません」 is
       not information, and a meter at step one reads like a low rating. */
    var any = false;
    if (p.profit_evidence_status && p.profit_evidence_status !== PROFIT_LADDER[0]) {
      any = row(g.dl, '材料の集まり具合', null, profitLadder(p, true));
    }
    var noteRow = document.createElement('div');
    noteRow.appendChild(el('dt', null, '補足'));
    var noteDd = el('dd');
    noteDd.appendChild(el('span', 'plain-note', PROFIT_NOTE_JA));
    noteRow.appendChild(noteDd);
    g.dl.appendChild(noteRow);
    var d = (p.profit_evidence_detail && typeof p.profit_evidence_detail === 'object')
      ? p.profit_evidence_detail : null;
    if (d) {
      PROFIT_DETAIL_ORDER.forEach(function (k) {
        if (!(k in d)) { return; }
        if (row(g.dl, PROFIT_DETAIL_LABEL[k], fmtCount(d[k]))) { any = true; }
      });
    }
    var refs = Array.isArray(p.historical_price_evidence) ? p.historical_price_evidence : [];
    refs = refs.filter(function (r) { return r && typeof r === 'object'; });
    if (refs.length) {
      /* One compact table instead of a card per record: same numbers, a fraction of the height.
         An unknown cell stays EMPTY (the column stays), never 0 or a placeholder. */
      var box = el('div', 'cmp-box');
      box.appendChild(el('p', 'warn-inline',
        '以下は、比較のために選んだ' +
        '別の商品（類似品）が過去に取引された価格で、この商品の価格ではありません。' +
        '利益や販売価格の見込みを示すものでもありません。'));
      var tbl = el('table', 'cmp-table');
      var thr = el('tr');
      ['類似品', '期間', '取引件数', '中央値', '最安〜最高'].forEach(function (h) {
        var th = el('th', null, h);
        th.setAttribute('scope', 'col');
        thr.appendChild(th);
      });
      var thd = el('thead');
      thd.appendChild(thr);
      tbl.appendChild(thd);
      var tb = el('tbody');
      var lastName = null;
      refs.forEach(function (r) {
        var cname = shownText(r.comparable_name);
        var period = horizonOf(r);
        var cnt = fmtCount(r.sample_count);
        var med = fmtPrice(r.median_price_jpy);
        var lo = fmtPrice(r.minimum_price_jpy), hi = fmtPrice(r.maximum_price_jpy);
        if (period === null && cnt === null && med === null && lo === null && hi === null) { return; }
        var status = lblOf(r, 'sample_status_label_ja', PRICE_SAMPLE_STATUS_LABEL, 'sample_status');
        var thin = r.sample_status === 'LOW_SAMPLE' || r.sample_status === 'INSUFFICIENT';
        var tr = el('tr', thin ? 'is-thin' : null);
        var th = el('th', cname === lastName ? 'is-repeat' : null, cname === lastName ? '' : (cname || ''));
        if (cname === lastName && cname) { th.appendChild(el('span', 'visually-hidden', cname)); }
        th.setAttribute('scope', 'row');
        lastName = cname;
        tr.appendChild(th);
        tr.appendChild(el('td', null, period || ''));
        tr.appendChild(el('td', 'num', cnt === null ? '' : cnt + (thin && status ? '・' + status : '')));
        tr.appendChild(el('td', 'num', med || ''));
        tr.appendChild(el('td', 'num', (lo && hi) ? (lo === hi ? lo : lo + '〜' + hi) : (lo || hi || '')));
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      labelCells(tbl);
      if (tb.children.length) {
        var det = el('details', 'cmp-details');
        det.appendChild(el('summary', null, '類似品の取引価格の記録（' + tb.children.length + '件）を開く'));
        var sc = el('div', 'pchart-scroll');
        sc.appendChild(tbl);
        det.appendChild(sc);
        box.appendChild(det);
        row(g.dl, '類似品の過去の取引価格', null, box);
        any = true;
      }
    }
    if (any) {
      var hc = btNode ? btNode.querySelector('#how-counted') : null;
      if (hc) {
        var lk = el('a', 'howcount-link', '数え方を見る');
        lk.href = '#how-counted';
        g.node.insertBefore(lk, g.dl);
      } else {
        g.node.appendChild(howCounted(backtestOf(p), 'how-counted'));
      }
    }
    return any ? g.node : null;
  }

  /** 取得経路の状況: a SHADOW model, never connected to a profit calculation. Only verified
      routes are shown; with none, the block is left out. */
  function buildRouteBlock(p) {
    var re = (p.route_evidence && typeof p.route_evidence === 'object') ? p.route_evidence : null;
    if (!re) { return null; }
    var routes = Array.isArray(re.routes) ? re.routes.filter(function (r) {
      return r && typeof r === 'object' && r.evidence_status === ROUTE_SHOWN_STATUS;
    }) : [];
    if (routes.length === 0) { return null; }
    var g = group('類似品の購入経路（参考）', true);
    row(g.dl, '読み方', null, el('span', 'warn-inline',
      'ここに載せている経路と金額は、比較に使った別の商品（類似品）のものです。' +
      'この商品の取得原価としては使えません。'));
    if (re.shadow_only !== false) {
      row(g.dl, '取り扱い', null, el('span', 'warn-inline',
        'なお、これは試算用の参考データで、利益の計算には一切' +
        '使っていません。参考としてご覧ください。'));
    }
    row(g.dl, ROUTE_SHOWN_TITLE, null, routeList(routes));
    return g.node;
  }

  function routeList(rows) {
    var box = el('div', 'route-box');
    rows.forEach(function (r) {
      var item = el('div', 'route-item');
      /* A route belongs to a COMPARABLE product, not to the product on this page. Naming it
         first is a correctness requirement: without it a 240 yen pack appears to have a
         5,280 yen acquisition route of its own. Without a name it still says 類似品. */
      var cname = shownText(r.comparable_name);
      item.appendChild(el('div', 'route-owner', cname ? ('類似品: ' + cname) : '類似品'));
      var head = lblOf(r, 'route_class_label_ja', ROUTE_CLASS_LABEL, 'route_class');
      if (head) { item.appendChild(el('div', 'route-head', head)); }
      var dl = el('dl', 'kv kv--tight');
      row(dl, '販売店', r.retailer);
      row(dl, '購入方法', r.purchase_mechanism);
      /* Each end of the window only when it is known; an open end is never printed as a gap. */
      var from = fmtDate(r.available_from), until = fmtDate(r.available_until);
      if (from && until) { row(dl, '入手できた期間', from + ' 〜 ' + until); }
      else {
        row(dl, '入手できるようになった日', from);
        row(dl, '入手できた最後の日', until);
      }
      /* Never substitute the list price here. A claim printed on the source page and an
         amount backed by a provenance record are two different things, so they get
         two rows and the claim is always named as a claim. */
      row(dl, '取得価格（確認できた金額）', fmtPrice(num(r.acquisition_price_jpy)));
      var claim = num(r.acquisition_price_claim_jpy);
      if (claim !== null) {
        row(dl, '取得価格（出典の記載値）', fmtPrice(claim) + '（出典に載っていた金額で、未検証です）');
      }
      row(dl, '送料', fmtPrice(num(r.acquisition_shipping_jpy)));
      if (num(r.acquisition_shipping_jpy) !== null) {
        row(dl, '送料の適用範囲', r.acquisition_shipping_note_ja);
      }
      row(dl, '確認状況', lblOf(r, 'evidence_status_label_ja', ROUTE_STATUS_LABEL, 'evidence_status'));
      item.appendChild(dl);
      box.appendChild(item);
    });
    return box;
  }

  /**
   * 類似品バックテスト（参考）. Shows every analog with collected sales, including the ones
   * too thin to evaluate, so that a thin loser is visible next to the winners rather than
   * dropped. An analog whose sales were never collected has no confirmed figure and is not
   * listed; a backtest left with nothing to show is not rendered at all.
   */
  function buildBacktestBlock(p) {
    var bt = backtestOf(p);
    if (!bt) { return null; }
    var analogs = (bt.analogs || []).filter(function (a) {
      return a && typeof a === 'object' && num(a.strict_sales) !== null;
    });
    if (!hasEvaluableBacktest(p) && analogs.length === 0) { return null; }
    var g = group('類似品の過去相場（参考）', true);
    g.node.classList.add('bt-block');
    /* Lead: 「何件中何件」 per period, counts only, then how the counting works. */
    var lead = evidenceLead(bt);
    if (lead) { g.node.insertBefore(lead, g.dl); }
    g.node.insertBefore(howCounted(bt, 'how-counted'), g.dl);
    var head = el('div', 'bt-head');
    var result = shownText(bt.result_label_ja);
    if (result !== null) { head.appendChild(el('p', 'bt-result', result)); }
    var kpis = el('div', 'bt-kpis');
    function kpi(label, value) {
      if (value === null) { return; }
      var k = el('div', 'bt-kpi');
      k.appendChild(el('span', 'bt-kpi-lbl', label));
      k.appendChild(elKeep('span', 'bt-kpi-val', value));
      kpis.appendChild(k);
    }
    var unitTxt = (bt.analog_units || []).length ? bt.analog_units.join('・') : null;
    /* evaluable / linked: both are published counts; the denominator counts every linked
       analog, including the ones without collected sales that are not listed below. */
    kpi('比べられた類似品', (num(bt.analogs_evaluable) === null || num(bt.analogs_linked) === null) ? null :
      String(bt.analogs_evaluable) + ' / ' + String(bt.analogs_linked) + '件');
    var ratio = backtestMedianRatio(bt);
    kpi('定価に対する倍率（中央値）', ratio === null ? null : ratio.toFixed(2) + '倍');
    kpi('定価との差額（中央値' + (unitTxt ? '・類似品の' + unitTxt + 'あたり' : '') + '）', fmtSignedYen(bt.median_headroom_jpy));
    kpi('定価との差額（最も低い例' + (unitTxt ? '・類似品の' + unitTxt + 'あたり' : '') + '）', fmtSignedYen(bt.worst_headroom_jpy));
    if (kpis.children.length) { head.appendChild(kpis); }
    var unitNote = shownText(bt.unit_note_ja);
    if (unitNote !== null) { head.appendChild(el('p', 'bt-unit', unitNote)); }
    if (head.children.length) { g.node.insertBefore(head, g.dl); }

    var chart = buildTrendChart(bt);
    if (chart) { g.node.insertBefore(chart, g.dl); }

    var fee = num(bt.fee_rate);
    var btHorizon = horizonOf(bt);
    g.node.insertBefore(el('p', 'bt-def',
      '定価との差額は、類似品の取引価格から販売手数料' + (fee === null ? '' : '（' + Math.round(fee * 100) + '%）') +
      'を引き、さらに類似品の定価を差し引いた金額です。送料や梱包などの費用はまだ確認できていないため、利益ではありません。' +
      '費用がこの額を超えると赤字になる、という上限の目安です。定価で購入できた場合の数字で、抽選品は当選が前提です。' +
      (btHorizon ? '対象は' + btHorizon + 'の取引です。' : '')), g.dl);

    var list = el('div', 'bt-analogs');
    var stripMax = 2;
    var anyStrip = false;
    analogs.forEach(function (a) {
      if (num(a.price_to_list_ratio) !== null) {
        anyStrip = true;
        stripMax = Math.max(stripMax, a.price_to_list_ratio * 1.05);
      }
    });
    if (anyStrip) {
      list.appendChild(el('p', 'bt-strip-cap', '横棒は定価（縦線）に対する倍率です。点の左右の太い帯は、中央値の90%範囲です。'));
    }
    analogs.forEach(function (a) {
      var row = el('div', 'bt-analog' + (a.result === 'HEADROOM_ALL_SALES' ? ' is-clear' :
        (a.result === 'INSUFFICIENT_SAMPLE' ? ' is-thin' : (a.result ? ' is-other' : ' is-none'))));
      var top = el('div', 'bt-analog-head');
      var aname = shownText(a.comparable_name);
      if (aname !== null) { top.appendChild(wordWrapText(el('span', 'bt-analog-name'), aname)); }
      var strength = shownText(a.strength_label_ja);
      if (strength !== null) { top.appendChild(el('span', 'bt-analog-strength', strength)); }
      if (top.children.length) { row.appendChild(top); }
      var aResult = shownText(a.result_label_ja);
      if (aResult !== null) { row.appendChild(el('span', 'bt-analog-result', aResult)); }
      /* Four short key–value rows grouped by meaning (取引 / 価格 / 定価 / 差額) instead of one
         run-on chain. Each value is only what is published; a missing piece is left out. */
      var kv = el('dl', 'bt-analog-facts');
      function kvRow(k, v) {
        if (!v) { return; }
        var d = el('div');
        d.appendChild(el('dt', null, k));
        d.appendChild(elKeep('dd', null, v));
        kv.appendChild(d);
      }
      var ivLo = num(a.interval_low_jpy), ivHi = num(a.interval_high_jpy), aList = num(a.list_price_jpy);
      var trade = a.strict_sales + '件';
      if (num(a.sale_days) !== null) {
        trade += '（取引日数 ' + a.sale_days + '日' +
          (num(a.strict_sales) !== null && a.sale_days <= 2 && a.strict_sales >= 6 ? '・短い期間に集中' : '') + '）';
      }
      if (a.window_complete === false) { trade += '・集計期間はまだ続いています'; }
      kvRow('取引', trade);
      if (num(a.median_sale_jpy) !== null) {
        kvRow('取引価格', '中央値 ' + fmtSignedYen(a.median_sale_jpy) +
          (ivLo !== null && ivHi !== null ? '（中央値の90%範囲 ' + fmtSignedYen(ivLo) + '〜' + fmtSignedYen(ivHi) + '）' : ''));
      }
      if (aList !== null) {
        var unit = shownText(a.sale_unit);
        kvRow('定価', fmtSignedYen(aList) + (unit === null ? '' : '（' + unit + '）') +
          (num(a.price_to_list_ratio) !== null ? '・取引価格は定価の' + a.price_to_list_ratio.toFixed(2) + '倍' : ''));
      }
      var diffs = [];
      if (num(a.median_headroom_jpy) !== null) { diffs.push('中央値 ' + fmtSignedYen(a.median_headroom_jpy)); }
      if (num(a.worst_headroom_jpy) !== null) { diffs.push('最も低い例 ' + fmtSignedYen(a.worst_headroom_jpy)); }
      kvRow('定価との差額', diffs.join('・'));
      row.appendChild(kv);
      var strip = ratioStrip(a.price_to_list_ratio, stripMax,
        (ivLo !== null && aList) ? ivLo / aList : null, (ivHi !== null && aList) ? ivHi / aList : null);
      if (strip) { row.appendChild(strip); }
      list.appendChild(row);
    });
    if (analogs.length) { g.node.insertBefore(list, g.dl); }

    /* 価格見通し（定価比のみ、参考）. Ratios only by the owner's decision: no yen. The low end is
       shown first and in bold, because the method's own check over-predicted every product that
       ended below list price; the measured error sits on every row. A period without a number
       (too few analogs) or without a known horizon is not listed. */
    var outlook = (bt.outlook || []).filter(function (o) {
      return o && num(o.analogs_used) !== null && num(o.ratio_median) !== null &&
        num(o.ratio_min) !== null && num(o.ratio_max) !== null && horizonOf(o) !== null;
    });
    if (outlook.length) {
      var ob = el('div', 'bt-outlook');
      ob.appendChild(el('p', 'bt-outlook-title', '価格見通し（定価に対する倍率・参考）'));
      ob.appendChild(el('p', 'bt-outlook-def',
        '過去の類似品が、定価の何倍で取引されたかをまとめたものです。金額ではなく倍率で表示しています。' +
        '同じ方法を、各商品をそれより前に発売された商品だけで見積もって試したところ、定価を下回った商品を高めに見積もる傾向がありました。そのため、範囲の下限を先に表示しています。' +
        '倍率は利益ではありません。定価で購入できた場合の目安です。'));
      outlook.forEach(function (o) {
        var row = el('div', 'bt-outlook-row');
        row.appendChild(elKeep('span', 'bt-outlook-h', horizonOf(o)));
        var body = el('span', 'bt-outlook-body');
        body.appendChild(el('strong', 'bt-outlook-low', '下限 ' + o.ratio_min.toFixed(2) + '倍'));
        body.appendChild(elKeep('span', 'bt-outlook-mid',
          '・中央値 ' + o.ratio_median.toFixed(2) + '倍・上限 ' + o.ratio_max.toFixed(2) + '倍' +
          (num(o.ratio_p25) !== null && num(o.ratio_p75) !== null
            ? '（中ほどの半数は' + o.ratio_p25.toFixed(2) + '〜' + o.ratio_p75.toFixed(2) + '倍）' : '') +
          '・類似品' + o.analogs_used + '件'));
        row.appendChild(body);
        var meta = [];
        if (o.tier === 'HYPOTHESIS') { meta.push('この商品の販売単位（パック・BOX）を確認できていないため、参考の値です'); }
        if (num(o.check_median_error) !== null && num(o.check_max_error) !== null) {
          meta.push('発売が早い商品だけで試した誤差 中央値' + Math.round(o.check_median_error * 100) + '%・最大' +
            Math.round(o.check_max_error * 100) + '%' + (num(o.check_n) !== null ? '（' + o.check_n + '件で試算）' : ''));
        }
        if (meta.length) { row.appendChild(elKeep('span', 'bt-outlook-meta', meta.join('／'))); }
        ob.appendChild(row);
      });
      g.node.insertBefore(ob, g.dl);
    }

    var notes = el('ul', 'bt-notes');
    if ((bt.counter_signal_names || []).length) {
      notes.appendChild(el('li', 'bt-note-warn',
        '取引が3件に満たず集計から外した類似品のうち、' + bt.counter_signal_names.join('、') +
        'は、手数料を引くと定価を下回る価格で取引されています。売れ行きの悪い商品ほど取引が少なく集計から外れやすいため、上の結果は実際より良く見えている可能性があります。'));
    }
    notes.appendChild(el('li', null, '類似品は過去に発売された別の商品です。この商品が同じ価格で売れることを示すものではありません。'));
    notes.appendChild(el('li', null, '取引価格は、オークションなどで取引が成立したもののうち、未開封・単品・欠品なしのものだけを集計しています。出品中の価格は含みません。'));
    notes.appendChild(el('li', null, '購入を検討する際の参考情報の一つです。購入をおすすめするものではありません。'));
    g.node.insertBefore(notes, g.dl);
    g.dl.remove();
    return g.node;
  }

  function render(doc, p) {
    var root = $('detail');
    var unverified = isUnverifiedRow(p);
    var card = el('div', 'detail-card' + (unverified ? ' is-unverified' : ''));

    /* --- HERO: 写真（なければ図） | 商品名・バッジ・締切・価格 ---
       The same picture the card showed: the cheapest possible answer to
       「押したカードのページで合っているのか」. The credit is visible text under it. */
    var hero = el('div', 'detail-hero');
    var fig = el('figure', 'detail-media');
    var im = productImageOf(p);
    var caption = el('figcaption', 'detail-credit');
    var TILE_CAPTION = 'この商品の公式画像はまだ掲載していません。表示している図はカテゴリのイメージで、商品の写真ではありません。';
    fig.appendChild(productMedia(p, 'hero', {
      eager: true,
      onFail: function () { caption.textContent = TILE_CAPTION; caption.classList.add('is-tile'); }
    }));
    var creditText = im ? imageCreditText(im) : null;
    if (creditText) {
      caption.textContent = creditText;
    } else {
      caption.textContent = TILE_CAPTION;
      caption.classList.add('is-tile');
    }
    fig.appendChild(caption);
    hero.appendChild(fig);
    var heroBody = el('div', 'detail-hero-body');
    hero.appendChild(heroBody);

    /* --- HEADER: 商品名 / 現在状態 / 確認状況 / フラグ / 補足 --- */
    var head = el('div', 'detail-head');
    var headText = el('div', 'detail-head-text');
    headText.appendChild(wordWrapText(el('h1', 'detail-title'),
      isUnknown(p.product_name) ? '商品の詳細' : String(p.product_name)));
    var detailMeta = identityMeta(p, true);
    if (detailMeta.length) {
      headText.appendChild(el('p', 'detail-sub', detailMeta.join('・')));
    }
    var badges = el('div', 'detail-badges');
    put(badges, statusBadge(p));
    put(badges, evidenceBadge(p));
    if (p.is_new === true) { badges.appendChild(el('span', 'badge badge--flag', '新着')); }
    if (isRestockRow(p)) { badges.appendChild(el('span', 'badge badge--restock', '再販')); }
    if (p.is_attention === true) {
      badges.appendChild(el('span', 'badge badge--attention', '注目候補'));
    }
    if (badges.children.length) { headText.appendChild(badges); }
    head.appendChild(headText);
    heroBody.appendChild(head);

    /* --- 買いの目安（参考）: the answer first, then why, then what is missing, then the conditions --- */
    var bs = buySignalOf(p);
    if (bs) {
      var verdict = el('section', 'detail-buy buy-box--' + bs.level);
      verdict.setAttribute('aria-label', '買いの目安（参考）');
      var vHead = el('div', 'detail-buy-head');
      vHead.appendChild(el('span', 'detail-buy-cap', '買いの目安（参考）'));
      vHead.appendChild(buyPill(bs, true));
      verdict.appendChild(vHead);
      verdict.appendChild(el('p', 'detail-buy-why', String(bs.reason_ja)));
      if (Array.isArray(bs.missing_ja) && bs.missing_ja.length) {
        verdict.appendChild(el('p', 'detail-buy-sub', '判定に足りないもの'));
        var ml = el('ul', 'detail-buy-list');
        bs.missing_ja.forEach(function (m) { ml.appendChild(el('li', null, String(m))); });
        verdict.appendChild(ml);
      }
      if (Array.isArray(bs.conditions_ja) && bs.conditions_ja.length) {
        verdict.appendChild(el('p', 'detail-buy-cond', '条件：' + bs.conditions_ja.join('／')));
      }
      heroBody.appendChild(verdict);
    }
    card.appendChild(hero);
    if (unverified) {
      heroBody.appendChild(el('div', 'warn-box',
        'この商品は未検証です。公式情報での確認がまだ済んでいないため、確認済みの商品とは区別してご覧ください。'));
    }

    /* --- TOP: 締切 と 価格。締切は日付と残り日数を分けて出す。緊急の見た目は
           closing_soon_band がある行だけ（deadlineParts -> isClosingSoonRow）。
           締切の無い商品に締切の箱は出さない。 --- */
    var top = el('div', 'detail-top');
    var parts = deadlineParts(p, doc && doc.as_of);
    if (parts) {
      var dBox = el('div', 'detail-deadline');
      dBox.appendChild(el('span', 'price-lbl', parts.kind ? parts.kind : '締切'));
      if (parts.urgent) { dBox.classList.add('is-urgent'); }
      else if (parts.soon) { dBox.classList.add('is-soon'); }
      else if (parts.muted) { dBox.classList.add('is-unconfirmed'); }
      var dLine = el('span', 'detail-deadline-line');
      dLine.appendChild(el('span', 'price-val', parts.fullDate || parts.date));
      if (parts.rel) { dLine.appendChild(el('span', 'f-rel' + (parts.passed ? ' is-passed' : ''), parts.rel)); }
      dBox.appendChild(dLine);
      top.appendChild(dBox);
    }
    /* PRICE: 定価 と 取得原価 は別の量。ひとつの独立ブロックにする。確認できた方だけ。 */
    put(top, pricePair(p));
    /* Key facts next to the price: how it is sold and when it comes out. Confirmed values only. */
    var keyFacts = el('div', 'detail-keyfacts');
    [['販売方式', lbl(SALE_MODE_LABEL, p.sale_mode)], ['発売日', releaseText(p)]].forEach(function (kf) {
      var v = shownText(kf[1]);
      if (v === null) { return; }
      var it = el('div', 'keyfact');
      it.appendChild(el('span', 'price-lbl', kf[0]));
      it.appendChild(elKeep('span', 'keyfact-val', v));
      keyFacts.appendChild(it);
    });
    if (keyFacts.children.length) { top.appendChild(keyFacts); }
    if (top.children.length) { heroBody.appendChild(top); }
    var prices = el('div', 'detail-prices');
    var priceNote = priceNoteText(p);
    if (priceNote !== null) { prices.appendChild(el('p', 'price-note', priceNote)); }
    put(prices, outboundCta(p, 'card-action card-action--ext detail-cta'));
    var statusNote = shownText(p.status_note_ja);
    if (statusNote !== null) { prices.appendChild(el('p', 'note-box', statusNote)); }
    if (prices.children.length) { heroBody.appendChild(prices); }

    var wrap2 = el('div', 'detail-wrap');

    /* 類似品バックテスト（参考）: first when an analog could be evaluated — it is what the reader
       came for, and it carries its own caveats. With nothing evaluable but thin analogs to show,
       it appears lower down; with nothing at all to show, it is not rendered. */
    var btBlock = buildBacktestBlock(p);
    if (btBlock && hasEvaluableBacktest(p)) { wrap2.appendChild(btBlock); }

    /* --- 主要販売情報 --- */
    var g2 = group('販売情報');
    row(g2.dl, '現在の状況', hasShownStatus(p) ? p.status_label_ja : null);
    /* v1.1.0 supplies the Japanese label; a raw token is never printed. */
    row(g2.dl, '状況の根拠', p.status_basis_label_ja);
    row(g2.dl, '補足', p.status_note_ja);
    row(g2.dl, shownText(p.list_price_label_ja) || '定価', fmtPrice(listPriceOf(p)));
    row(g2.dl, '取得原価', fmtPrice(acquisitionCostOf(p)));
    row(g2.dl, '販売方式', lbl(SALE_MODE_LABEL, p.sale_mode));
    /* sale_mode_raw is a source code (retail, lottery …): shown only through a Japanese label,
       and the row is left out when there is no wording for it. */
    var rawMode = own(SALE_MODE_RAW_LABEL, p.sale_mode_raw);
    if (rawMode !== undefined) { row(g2.dl, '販売方法の詳細', rawMode); }
    row(g2.dl, '購入先', (Array.isArray(p.channel) && p.channel.length) ? p.channel.join('・') : null);
    row(g2.dl, '購入制限', p.purchase_limit);
    row(g2.dl, '再販状況', p.restock_status);
    row(g2.dl, '販売終了', fmtDate(p.sales_end));
    var urlLabel = lbl(URL_KIND_LABEL, p.official_url_kind) || '公式ページ';
    row(g2.dl, urlLabel, null, linkNode(p.official_url, urlLabel + 'を開く'));
    row(g2.dl, '購入ページ', null, linkNode(p.purchase_url, '購入ページを開く'));
    put(wrap2, groupIfAny(g2));

    /* --- 基本情報 --- */
    var g1 = group('基本情報');
    if (!isUnknown(p.product_name)) { row(g1.dl, '商品名', null, el('span', null, String(p.product_name))); }
    row(g1.dl, 'カテゴリ', lbl(CATEGORY_LABEL, p.category));
    row(g1.dl, '作品名', p.ip);
    /* Precision-honest: the display string is used verbatim. */
    row(g1.dl, '発売日', releaseText(p));
    put(wrap2, groupIfAny(g1));

    /* --- 応募・予約情報 --- */
    var g3 = group('応募・予約・抽選情報', true);
    var dKind = lbl(DEADLINE_KIND_LABEL, p.deadline_kind);
    var dRel = deadlineRelText(p);
    var dVal = isUnknown(p.deadline) ? null :
      fmtDate(p.deadline) + (dKind ? '（' + dKind + '）' : '') + (dRel ? ' / ' + dRel : '');
    row(g3.dl, '直近の期日', dVal);
    row(g3.dl, '予約開始', fmtDate(p.reservation_start));
    row(g3.dl, '予約終了', fmtDate(p.reservation_end));
    row(g3.dl, '抽選開始', fmtDate(p.lottery_start));
    row(g3.dl, '抽選終了', fmtDate(p.lottery_end));
    row(g3.dl, '応募開始', fmtDate(p.application_start));
    row(g3.dl, '応募終了', fmtDate(p.application_end));
    /* Same word as the card's 応募条件 row: two names for one date reads as two dates. */
    row(g3.dl, '当選発表', fmtDate(p.result_date));
    row(g3.dl, '支払期限', fmtDate(p.payment_deadline));
    row(g3.dl, '受取期間', p.pickup_period);
    row(g3.dl, '発送予定', p.shipping_period);
    put(wrap2, groupIfAny(g3));

    /* --- 確認状況（出典を含む）。ヘッダーのバッジと同じ事実を、日付と出典まで開いたもの。 --- */
    var g5 = group('確認状況と出典', true);
    row(g5.dl, '確認状況', p.evidence_label_ja);
    row(g5.dl, '確認の方法', lbl(TIER_LABEL, p.verification_tier));
    row(g5.dl, '最終確認日', fmtDate(p.last_verified_at));
    row(g5.dl, '初回確認日', fmtDate(p.first_seen_at));
    row(g5.dl, '更新日', fmtDate(p.updated_at));
    var refs = Array.isArray(p.source_references) ? p.source_references : [];
    var usable = refs.filter(function (r) { return r && isSafeHttpUrl(r.url); });
    if (usable.length) {
      var ul = el('ul', 'src-list');
      usable.forEach(function (r) {
        var li = el('li');
        var node = linkNode(r.url, shownText(r.name) || String(hostOf(r.url) || 'リンク'));
        if (node) { li.appendChild(node); }
        var kind = lbl(URL_KIND_LABEL, r.kind);
        if (kind) { li.appendChild(el('span', 'src-kind', kind)); }
        ul.appendChild(li);
      });
      row(g5.dl, '出典（公式情報など）', null, ul);
    }

    /* --- 供給制約 -> Evidence（成約 + 確認状況） -> Route. A block with nothing confirmed to
           show returns null and is left out (so it is not in the contents list either). --- */
    put(wrap2, buildSignalsBlock(p));
    put(wrap2, buildProfitBlock(p, btBlock));
    put(wrap2, groupIfAny(g5));
    put(wrap2, buildRouteBlock(p));
    if (btBlock && !hasEvaluableBacktest(p)) { wrap2.appendChild(btBlock); }

    /* --- 調査メモ --- */
    var g6 = group('補足情報', true);
    row(g6.dl, '備考', p.notes_ja);
    put(wrap2, groupIfAny(g6));

    /* Contents. Generated from the blocks that were actually appended above — never a fixed
       list, so a page with no route evidence does not claim to have a route section. */
    var toc = el('nav', 'detail-toc');
    toc.setAttribute('aria-label', 'このページの内容');
    toc.appendChild(el('span', 'detail-toc-lbl', 'このページの内容'));
    var tocList = el('ul', 'detail-toc-list');
    var groups = wrap2.querySelectorAll('.dl-group');
    for (var gi = 0; gi < groups.length; gi++) {
      var heading = groups[gi].querySelector('h2');
      if (!heading || !heading.textContent) { continue; }
      var anchorId = 'sec-detail-' + gi;
      groups[gi].id = anchorId;
      var item = el('li');
      var link = el('a', null, heading.textContent);
      link.href = '#' + anchorId;
      item.appendChild(link);
      tocList.appendChild(item);
    }
    toc.appendChild(tocList);
    if (tocList.children.length) { card.appendChild(toc); }

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
      if (!marksAvailable) { noteEl.textContent = 'お使いのブラウザの設定により、印を保存できません。'; }
    }, 'detail-marks');
    g7.appendChild(box);
    var noteEl = el('p', 'note-line',
      '印はお使いのブラウザにだけ保存され、外部には送信されません。購入するかどうかは、ご自身でご判断ください。');
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
      $('notfound-detail').textContent = '商品が指定されていません。一覧から商品をお選びください。';
      $('notfound-panel').hidden = false;
      return;
    }
    var found = null;
    for (var i = 0; i < doc.products.length; i++) {
      if (doc.products[i].product_id === id) { found = doc.products[i]; break; }
    }
    if (!found) {
      $('notfound-detail').textContent =
        '「' + id + '」に当たる商品は、現在掲載していません。一覧からお探しください。';
      $('notfound-panel').hidden = false;
      return;
    }
    if (!isUnknown(found.product_name)) {
      document.title = String(found.product_name) + ' | Sedori Research Dashboard';
    }
    render(doc, found);
  }).catch(function (err) {
    showError(err && err.message ? err.message : 'データを読み込めませんでした。時間をおいて再度お試しください。');
  });
}

/** Any link to #how-counted opens the explainer it points at (a closed <details> would hide it). */
document.addEventListener('click', function (e) {
  var t = e.target;
  var a = t && t.closest ? t.closest('a[href="#how-counted"]') : null;
  if (!a) { return; }
  var d = document.getElementById('how-counted');
  if (d) { d.open = true; }
});

/* ---------------------------------------------------------------- dispatch */

(function () {
  var page = document.body.getAttribute('data-page');
  if (page === 'index') { initIndex(); }
  else if (page === 'product') { initProduct(); }
})();
