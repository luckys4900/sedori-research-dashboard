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
  ONLINE_LOTTERY: 'オンラインくじ', COLLAB: 'コラボ商品', OTHER: 'その他',
  /* navigation / filter label only: the data value stays UNKNOWN, and a card or the detail page
     still shows no category for it (lbl() never resolves UNKNOWN) */
  UNKNOWN: 'その他（分類前）'
};
/* Short names for the navigation bar (plan §7). Same categories, same filter. */
var NAV_CAT_LABEL = {
  TCG: 'TCG', FIGURE: 'フィギュア', TOY: '玩具', CHARACTER_GOODS: 'キャラクターグッズ',
  BOOK_MOOK: '書籍', ONLINE_LOTTERY: 'オンラインくじ', COLLAB: 'コラボ', OTHER: 'その他', UNKNOWN: 'その他（分類前）'
};
/** A category as a navigation / filter choice — including UNKNOWN (「その他（分類前）」), so the
    category choices always add up to the whole list. Never used to label a product. */
function catChoiceLabel(v) {
  var got = own(CATEGORY_LABEL, v);
  return got === undefined ? null : got;
}

/* The acceptance state as a filter choice. OPEN_NOW is named so that it cannot be read as the
   status strip's 受付中 (which also counts 締切間近), and UNKNOWN gets a reachable choice. */
var STATUS_CHOICE_LABEL = { OPEN_NOW: '受付中（締切間近を除く）', UNKNOWN: '受付状況は確認中' };

/* Search aliases (query side only; product names are never rewritten). A query word that belongs
   to a group matches a product containing ANY spelling of that group. Exact substrings only — no
   fuzzy matching. */
var SEARCH_ALIASES = [
  ['hololive', 'ホロライブ'],
  ['pokemon', 'pokémon', 'ポケモン', 'ポケットモンスター'],
  ['one piece', 'onepiece', 'ワンピース'],
  ['chiikawa', 'ちいかわ'],
  ['sanrio', 'サンリオ']
];

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
var KEEP_RE = /あと\d+日|\d{4}年\d{1,2}月(?:\d{1,2}日)?|\d{1,2}月\d{1,2}日|(?:中央値|最大|上限|下限)\s?\d+(?:\.\d+)?(?:倍|%)|類似品\d+件|[+−-]?[¥￥][\d,]+(?:〜[+−-]?[¥￥][\d,]+)?|\d+(?:\.\d+)?(?:倍|件|日|%|か月|週)(?:\s*\/\s*\d+件中)?|（[^（）]{1,16}）|【[^【】]{1,12}】/g;
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

/**
 * Dates written inside free text, in one style and at the precision they were published:
 * 2026-10-03 → 2026年10月3日, 2026-12 → 2026年12月, 2026-12下旬 → 2026年12月下旬. A month is never
 * turned into a day, and nothing else in the text changes.
 */
function normDateText(text) {
  return String(text)
    .replace(/(^|[^\d])(\d{4})-(\d{2})-(\d{2})(?!\d)/g, function (m, pre, y, mo, d) {
      return pre + Number(y) + '年' + Number(mo) + '月' + Number(d) + '日';
    })
    .replace(/(^|[^\d])(\d{4})-(\d{2})(?![\d-])/g, function (m, pre, y, mo) {
      return pre + Number(y) + '年' + Number(mo) + '月';
    });
}

/** 「10/1」 (with the year only when it differs from the 基準日's) for a published YYYY-MM-DD. */
function fmtShortDay(d, asOf) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''));
  if (!m) { return null; }
  var md = Number(m[2]) + '/' + Number(m[3]);
  return (asOf && String(asOf).slice(0, 4) !== m[1]) ? m[1] + '/' + md : md;
}

/** A list-level flag that is true for (almost) every product carries no information: the 新着 badge
    is shown only while fewer than NEW_BADGE_MAX_SHARE of the products are new. List and detail
    page use this one rule. */
function newBadgeShown(products) {
  if (!products || !products.length) { return false; }
  var n = products.filter(function (p) { return p.is_new === true; }).length;
  return n / products.length < NEW_BADGE_MAX_SHARE;
}

/** ¥5,280 — only for a real integer. null stays UNKNOWN. */
function fmtPrice(v) {
  if (num(v) === null) { return null; }
  return '¥' + Math.round(v).toLocaleString('ja-JP');
}

/* ------------------------------------------------------------ 利ざやの計算
   The yen arithmetic the build publishes (margin_yen / track_record). The page never computes a margin;
   it only lays the published numbers out, always with 「送料別」 or the shipping range, and 「利益ではありません」. */
function fmtSignedYenPlain(v) {
  if (num(v) === null) { return null; }
  return (v > 0 ? '+' : v < 0 ? '−' : '±') + '¥' + Math.abs(Math.round(v)).toLocaleString('ja-JP');
}
function marginOf(p) {
  var m = p && p.margin_yen;
  return (m && num(m.diff_before_shipping_jpy) !== null) ? m : null;
}
/** 「送料込み −¥558〜−¥18」 when the build published a shipping range; null otherwise. */
function marginAfterShippingText(m) {
  if (num(m.diff_after_shipping_min_jpy) === null || num(m.diff_after_shipping_max_jpy) === null) { return null; }
  return '送料込み ' + fmtSignedYenPlain(m.diff_after_shipping_min_jpy) + '〜' + fmtSignedYenPlain(m.diff_after_shipping_max_jpy);
}
/** Detail table: 定価 → 中央値 → 手数料 → 手数料後 → 差（送料別）→ 送料 → 送料込みの差. */
function marginTable(m, title) {
  var box = el('div', 'mtable');
  if (title) { box.appendChild(el('p', 'mtable-title', title)); }
  box.appendChild(el('p', 'mtable-basis', String(m.basis_ja) + '（取引' + m.sales_n + '件の中央値）'));
  var dl = el('dl', 'mtable-rows');
  function row(label, value, cls) {
    if (value === null) { return; }
    var r = el('div', 'mtable-row' + (cls ? ' ' + cls : ''));
    r.appendChild(el('dt', null, label));
    r.appendChild(elKeep('dd', null, value));
    dl.appendChild(r);
  }
  row('定価' + (m.list_price_unit_ja ? '（' + m.list_price_unit_ja + '）' : ''), fmtPrice(m.list_price_jpy));
  row('発売1か月後の取引の中央値', fmtPrice(m.reference_sale_jpy));
  row('販売手数料（' + Math.round(num(m.fee_rate) * 100) + '%）', '−' + fmtPrice(m.fee_jpy));
  row('手数料を引いた受取額', fmtPrice(m.after_fee_jpy));
  row('定価との差（送料別）', fmtSignedYenPlain(m.diff_before_shipping_jpy), 'is-key');
  if (num(m.shipping_min_jpy) !== null) {
    row('送料（公式料金表・' + String(m.shipping_methods_ja) + '）', '−¥' + m.shipping_min_jpy.toLocaleString('ja-JP') +
      '〜−¥' + m.shipping_max_jpy.toLocaleString('ja-JP'));
    row('送料込みの差', fmtSignedYenPlain(m.diff_after_shipping_min_jpy) + '〜' + fmtSignedYenPlain(m.diff_after_shipping_max_jpy), 'is-key');
  }
  box.appendChild(dl);
  box.appendChild(el('p', 'mtable-note', String(m.excluded_ja) +
    (num(m.shipping_min_jpy) !== null ? '送料は梱包後のサイズが確認できていないため、使える発送方法の最安〜最高の幅で示しています。' : '')));
  return box;
}

/** 定価 with its unit when the build publishes one (「¥4,400（1BOX（10パック））」 reads badly, so a slash). */
function fmtListPrice(p) {
  var v = fmtPrice(listPriceOf(p));
  if (v === null) { return null; }
  var unit = shownText(p && p.list_price_unit_ja);
  return unit === null ? v : v + ' / ' + unit;
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
  if (label === null && !isUnverifiedRow(p)) { return null; }
  if (label === null) { label = '未検証'; }
  /* Defensive: never show 確認済み for a non-VERIFIED row. */
  if (p.evidence_state !== 'VERIFIED' && label === '確認済み') { label = '未検証'; }
  /* R21H: shown on the detail page only, in plain words */
  if (label === '未検証') { label = '公式確認前'; }
  var badge = el('span', 'badge badge--' + variant, label);
  if (isUnverifiedRow(p)) { badge.title = '公式情報での確認がまだ済んでいない商品です'; }
  return badge;
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

/* ------------------------------------------------------------ R22 decision harness
   `decision` is built by dashboard/scripts/harness.py from published facts only: an editorial listing tier (not a
   verdict), a confidence level that counts evidence (not a profit probability), and plain-language why-now / risk /
   next-check lines. The page orders and groups by it; it never prints a score or a rank. */
function decisionOf(p) { return (p && p.decision && typeof p.decision === 'object') ? p.decision : null; }
var TIER_RANK = { LEAD: 0, FOLLOW: 1, PENDING: 2, ARCHIVE: 3 };
var URGENCY_RANK = { TODAY: 0, WEEK: 1, LATER: 2 };
var CONF_RANK = { HIGH: 0, MEDIUM: 1, LOW: 2 };
function rankIn(table, v) { var r = own(table, v); return r === undefined ? 9 : r; }
/** On the page by default: a lead or an item to follow. Info-wait and finished items stay in 全商品一覧. */
function isListed(p) { var d = decisionOf(p); return !d || d.tier === 'LEAD' || d.tier === 'FOLLOW'; }
function confLevel(p) { var d = decisionOf(p); return d && d.confidence ? d.confidence.level : null; }
/** Order to check in: tier, then the urgency band, then evidence completeness, then the deadline. Not a rank. */
function cmpDecision(a, b) {
  var da = decisionOf(a) || {}, db = decisionOf(b) || {};
  var x = rankIn(TIER_RANK, da.tier) - rankIn(TIER_RANK, db.tier);
  if (x) { return x; }
  x = rankIn(URGENCY_RANK, da.urgency) - rankIn(URGENCY_RANK, db.urgency);
  if (x) { return x; }
  x = rankIn(CONF_RANK, confLevel(a)) - rankIn(CONF_RANK, confLevel(b));
  if (x) { return x; }
  var ka = num(a.days_to_deadline), kb = num(b.days_to_deadline);
  if (ka !== kb) { return ka === null ? 1 : (kb === null ? -1 : ka - kb); }
  return String(a.product_id) < String(b.product_id) ? -1 : 1;
}
/** 今日まず見る: leads first, then items to follow whose evidence is at least partly in place; a low-confidence item
    only when it closes within 3 days (and it then says 確度 低 on its face). Never an info-wait or finished item. */
function firstLook(rows, max) {
  var act = rows.filter(function (p) { var d = decisionOf(p); return d && d.actionable && (d.tier === 'LEAD' || d.tier === 'FOLLOW'); });
  var strong = act.filter(function (p) { return decisionOf(p).tier === 'LEAD' || confLevel(p) !== 'LOW'; }).sort(cmpDecision);
  if (strong.length >= max) { return strong.slice(0, max); }
  var urgent = act.filter(function (p) { return strong.indexOf(p) < 0 && decisionOf(p).urgency === 'TODAY'; }).sort(cmpDecision);
  return strong.concat(urgent).slice(0, max);
}
/** 「4件中3件が定価超え・定価の1.12倍」 — only with 3 or more comparable products. */
function similarText(p) {
  if (!hasEvaluableBacktest(p)) { return null; }
  var bt = backtestOf(p);
  if ((num(bt.analogs_evaluable) || 0) < 3) { return null; }
  var main = (Array.isArray(bt.evidence_notes) ? bt.evidence_notes : []).filter(function (n) {
    return n && n.horizon === bt.horizon && num(n.evaluable) !== null && n.evaluable > 0 && num(n.cleared) !== null;
  })[0];
  var ratio = backtestMedianRatio(bt);
  var parts = [];
  if (main) { parts.push(main.evaluable + '件中' + main.cleared + '件が手数料後に定価超え'); }
  if (ratio !== null) { parts.push('定価の' + ratio.toFixed(2) + '倍（中央値）'); }
  return parts.length ? parts.join('・') : null;
}
/** The decision facts as one <dl>: why now, price, similar products, driver, risk, next check, evidence. */
function decisionFacts(p, detail) {
  var d = decisionOf(p);
  if (!d) { return null; }
  var dl = el('dl', 'dfacts');
  function row(label, value, cls) {
    var v = shownText(value);
    if (v === null) { return; }
    var r = el('div', 'dfact' + (cls ? ' ' + cls : ''));
    r.appendChild(el('dt', 'dfact-lbl', label));
    r.appendChild(elKeep('dd', 'dfact-val', v));
    dl.appendChild(r);
  }
  row('いつ', d.why_now_ja, 'dfact--when');
  row('定価', d.price_ja);
  row('利益', profitLine(p), 'dfact--profit');
  if (detail) { row('類似品', similarText(p)); }   /* a card carries the 類似品 line with its 「数え方」 link instead */
  row('動く要因', d.catalyst_ja);
  row('注意点', d.risk_ja, 'dfact--risk');
  row('次に確認', d.next_check_ja, 'dfact--next');
  if (detail) {
    var c = d.confidence || {};
    var why = [].concat(c.plus_ja || [], (c.minus_ja || []).map(function (m) { return '不足：' + m; }));
    row('確度の内訳', why.join('／'));
  }
  if (detail) {
    row('根拠', [shownText(d.evidence_ja), d.freshness ? shownText(d.freshness.label_ja) : null].filter(Boolean).join('・'), 'dfact--src');
  }
  return dl.children.length ? dl : null;
}
/** The tier and confidence chips. */
function decisionChips(p) {
  var d = decisionOf(p);
  if (!d) { return null; }
  var box = el('span', 'dchips');
  box.appendChild(el('span', 'tier-chip tier--' + String(d.tier).toLowerCase(), String(d.tier_label_ja)));
  if (d.confidence) {
    var c = el('span', 'conf-chip conf--' + String(d.confidence.level).toLowerCase(), String(d.confidence.label_ja));
    var minus = (d.confidence.minus_ja || [])[0];
    if (minus) { c.title = '確度が上がらない理由：' + minus; }
    box.appendChild(c);
  }
  /* the date the facts were checked, next to the confidence it affects */
  if (d.freshness && shownText(d.freshness.label_ja) !== null) {
    box.appendChild(el('span', 'fresh-chip' + (d.freshness.band === 'STALE' ? ' is-stale' : ''), String(d.freshness.label_ja)));
  }
  return box;
}

/* ------------------------------------------------------------ profit analysis (Profit Power / Confidence)
   Every number below is the backend's own; the page formats, never re-derives. An
   unknown value is 未算定, never 0; below 70 % coverage there is no total. Not a purchase order. */
var PROFIT_SHORT_JA = { PROFIT_CANDIDATE: '利益検討候補', WATCH_PRICE: '売価の裏付け待ち', WATCH_SUPPLY: '供給増に注意',
  WATCH_LIQUIDITY: '回転の裏付け待ち', INSUFFICIENT_EVIDENCE: '算定材料不足', NEGATIVE_MARGIN: '利益条件外', AVOID_RISK: 'リスク大' };
function profitOf(p) { return (p && p.profitability && typeof p.profitability === 'object') ? p.profitability : null; }
function yenSigned(v) {
  if (num(v) === null) { return null; }
  return (v > 0 ? '+' : (v < 0 ? '−' : '')) + Math.abs(v).toLocaleString('ja-JP') + '円';
}
function yenPlain(v) { return num(v) === null ? null : v.toLocaleString('ja-JP') + '円'; }
function pctSigned(v) {
  if (num(v) === null) { return null; }
  var x = Math.round(v * 100);
  return (x > 0 ? '+' : (x < 0 ? '−' : '')) + Math.abs(x) + '%';
}
/** One line for a card: the state and, when computed, the net-profit range. */
function profitLine(p) {
  var pr = profitOf(p);
  if (!pr) { return null; }
  var e = pr.economics || {};
  /* one line on a card: a short form of the same state and the base case; the full label and the low / high
     range are on the detail page */
  var label = own(PROFIT_SHORT_JA, pr.state) || String(pr.state_label_ja);
  if (num(e.net_profit_base) === null) { return label; }
  return label + '（中心 ' + yenSigned(e.net_profit_base) + '）';
}
/** 利益力 / 確度 / 算定範囲: two separate scales, never added together. */
function profitHead(pr) {
  var head = el('div', 'pa-head');
  head.appendChild(el('span', 'pstate pstate--' + String(pr.state).toLowerCase(), String(pr.state_label_ja)));
  var meters = el('div', 'pa-meters');
  function meter(cls, label, value, sub) {
    var m = el('div', 'pa-meter ' + cls);
    m.appendChild(el('span', 'pa-meter-lbl', label));
    m.appendChild(el('strong', 'pa-meter-val', value));
    if (sub) { m.appendChild(el('span', 'pa-meter-sub', sub)); }
    meters.appendChild(m);
  }
  var pw = pr.profit_power || {}, cf = pr.confidence || {};
  meter('pa-meter--power', '利益力', num(pw.score) !== null ? pw.score + ' / ' + (pw.max || 100) : '算定材料不足', null);
  meter('pa-meter--conf', '数字の確度', num(cf.score) !== null ? cf.score + ' / ' + (cf.max || 100) : '未算定',
    cf.label_ja ? '（' + cf.label_ja + (cf.analog_only ? '・類似品のみ' : '') + '）' : null);
  meter('pa-meter--cov', '算定範囲', Math.round((pr.data_coverage || 0) * 100) + '%', null);
  head.appendChild(meters);
  return head;
}
/** The full 利益分析 block for the detail page (compact: the card version on the top page). */
function profitBlock(p, compact) {
  var pr = profitOf(p);
  if (!pr) { return null; }
  var e = pr.economics || {}, m = pr.market || {};
  var box = el('section', 'pbox' + (compact ? ' pbox--compact' : ''));
  box.setAttribute('aria-label', '利益分析');
  if (!compact) { box.appendChild(el('h2', 'pa-title', '利益分析')); }
  box.appendChild(profitHead(pr));
  if (num(m.base) !== null || num(e.net_profit_base) !== null) {
    var tbl = el('table', 'pa-table');
    var thead = el('thead');
    var hr = el('tr');
    ['', '弱気', '中心', '強気'].forEach(function (h) { hr.appendChild(el('th', null, h)); });
    thead.appendChild(hr);
    tbl.appendChild(thead);
    var tb = el('tbody');
    function trow(label, vals, fmt) {
      var tr = el('tr');
      tr.appendChild(el('th', null, label));
      vals.forEach(function (v) { tr.appendChild(el('td', (num(v) !== null && v < 0) ? 'is-neg' : null, fmt(v) || '未算定')); });
      tb.appendChild(tr);
    }
    trow('想定売価', [m.low, m.base, m.high], yenPlain);
    trow('想定純利益', [e.net_profit_low, e.net_profit_base, e.net_profit_high], yenSigned);
    trow('ROI', [e.roi_low, e.roi_base, e.roi_high], pctSigned);
    tbl.appendChild(tb);
    var wrap = el('div', 'pa-table-wrap');
    wrap.appendChild(tbl);
    box.appendChild(wrap);
  }
  var facts = el('dl', 'dfacts pa-facts');
  function fact(label, value, cls) {
    var v = shownText(value);
    if (v === null) { return; }
    var r = el('div', 'dfact' + (cls ? ' ' + cls : ''));
    r.appendChild(el('dt', 'dfact-lbl', label));
    r.appendChild(elKeep('dd', 'dfact-val', v));
    facts.appendChild(r);
  }
  var buf = num(e.downside_buffer_pct);
  fact('損益分岐', num(e.break_even_jpy) !== null ? '売価 ' + yenPlain(e.break_even_jpy) + ' 以上で黒字' +
    (buf !== null ? (buf >= 0 ? '（中心売価から' + Math.round(buf * 100) + '%下がっても黒字）' : '（中心売価が損益分岐を' + Math.round(-buf * 100) + '%下回る）') : '') : null);
  fact('取得価格', num(e.acquisition_jpy) !== null ? yenPlain(e.acquisition_jpy) + '（' + e.acquisition_basis_ja + '）'
    : String(e.acquisition_basis_ja) + ((e.acquisition_reasons_ja || [])[0] ? '：' + e.acquisition_reasons_ja[0] : ''));
  if (!compact) {
    fact('売価の根拠', m.basis_ja ? m.basis_ja + (m.n_products ? '（' + m.n_products + '商品・成約' + m.n_sales + '件）' : '') : null);
    fact('費用の仮定', num(e.fee_rate) !== null ? '販売手数料 ' + Math.round(e.fee_rate * 100) + '%・送料 ' +
      (e.shipping_jpy ? e.shipping_jpy[0].toLocaleString('ja-JP') + '〜' + e.shipping_jpy[1].toLocaleString('ja-JP') + '円' : '未算定') +
      (e.shipping_basis_ja ? '（' + e.shipping_basis_ja + '）' : '') + '・梱包 ' + (e.packing_jpy || 0) + '円' : null);
  }
  fact('回転', pr.liquidity ? pr.liquidity.label_ja + (num(pr.liquidity.days_to_sale) !== null ? '（1個売れるまで約' + Math.round(pr.liquidity.days_to_sale) + '日）' : '') : null);
  if (!compact) {
    fact('供給', pr.supply ? '増えるリスク ' + pr.supply.label_ja : null);
    fact('時期', pr.timing ? pr.timing.label_ja : null);
    fact('期待利益', pr.expected_note_ja ? 'まだ出しません（' + pr.expected_note_ja + '）' : null);
  }
  fact('最大のリスク', pr.max_risk_ja, 'dfact--risk');
  fact('次に確認', pr.next_check_ja ? pr.next_check_ja + (pr.next_check_effect_ja ? ' → ' + pr.next_check_effect_ja : '') : null, 'dfact--next');
  if (!compact) { fact('確認日', pr.checked_on ? fmtDate(pr.checked_on) : null, 'dfact--src'); }
  if (facts.children.length) { box.appendChild(facts); }
  if (!compact) {
    /* なぜこの判定？: the backend's own reasons, plus first, then minus; then each scale's breakdown */
    var why = el('div', 'pa-why-box');
    why.appendChild(el('h3', 'pa-sub', 'なぜこの判定？'));
    var w = pr.why || {};
    var wl = el('ul', 'pa-reasons pa-why-list');
    (w.plus_ja || []).forEach(function (t) { wl.appendChild(el('li', 'is-plus', '＋ ' + t)); });
    (w.minus_ja || []).forEach(function (t) { wl.appendChild(el('li', 'is-minus', '－ ' + t)); });
    if (wl.children.length) { why.appendChild(wl); }
    var gates = el('p', 'pa-gates');
    var failed = (pr.hard_gates || []).filter(function (g) { return !g.passed; }).map(function (g) { return g.label_ja; });
    gates.textContent = failed.length ? '利益検討候補になるために足りない条件：' + failed.join('／') : '利益検討候補の条件をすべて満たしています。';
    why.appendChild(gates);
    box.appendChild(why);
    function breakdown(title, comps, cls) {
      var br = el('details', 'pa-breakdown ' + cls);
      br.appendChild(el('summary', 'pa-sub', title));
      (comps || []).forEach(function (c) {
        var item = el('div', 'pa-comp' + (num(c.score) === null ? ' pa-comp--unscored' : ''));
        var h = el('div', 'pa-comp-head');
        h.appendChild(el('span', 'pa-comp-lbl', String(c.label_ja)));
        h.appendChild(el('span', 'pa-comp-pts', num(c.score) === null ? '未算定' : (c.score + ' / ' + c.max)));
        item.appendChild(h);
        var ul = el('ul', 'pa-reasons');
        (c.plus_ja || []).forEach(function (t) { ul.appendChild(el('li', 'is-plus', '＋ ' + t)); });
        (c.minus_ja || []).forEach(function (t) { ul.appendChild(el('li', 'is-minus', '－ ' + t)); });
        if (ul.children.length) { item.appendChild(ul); }
        br.appendChild(item);
      });
      return br;
    }
    box.appendChild(breakdown('利益力の内訳', (pr.profit_power || {}).components, 'pa-breakdown--power'));
    box.appendChild(breakdown('数字の確度の内訳', (pr.confidence || {}).components, 'pa-breakdown--conf'));
    var note = el('p', 'note-line pa-note');
    note.appendChild(document.createTextNode('利益力（どれだけ残るか）と数字の確度（どこまで信じられるか）は別の物差しで、足し合わせません。' +
      '想定売価は保証ではなく、成約データと手数料・送料の仮定に基づく試算です（基準は暫定・' +
      (pr.calibration_status === 'CALIBRATION_PENDING' ? '過去実績での検証は件数不足のため未完了' : '検証状況は読み方を参照') + '）。購入の指示ではありません。'));
    var a = el('a', null, '利益分析の読み方');
    a.href = 'index.html#profit-faq';
    note.appendChild(a);
    box.appendChild(note);
  }
  return box;
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
  if (b.basis_ja) { pill.classList.add('buy-pill--inferred'); }
  pill.setAttribute('aria-label', '買いの目安（参考）：' + b.label_ja);
  return pill;
}
/** The product's own evidence first; when that is not enough, the inference (推論). */
function inferenceOf(p) {
  var b = buySignalOf(p);
  var i = b && b.level === 'NOT_ENOUGH_EVIDENCE' ? b.inference : null;
  return (i && BUY_LEVELS.indexOf(i.level) !== -1) ? i : null;
}
function effectiveLevel(p) {
  var b = buySignalOf(p);
  if (!b) { return null; }
  var i = inferenceOf(p);
  return i ? i.level : b.level;
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
  var info = backtestRatioInfo(bt);
  return info ? info.ratio : null;
}
/**
 * The same median with the number of analogs behind it, so a card can say 「類似品N件」 next to
 * the ratio. Ratios only (never yen): a ratio is unit-free, so it reads the same for a pack and a box.
 * The ratio is the analogs' median traded price over their own list price, before the sales fee.
 */
function backtestRatioInfo(bt) {
  if (!bt) { return null; }
  var r = (bt.analogs || []).filter(function (a) {
    return a && num(a.price_to_list_ratio) !== null && a.strict_sales >= 3 && a.list_price_jpy !== null &&
      a.result !== 'INSUFFICIENT_SAMPLE';
  }).map(function (a) { return a.price_to_list_ratio; }).sort(function (x, y) { return x - y; });
  if (!r.length) { return null; }
  var mid = Math.floor(r.length / 2);
  return { ratio: r.length % 2 ? r[mid] : (r[mid - 1] + r[mid]) / 2, n: r.length };
}

/* ------------------------------------------------------------- 買いの目安の印（compact）
   A row carries only the glyph and the word the build published; the reasons, what is missing and
   the conditions live on the detail page. Glyph + word, never colour alone, and never styled like
   the reader's own 「印」. */

/** What still separates this product from a clearer signal, or null. Build text only. */
function buyNeedText(p) {
  var b = buySignalOf(p);
  if (!b) { return null; }
  var inf = inferenceOf(p);
  if (inf) { return shownText(inf.closure_ja); }
  if (b.level !== 'NOT_ENOUGH_EVIDENCE') { return null; }
  var m = Array.isArray(b.missing_ja) ? b.missing_ja.filter(function (x) { return shownText(x) !== null; }) : [];
  if (m.length) { return m.join('／'); }
  return shownText(b.inference_blocked_ja);
}

/** 「◐ 様子見」: the compact 買いの目安 mark. `quietEmpty` (list rows) prints only 「－」 for
    判断材料不足 — it applies to most rows and would be noise — and keeps the words for assistive
    technology and as a tooltip. ●◐○ always carry their word. */
function buyMark(b, quietEmpty) {
  var empty = b.level === 'NOT_ENOUGH_EVIDENCE';
  var mark = el('span', 'buy-mark buy--' + b.level);
  /* R21F: a list row prints nothing for 判断材料不足 (the 「－」 on almost every row read as noise) */
  if (!(empty && quietEmpty)) { mark.appendChild(el('span', 'buy-glyph', BUY_GLYPH[b.level])); }
  if (empty && quietEmpty) {
    mark.appendChild(el('span', 'visually-hidden', '買いの目安：目安なし'));
  } else {
    /* R21H: say where an inferred level comes from in plain words, not 「推論」 */
    mark.appendChild(el('span', 'buy-word', empty ? '目安なし' : String(b.label_ja).replace(/（推論）/, '（類似品から）')));
  }
  mark.setAttribute('title', '買いの目安（参考）：' + String(b.label_ja));
  return mark;
}

/**
 * One line under a feed row: how many similar products could be compared and how many of them
 * traded above list price after the fee, the ratio (never yen: a row has no room for the unit
 * caveat), a decorative sparkline and a 「数え方」 link. Everything else is on the detail page.
 */
function backtestLine(p) {
  if (!hasEvaluableBacktest(p)) { return null; }
  /* R21H: fewer than 3 comparable products is too thin for a list line; the detail page shows it with its caveat */
  if ((num(backtestOf(p).analogs_evaluable) || 0) < 3) { return null; }
  var bt = backtestOf(p);
  var box = el('div', 'bt-line' + ((bt.counter_signal_names || []).length ? ' has-counter' : ''));
  box.appendChild(el('span', 'bt-line-lbl', '類似品'));
  var main = (Array.isArray(bt.evidence_notes) ? bt.evidence_notes : []).filter(function (n) {
    return n && n.horizon === bt.horizon && num(n.evaluable) !== null && n.evaluable > 0 &&
      num(n.cleared) !== null && n.cleared <= n.evaluable;
  })[0];
  var ratio = backtestMedianRatio(bt);
  var parts = [];
  if (main) {
    var hl = shownText(main.horizon_label_ja);
    var hShort = hl ? hl.replace(/（.*$/, '').replace(/^発売後/, '') : null;
    parts.push(main.evaluable + '件中' + main.cleared + '件が定価超え' +
      (hShort ? '（' + hShort + '）' : ''));
  } else {
    parts.push('類似品' + bt.analogs_evaluable + '件');
  }
  if (ratio !== null) { parts.push('定価の' + ratio.toFixed(2) + '倍（中央値）'); }
  var val = el('span', 'bt-line-val');
  parts.forEach(function (part, i) {
    /* the separator leads the following unit, so a phone that hides the second unit leaves no dangling 「・」 */
    val.appendChild(keepText(el('span', 'phrase-unit'), (i ? '・' : '') + part));
  });
  box.appendChild(val);
  var spark = buildSparkline(bt);
  if (spark) { box.appendChild(spark); }
  if ((bt.counter_signal_names || []).length) {
    box.appendChild(el('span', 'bt-line-warn', '定価割れの兆候あり'));
  }
  /* one tap to the counting rules on this page */
  var how = el('a', 'bt-line-how', '数え方');
  how.href = '#how-counted';
  box.appendChild(how);
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

/** The site mark (a magnifier over a rising line), as plain SVG primitives in a 64x64 box. The same mark is
    the header logo and the picture of every product that has no photo yet. */
var BRAND_MARK = [['circle', { cx: 28, cy: 28, r: 15 }],
                  ['line', { x1: 39, y1: 39, x2: 52, y2: 52 }],
                  ['path', { d: 'M20 33 L26 27 L31 31 L37 22' }]];

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

/** The site logo in the header: the same mark as the picture tile, in the text colour. */
function brandLogo() {
  var svg = svgEl('svg', { viewBox: '0 0 64 64', focusable: 'false', role: 'presentation', 'class': 'brand-logo' });
  svg.setAttribute('aria-hidden', 'true');
  for (var i = 0; i < BRAND_MARK.length; i++) {
    var node = svgEl(BRAND_MARK[i][0], BRAND_MARK[i][1]);
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'currentColor');
    node.setAttribute('stroke-width', '5');
    node.setAttribute('stroke-linejoin', 'round');
    node.setAttribute('stroke-linecap', 'round');
    svg.appendChild(node);
  }
  return svg;
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
  var hue = THUMB_HUES[idHash(p.product_id) % THUMB_HUES.length];
  var box = el('span', 'thumb' + (variant ? ' thumb--' + variant : ''));
  box.setAttribute('aria-hidden', 'true');
  var svg = svgEl('svg', { viewBox: '0 0 64 64', focusable: 'false', role: 'presentation' });
  svg.appendChild(svgEl('rect', { x: 0, y: 0, width: 64, height: 64, rx: 10, fill: 'hsl(' + hue + ', 44%, 92%)' }));
  svg.appendChild(svgEl('path', { d: 'M0 46 L64 26 L64 64 L0 64 Z', fill: 'hsl(' + hue + ', 40%, 87%)' }));
  var mark = svgEl('g', { transform: 'translate(10 10) scale(0.69)' });
  for (var i = 0; i < BRAND_MARK.length; i++) {
    var node = svgEl(BRAND_MARK[i][0], BRAND_MARK[i][1]);
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', 'hsl(' + hue + ', 38%, 38%)');
    node.setAttribute('stroke-width', '4');
    node.setAttribute('stroke-linejoin', 'round');
    node.setAttribute('stroke-linecap', 'round');
    mark.appendChild(node);
  }
  svg.appendChild(mark);
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

/** One <img>. `decorative` gives alt="" (a picture next to text that already names the product). */
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
  var gone = frame.querySelectorAll('.pmedia-img, .pmedia-credit');
  for (var i = 0; i < gone.length; i++) { frame.removeChild(gone[i]); }
  frame.classList.remove('is-photo');
  frame.classList.add('is-tile');
  frame.style.setProperty('--tile-h', String(THUMB_HUES[idHash(p.product_id) % THUMB_HUES.length]));
  frame.insertBefore(productThumb(p, 'fill'), frame.firstChild);
}

/**
 * The product's picture in a frame, always `object-fit: contain` on a neutral surface. variant:
 *   'featured' — the top of a 今日チェック card
 *   'row'      — the thumbnail at the left of a feed row
 *   'hero'     — the large square on the detail page
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
  var img = photoEl(p, im, 'pmedia-img', false, opts.eager);
  img.addEventListener('error', function () {
    fillWithTile(frame, p, opts.tileNote || null);
    if (typeof opts.onFail === 'function') { opts.onFail(); }
  });
  frame.appendChild(img);
  if (opts.artTag && im.kind === 'key_visual') {
    /* R21F: in a list the title-art warning is a corner tag, not a text line (the detail page carries the full
       credit). The picture's alt text already says 商品写真ではありません for assistive technology. */
    var tag = el('span', 'pmedia-tag', 'イメージ');
    tag.setAttribute('aria-hidden', 'true');
    tag.title = 'タイトル画像（商品写真ではありません）';
    frame.appendChild(tag);
  }
  if (opts.overlayCredit) {
    var host = imageHostShort(im);
    if (host) {
      /* one tiny line on the picture's foot: the host, with 「画像:」 kept for assistive technology */
      var cr = el('span', 'pmedia-credit');
      var full = shortCreditText(im, host);
      var cut = full.lastIndexOf(host);
      cr.appendChild(el('span', 'visually-hidden', full.slice(0, cut)));
      cr.appendChild(el('span', 'credit-host', host));
      cr.title = full;
      frame.appendChild(cr);
    }
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

/* ------------------------------------------------------------ 調べた角度（6 angles）
   research_angles is published by the build: always the same six angles in a fixed order,
   each with `known` and the rows that back it. The page only lays them out. A known angle is a
   FILLED cell, an angle not confirmed yet is a DASHED cell, and every cell also says which in
   its accessible name — colour is never the only signal. */
var ANGLE_KEYS = ['timing', 'route', 'supply', 'demand', 'value', 'risk'];
var ANGLE_LABEL = { timing: 'いつ', route: 'どこで', supply: '供給', demand: '需要', value: '価格', risk: 'リスク' };
var ANGLE_KNOWN_JA = '確認済み';
var ANGLE_UNKNOWN_JA = 'まだ確認できていません';

/** A plain YYYY-MM-DD value reads as a date; anything else is shown verbatim. */
function angleValueText(v) {
  var s = shownText(v);
  return s === null ? null : normDateText(s);
}

/**
 * The six angles in the fixed order, or null when the build did not publish them. Rows whose
 * label or value is missing (or declares itself unconfirmed) are dropped, never shown empty.
 */
function researchAnglesOf(p) {
  var ra = p && p.research_angles;
  if (!ra || typeof ra !== 'object' || !Array.isArray(ra.angles)) { return null; }
  var byKey = {};
  ra.angles.forEach(function (a) {
    if (a && typeof a === 'object' && typeof a.key === 'string') { byKey[a.key] = a; }
  });
  var out = [];
  var checked = 0;
  ANGLE_KEYS.forEach(function (key) {
    var a = own(byKey, key) || {};
    var known = a.known === true;
    if (known) { checked++; }
    var rows = (Array.isArray(a.rows) ? a.rows : []).filter(function (r) {
      return r && typeof r === 'object' && shownText(r.label_ja) !== null && angleValueText(r.value_ja) !== null;
    });
    out.push({ key: key, label: shownText(a.label_ja) || ANGLE_LABEL[key], known: known, rows: rows });
  });
  return { checked: checked, total: ANGLE_KEYS.length, angles: out, officialChecked: ra.official_pages_checked === true };
}

function angleStateText(a) { return a.label + '：' + (a.known ? ANGLE_KNOWN_JA : ANGLE_UNKNOWN_JA); }

/**
 * The compact six-dot bar for a feed row, plus 「n/6 を確認」. null when nothing is published.
 * Each dot keeps its label as text (read by assistive technology) and says 確認済み or
 * まだ確認できていません in its accessible name; a known angle is filled, an open one dashed.
 */
function angleBar(p) {
  var ra = researchAnglesOf(p);
  if (!ra) { return null; }
  var wrap = el('span', 'angles-mini');
  var bar = el('span', 'angle-bar');
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', '調べた角度 ' + ra.checked + '/' + ra.total);
  ra.angles.forEach(function (a) {
    var c = el('span', 'angle-cell' + (a.known ? ' is-known' : ''));
    c.appendChild(el('span', 'visually-hidden', a.label));
    c.setAttribute('role', 'img');
    c.setAttribute('aria-label', angleStateText(a));
    c.title = angleStateText(a);
    bar.appendChild(c);
  });
  wrap.appendChild(bar);
  wrap.appendChild(el('span', 'angle-count', ra.checked + '/' + ra.total + ' を確認'));
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
/*
 * Home = one question order: 今日チェック (≤3 FEATURED) → 最新の商材 (FEED ROWS with chips)
 * → 全商品を詳しく探す (SCREENER, paginated) → 過去の実績 (collapsed). The right rail (a column on
 * wide screens, inline modules on a phone) holds the schedule, the 買いの目安 counts, the reader's
 * own marks and two quick filters. A product appears at most twice on the page: once as a
 * featured card and once as a feed row; the screener is the full list, one page at a time.
 */


function initIndex() {
  var FEED_PAGE = 30;
  var LIST_PAGE = 50;
  var FEATURED_MAX = 3;
  var state = {
    doc: null,
    stats: null,
    metadata: null,
    products: [],
    marks: readMarks(),
    showNewBadge: true,
    /* feed */
    chip: 'all',
    feedShown: FEED_PAGE,
    /* screener page (1-based) */
    page: 1,
    /* card element registry so a mark change can re-sync every copy of a mark control */
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
    var feed = sp.get('feed');
    if (feed && own(FEED_CHIPS, feed) !== undefined) { state.chip = feed; }
    var fromHash = chipFromHash();
    if (fromHash) { state.chip = fromHash; }
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
    if (state.chip !== 'all') { sp.set('feed', state.chip); }
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
    var ids = { CANDIDATE: 'my-check-candidate', WATCH: 'my-check-watch', SKIP: 'my-check-skip' };
    Object.keys(ids).forEach(function (key) {
      var node = $(ids[key]);
      if (node) { node.textContent = String(counts[key]); }
    });
    var buttons = document.querySelectorAll('[data-mark-filter]');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].disabled = !marksAvailable;
      buttons[i].setAttribute('aria-pressed', String(filters.mark === buttons[i].dataset.markFilter));
    }
  }

  /* ------------------------------------------------------------ shared row parts */

  function detailHref(p) { return 'product.html?id=' + encodeURIComponent(p.product_id); }

  function flagBadges(box, p) {
    if (p.is_new === true && state.showNewBadge) { box.appendChild(el('span', 'badge badge--flag', '新着')); }
    if (p.status !== 'RESTOCKED' && isRestockRow(p)) { box.appendChild(el('span', 'badge badge--restock', '再販')); }
    if (p.is_attention === true && (!decisionOf(p) || decisionOf(p).actionable)) {
      box.appendChild(el('span', 'badge badge--attention', '注目候補'));
    }
  }

  /** The deadline as the eye needs it: kind, short date, relative count. Urgent colour only for a
      closing_soon_band row (deadlineParts -> isClosingSoonRow). null when there is no deadline. */
  function deadlineBox(p, className) {
    var parts = deadlineParts(p, state.doc && state.doc.as_of);
    if (!parts) { return null; }
    var dl = el('div', 'f-deadline' + (className ? ' ' + className : ''));
    dl.appendChild(el('span', 'f-lbl', parts.kind ? parts.kind : '締切'));
    if (parts.urgent) { dl.classList.add('is-urgent'); }
    else if (parts.soon) { dl.classList.add('is-soon'); }
    else if (parts.muted) {
      dl.classList.add('is-unconfirmed');
      /* R21H: no 「・要確認」 text — the published date is a fact; the muted colour alone says the acceptance state
         is not confirmed (it is never drawn as open or urgent) */
    }
    var dateNode = el('span', 'f-date', parts.date);
    dateNode.setAttribute('aria-label', parts.fullDate || parts.date);
    dl.appendChild(dateNode);
    if (parts.rel) { dl.appendChild(el('span', 'f-rel' + (parts.passed ? ' is-passed' : ''), parts.rel)); }
    return dl;
  }

  /** 「発売」 line for a row without a deadline. null when the release date is not published. */
  function releaseBox(p) {
    var r = releaseText(p);
    if (r === null) { return null; }
    /* R21F: 「2026年10月」 already reads as a month; the 「（日付は未発表）」 note is on the detail page */
    if (p.release_date_precision === 'month') { r = r.replace(/（日付は未発表）$/, ''); }
    var box = el('div', 'f-deadline f-release');
    box.appendChild(el('span', 'f-lbl', '発売'));
    box.appendChild(elKeep('span', 'f-date', r));
    return box;
  }

  /** Action row: the detail page (information first) and the checked https link, if any. */
  function cardActions(p) {
    var actions = el('div', 'card-actions');
    var detailLink = el('a', 'card-action card-action--detail', '条件・根拠を見る');
    detailLink.href = detailHref(p);
    if (!isUnknown(p.product_name)) { detailLink.setAttribute('aria-label', String(p.product_name) + '：条件・根拠を見る'); }
    actions.appendChild(detailLink);
    var ext = outboundCta(p, 'card-action card-action--ext');
    if (ext) { actions.appendChild(ext); }
    return actions;
  }

  function markLabel(id) {
    for (var i = 0; i < MARKS.length; i++) { if (MARKS[i].id === id) { return MARKS[i].label; } }
    return '';
  }
  function markSumText(current) { return current === 'UNDECIDED' ? '印' : '印：' + markLabel(current); }

  /** The reader's own mark, folded into a small menu. Styled as a personal tag, never like the
      買いの目安 glyphs. */
  function markMenu(p) {
    var current = getMark(state.marks, p.product_id);
    var d = el('details', 'mark-menu' + (current !== 'UNDECIDED' ? ' is-marked' : ''));
    var s = el('summary', 'mark-sum', markSumText(current));
    s.setAttribute('aria-label', 'あなたの印：' + (current === 'UNDECIDED' ? '印なし' : markLabel(current)) + '（選び直す）');
    s.setAttribute('aria-expanded', 'false');
    d.appendChild(s);
    d.addEventListener('toggle', function () { s.setAttribute('aria-expanded', String(d.open)); });
    /* Escape closes the menu and gives focus back to its trigger */
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && d.open) { e.preventDefault(); d.open = false; s.focus(); }
    });
    var box = markControl(p.product_id, current, onMarkPick);
    d.appendChild(box);
    if (!state.markBoxes[p.product_id]) { state.markBoxes[p.product_id] = []; }
    state.markBoxes[p.product_id].push(box);
    return d;
  }

  function onMarkPick(markId, box) {
    var li = box.closest('.card');
    if (!li) { return; }
    var id = li.dataset.id;
    if (markId === 'UNDECIDED') { delete state.marks[id]; }
    else { state.marks[id] = markId; }
    writeMarks(state.marks);
    (state.markBoxes[id] || []).forEach(function (b) {
      syncMarkButtons(b, markId);
      var menu = b.closest('.mark-menu');
      if (menu) {
        var sum = menu.querySelector('.mark-sum');
        sum.textContent = markSumText(markId);
        sum.setAttribute('aria-label', 'あなたの印：' + (markId === 'UNDECIDED' ? '印なし' : markLabel(markId)) + '（選び直す）');
        menu.classList.toggle('is-marked', markId !== 'UNDECIDED');
      }
    });
    /* the menu closes under the pressed button: focus goes back to the 「印」 trigger, never to <body> */
    var own2 = box.closest('.mark-menu');
    if (own2) {
      own2.open = false;
      var trigger = own2.querySelector('.mark-sum');
      if (trigger) { trigger.focus(); }
    }
    if (!marksAvailable) {
      var note = $('my-check-note');
      if (note) { note.textContent = 'お使いのブラウザの設定により、印を保存できません。'; }
    }
    renderMyCheck();
    /* Re-filter only when the mark filter is active, so the list stays stable. */
    if (filters.mark) { renderList(); }
  }

  /** 定価 + the compact 買いの目安 mark, grouped as the value column of a row. */
  function rowStrip(p, quiet) {
    var b = buySignalOf(p);
    var listP = fmtListPrice(p);
    var acq = fmtPrice(acquisitionCostOf(p));
    if (!b && listP === null && acq === null) { return null; }
    var inf = inferenceOf(p);
    var level = inf ? inf.level : (b ? b.level : null);
    var box = el('dl', 'vstrip' + (level ? ' buy--' + level : '') + (inf ? ' is-inferred' : ''));
    box.setAttribute('aria-label', '価格と買いの目安（参考）');
    if (listP !== null) {
      var pc = el('div', 'vs-cell vs-cell--price');
      pc.appendChild(el('dt', 'vs-lbl', '定価'));
      pc.appendChild(elKeep('dd', 'vs-val', listP));
      box.appendChild(pc);
    }
    if (acq !== null) {
      var ac = el('div', 'vs-cell vs-cell--acq');
      ac.appendChild(el('dt', 'vs-lbl', '取得原価'));
      ac.appendChild(elKeep('dd', 'vs-val', acq));
      box.appendChild(ac);
    }
    if (b) {
      var bc = el('div', 'vs-cell vs-cell--buy');
      bc.appendChild(el('dt', 'visually-hidden', '買いの目安（参考）'));
      var dd = el('dd', 'vs-val');
      dd.appendChild(buyMark(inf || b, quiet));
      /* R21H: the basis is in the label (「類似品から」); no 確からしさ score in a list */
      if (!quiet && inf && shownText(inf.confidence_ja) !== null) {
        /* the level's own label already says （推論） */
        dd.appendChild(elKeep('span', 'vs-conf', (/推論/.test(String(inf.label_ja)) ? '' : '推論・') + '確からしさ ' + inf.confidence_ja));
      }
      bc.appendChild(dd);
      box.appendChild(bc);
    }
    return box;
  }

  /* ------------------------------------------------------------ A FEATURED */

  function buildFeatured(p) {
    /* R22: one decision unit per card — tier and confidence, the name, then why now / price / similar products /
       driver / risk / next check / evidence and its date. No image box: the decision is in the words. */
    var li = el('li', 'card card--featured card--decision');
    li.dataset.id = p.product_id;
    var a = el('div', 'card-main');
    var head = el('div', 'dc-head');
    put(head, decisionChips(p));
    /* one fact once per decision unit: the 「いつ」 row already says 発売済み / 受付開始前 / 締切 */
    var d0 = decisionOf(p);
    if (!d0 || !shownText(d0.why_now_ja)) { put(head, statusBadge(p)); }
    a.appendChild(head);
    var name = wordWrapText(el('a', 'c-name dc-name'), isUnknown(p.product_name) ? '商品の詳細' : String(p.product_name));
    name.href = detailHref(p);
    a.appendChild(name);
    var meta = identityMeta(p, true);
    if (meta.length) { a.appendChild(el('div', 'c-cat', meta.join('・'))); }
    put(a, decisionFacts(p, false));
    li.appendChild(a);
    put(li, backtestLine(p));
    li.appendChild(cardActions(p));
    return li;
  }

  /** 利益検討候補: PROFIT_CANDIDATE only, at most 3, never filled up with weaker items. */
  function renderProfitTop() {
    var list = $('profit-list');
    var note = $('profit-note');
    if (!list || !note) { return; }
    var all = state.products.filter(inScope);
    /* strongest profit first (the backend's 利益力), then 確度; ties keep the listing order */
    var cands = all.filter(function (p) { return profitOf(p) && profitOf(p).state === 'PROFIT_CANDIDATE'; })
      .sort(function (a, b) {
        var pa = profitOf(a), pb = profitOf(b);
        return ((pb.profit_power || {}).score || 0) - ((pa.profit_power || {}).score || 0) ||
          ((pb.confidence || {}).score || 0) - ((pa.confidence || {}).score || 0) || cmpDecision(a, b);
      }).slice(0, 3);
    list.textContent = '';
    cands.forEach(function (p) {
      var li = el('li', 'card card--profit');
      li.dataset.id = p.product_id;
      var name = wordWrapText(el('a', 'c-name dc-name'), String(p.product_name));
      name.href = detailHref(p);
      li.appendChild(name);
      put(li, profitBlock(p, true));
      var d = decisionOf(p);
      if (d && d.why_now_ja) { li.appendChild(el('p', 'pa-why', 'いつ：' + d.why_now_ja)); }
      list.appendChild(li);
    });
    list.hidden = cands.length === 0;
    var heads = document.querySelectorAll('#today .sub-title');
    for (var hi = 0; hi < heads.length; hi++) { heads[hi].hidden = cands.length === 0; }
    var computed = all.filter(function (p) { return profitOf(p) && num(profitOf(p).economics.net_profit_base) !== null; });
    var neg = computed.filter(function (p) { return profitOf(p).state === 'NEGATIVE_MARGIN'; }).length;
    note.textContent = '';
    if (cands.length) {
      keepText(note, '利益検討候補 ' + cands.length + '件（成約データ・手数料・送料から試算。購入の指示ではありません）');
    } else {
      keepText(note, '利益検討候補：該当なし（試算' + computed.length + '件' + (neg === computed.length ? 'は条件外' : '中' + neg + '件が条件外') + '）');
      note.title = '試算できた商品は、販売手数料と送料を引くと利益条件を満たしません。ほかは取得価格や成約データがそろっていません。';
    }
  }

  function renderFeatured() {
    renderProfitTop();
    var list = $('featured-list');
    if (!list) { return; }
    var rows = firstLook(state.products.filter(inScope), FEATURED_MAX);
    state.firstLookIds = rows.map(function (p) { return p.product_id; });
    list.textContent = '';
    var frag = document.createDocumentFragment();
    rows.forEach(function (p) { frag.appendChild(buildFeatured(p)); });
    list.appendChild(frag);
    list.dataset.count = String(rows.length);
    var subNode = $('today-sub');
    if (subNode) {
      subNode.textContent = '';
      /* the counts are said once, in the profit note under the title (one fact once) */
    }
    $('today-empty').hidden = rows.length !== 0;
    list.hidden = rows.length === 0;
  }

  /** A swipe row (phones) is a scroll container: it gets a tab stop and a name so it can be
      scrolled with the arrow keys. On wide screens the same list is a plain grid: no tab stop. */
  function syncRail(ul) {
    if (!ul) { return; }
    if (ul.children.length && ul.scrollWidth > ul.clientWidth + 4) {
      ul.setAttribute('tabindex', '0');
      ul.setAttribute('aria-label', '今日チェック（横にスクロールできます）');
    } else {
      ul.removeAttribute('tabindex');
      ul.removeAttribute('aria-label');
    }
  }

  /* ------------------------------------------------------------ B FEED ROW */

  /**
   * One feed row. Fixed reading order: status chips → 商品名 (2 lines) → IP・分野・方式 → 調べた角度
   * → [right column] 締切 or 発売 → 定価 + 買いの目安. Long explanations are not in the row: the
   * detail page carries them. The evidence line (similar products) sits outside the link because
   * it carries its own 「数え方」 link.
   */
  function buildFeedRow(p) {
    var li = el('li', 'card card--feed' + (isUnverifiedRow(p) ? ' is-unverified' : ''));
    li.dataset.id = p.product_id;
    var a = el('div', 'card-main');
    /* R21F: the row shows the picture only. Its source and the title-art explanation are on the detail page;
       title art keeps a short corner tag (イメージ) so it never passes as a product photo. */
    a.appendChild(productMedia(p, 'row', { artTag: true }));

    /* R21H: the 調べた角度 dots are not shown in a list (the detail page has the angle summary) */
    var body = el('div', 'row-body');
    /* one meta strip above the name — state, verification, flags, then IP・分野・方式 — so the
       name keeps its full two lines */
    var top = el('div', 'row-top');
    var st = el('div', 'c-status');
    var dec = decisionOf(p);
    if (dec && dec.tier === 'LEAD') { st.appendChild(el('span', 'tier-chip tier--lead', String(dec.tier_label_ja))); }
    put(st, statusBadge(p));
    flagBadges(st, p);
    if (st.children.length) { top.appendChild(st); }
    body.appendChild(top);
    /* the name is the row's one link to the detail page; CSS stretches its hit area over the whole
       row, so the row itself is the link without a separate button */
    var nameText = isUnknown(p.product_name) ? '商品の詳細' : String(p.product_name);
    var name = wordWrapText(el('a', 'c-name row-link card-action--detail'), nameText);
    name.href = detailHref(p);
    name.title = nameText;   /* clamped to two lines; the full name is on the detail page */
    name.setAttribute('aria-label', nameText + '：条件・根拠を見る');
    body.appendChild(name);
    /* IP・分野・方式; a phone drops the 分野 word rather than cutting the line to one word */
    var metaRow = el('div', 'row-meta c-cat');
    var metaParts = [];
    if (!isUnknown(p.ip)) { metaParts.push([String(p.ip), null]); }
    var catWord = lbl(CATEGORY_LABEL, p.category);
    if (catWord) { metaParts.push([catWord, 'meta-cat']); }
    var modeWord = lbl(SALE_MODE_LABEL, p.sale_mode);
    if (modeWord) { metaParts.push([modeWord, null]); }
    metaParts.forEach(function (part, i) {
      metaRow.appendChild(el('span', part[1], (i ? '・' : '') + part[0]));
    });
    if (metaParts.length) { top.appendChild(metaRow); }
    if (!top.children.length) { body.removeChild(top); }
    a.appendChild(body);

    var when = deadlineBox(p) || releaseBox(p);
    if (when) { when.classList.add('row-when'); a.appendChild(when); }
    put(a, rowStrip(p, true));
    li.appendChild(a);

    put(li, backtestLine(p));
    /* 更新 M/D: when this product was last checked or observed (a checked product: its last verification; a newly found one:
       latest observation) — not the time the list was rebuilt. Omitted when unknown. */
    var actions = el('div', 'card-actions');
    var upd = fmtShortDay(p.updated_at, state.doc && state.doc.as_of);
    if (upd) {
      /* R22: the date this item's facts were last checked — a stale one says so */
      var fr = decisionOf(p) && decisionOf(p).freshness;
      var u = el('span', 'row-upd' + (fr && fr.band === 'STALE' ? ' is-stale' : ''), upd + ' 確認');
      u.title = 'この商品を最後に確認・観測した日' + (fr && fr.days !== null && fr.days !== undefined ? '（' + fr.days + '日前）' : '');
      actions.appendChild(u);
    }
    /* one quiet outbound text link and the reader's own 「印」 */
    put(actions, outboundCta(p, 'card-action card-action--ext'));
    actions.appendChild(markMenu(p));
    li.appendChild(actions);
    return li;
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
  function normQuery() { return filters.q.trim().toLowerCase().replace(/\s+/g, ' '); }
  /** The query as a list of terms; each term is a list of spellings, any of which may match.
      A multi-word alias (「one piece」) is taken as one term before the split on spaces. */
  function queryTerms(q) {
    var terms = [];
    var rest = q;
    SEARCH_ALIASES.forEach(function (g) {
      g.forEach(function (spelling) {
        var at = rest.indexOf(spelling);
        while (at !== -1) {
          terms.push(g);
          rest = rest.slice(0, at) + ' ' + rest.slice(at + spelling.length);
          at = rest.indexOf(spelling);
        }
      });
    });
    rest.split(/\s+/).forEach(function (t) { if (t) { terms.push([t]); } });
    return terms;
  }
  function matchesQuery(p, q) {
    if (!q) { return true; }
    var hay = haystack(p);
    /* whitespace tolerant: every term must appear somewhere, in any of its spellings */
    return queryTerms(q).every(function (spellings) {
      return spellings.some(function (t) { return hay.indexOf(t) !== -1; });
    });
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
  /** The scope shared by every list on the page: the category tab and the keyword. */
  function inScope(p) { return inTab(p) && matchesQuery(p, normQuery()); }

  function applyFilters() {
    var q = normQuery();
    var sec = filters.sec ? sectionById(filters.sec) : null;
    return state.products.filter(function (p) {
      /* The section filter reuses the section's OWN predicate, so a chip's 「全商品一覧で開く」
         can never show a different set than the chip it came from. */
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
      if (filters.buy && effectiveLevel(p) !== filters.buy) { return false; }
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
    if (!b) { return [9, 9, 9, 9, 0]; }
    var missing = Array.isArray(b.missing_ja) ? b.missing_ja.length : 0;
    var noData = b.level === 'NOT_ENOUGH_EVIDENCE' && !(num(b.analogs_evaluable) > 0) ? 1 : 0;
    /* evidence before inference at the same level */
    return [BUY_LEVELS.indexOf(effectiveLevel(p)), inferenceOf(p) ? 1 : 0, noData, missing, -(num(b.analogs_evaluable) || 0)];
  }
  function cmpBuy(a, b) {
    var ra = buyRank(a), rb = buyRank(b);
    for (var i = 0; i < ra.length; i++) { if (ra[i] !== rb[i]) { return ra[i] - rb[i]; } }
    return cmpDeadline(a, b);
  }
  var byFirstSeenDesc = cmpNullsLast(function (p) {
    return isUnknown(p.first_seen_at) ? null : String(p.first_seen_at);
  }, -1);
  var byUpdatedDesc = cmpNullsLast(function (p) {
    return isUnknown(p.updated_at) ? null : String(p.updated_at);
  }, -1);
  /** 最新の商材 (すべて): what has been confirmed furthest first (公式情報で確認済み → 一部確認 → 未検証; the
      unconfirmed rows stay one chip away and lead 今日チェック), then the most recently updated, then
      the most recently found, then the deadline. How far the facts are confirmed — never a value. */
  var TIER_ORDER = ['CANONICAL_VERIFIED', 'CANONICAL_PARTIAL', 'DISCOVERY_UNVERIFIED'];
  function tierRank(p) { var i = TIER_ORDER.indexOf(p.verification_tier); return i < 0 ? 9 : i; }
  function cmpFeedAll(a, b) {
    var ta = tierRank(a), tb = tierRank(b);
    if (ta !== tb) { return ta - tb; }
    var ua = isUnknown(a.updated_at) ? '' : String(a.updated_at);
    var ub = isUnknown(b.updated_at) ? '' : String(b.updated_at);
    if (ua !== ub) { return ua < ub ? 1 : -1; }
    var fa = isUnknown(a.first_seen_at) ? '' : String(a.first_seen_at);
    var fb = isUnknown(b.first_seen_at) ? '' : String(b.first_seen_at);
    if (fa !== fb) { return fa < fb ? 1 : -1; }
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

  /* 買いの目安: four counts, each a filter of 全商品一覧. Glyph + word, never colour alone. */
  function renderBuyPanel() {
    var panel = $('buy-panel');
    if (!panel) { return; }
    var counts = {}, inferred = {};
    BUY_LEVELS.forEach(function (l) { counts[l] = 0; inferred[l] = 0; });
    state.products.forEach(function (p) {
      var l = effectiveLevel(p);
      if (l) { counts[l] += 1; if (inferenceOf(p)) { inferred[l] += 1; } }
    });
    BUY_LEVELS.forEach(function (l) {
      var n = $('buy-n-' + l);
      if (n) { n.textContent = String(counts[l]); }
      var sub = $('buy-inf-' + l);
      if (sub) {
        sub.textContent = '';
        if (inferred[l]) { keepText(sub, 'うち推論' + inferred[l] + '件'); }
        sub.hidden = !inferred[l];
      }
      var btn = panel.querySelector('[data-buy="' + l + '"]');
      if (btn) { btn.setAttribute('aria-pressed', filters.buy === l ? 'true' : 'false'); }
    });
  }

  /* 過去の実績: past products with a complete 1-month window, the published arithmetic,
     most above list first — the "which kinds of product left a margin" view. Collapsed. */
  function renderTrackRecord() {
    var root = $('sec-track');
    var list = $('track-list');
    var rows = (state.doc && Array.isArray(state.doc.track_record)) ? state.doc.track_record : [];
    if (!root || !list) { return; }
    root.hidden = rows.length === 0;
    list.textContent = '';
    $('track-count').textContent = '全' + rows.length + '件';
    rows.forEach(function (t) {
      var li = el('li', 'track-item' + (t.diff_before_shipping_jpy > 0 ? ' is-plus' : ' is-minus'));
      var name = el('div', 'track-name');
      wordWrapText(name, String(t.comparable_name));
      li.appendChild(name);
      var nums = el('div', 'track-nums');
      nums.appendChild(elKeep('span', 'track-ratio', '定価の' + Number(t.price_to_list_ratio).toFixed(2) + '倍'));
      nums.appendChild(elKeep('span', 'track-prices', fmtPrice(t.list_price_jpy) + ' → ' + fmtPrice(t.reference_sale_jpy) +
        '（' + t.sales_n + '件の中央値）'));
      nums.appendChild(elKeep('span', 'track-diff', '手数料後の差 ' + fmtSignedYenPlain(t.diff_before_shipping_jpy) + '（送料別）'));
      var ship = marginAfterShippingText(t);
      if (ship) { nums.appendChild(elKeep('span', 'track-ship', ship)); }
      li.appendChild(nums);
      list.appendChild(li);
    });
  }

  function renderKpis() {
    var total = pick(statNum('counts', 'total'), state.products.length);
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
    var pre = sectionById('sec-preorder');
    var lot = sectionById('sec-lottery');
    var values = {
      'kpi-total': total,
      'kpi-open': open,
      'kpi-closing': closing,
      'kpi-preorder': pick(statNum('counts', 'open_preorder'), derived(pre.pick)),
      'kpi-lottery': pick(statNum('counts', 'open_lottery'), derived(lot.pick)),
      'kpi-restock': pick(statNum('counts', 'restocked'), derived(function (p) { return p.status === 'RESTOCKED'; })),
      'kpi-new': pick(statNum('counts', 'new_items'), derived(function (p) { return p.is_new === true; }))
    };
    Object.keys(values).forEach(function (id) {
      var node = $(id);
      if (!node) { return; }
      node.textContent = String(values[id]);
      var btn = node.closest('.kpi');
      if (btn) { btn.classList.toggle('is-zero', values[id] === 0); }
    });
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
  }

  function anyListFilter() {
    return !!(filters.q || filters.cat || filters.mode || filters.status || filters.ev || filters.profit ||
      filters.signal || filters.deadline || filters.release || filters.mark || filters.sec || filters.buy ||
      filters.onlyNew || filters.onlyRestock || filters.onlyAttention);
  }
  function syncKpiPressed() {
    var btns = document.querySelectorAll('.kpi');
    for (var i = 0; i < btns.length; i++) {
      var chip = btns[i].dataset.chip;
      var on = chip ? state.chip === chip : (btns[i].dataset.kpi === 'total' && !anyListFilter());
      btns[i].setAttribute('aria-pressed', String(on));
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
  var statusOptions = [];
  var statusOptionLabels = {};
  function buildSelects() {
    var cats = [], modes = [], statuses = [], statusLabels = {}, signals = [], sigLabels = {};
    state.products.forEach(function (p) {
      /* An option is offered only for a value that has a displayable label: UNKNOWN (and a
         status whose label says it is unconfirmed) is not a choice on the page. */
      if (catChoiceLabel(p.category) && cats.indexOf(p.category) === -1) { cats.push(p.category); }
      if (lbl(SALE_MODE_LABEL, p.sale_mode) && modes.indexOf(p.sale_mode) === -1) { modes.push(p.sale_mode); }
      if (statuses.indexOf(p.status) === -1) {
        if (hasShownStatus(p)) {
          statuses.push(p.status);
          statusLabels[p.status] = own(STATUS_CHOICE_LABEL, p.status) || String(p.status_label_ja);
        } else if (p.status === 'UNKNOWN') {
          /* the acceptance state is not confirmed: no badge on the product, but a reachable choice */
          statuses.push(p.status);
          statusLabels[p.status] = STATUS_CHOICE_LABEL.UNKNOWN;
        }
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
    fillSelect($('f-cat'), cats, function (v) { return catChoiceLabel(v); });
    fillSelect($('f-mode'), modes, function (v) { return lbl(SALE_MODE_LABEL, v); });
    var statusSel = $('f-status');
    var grp = document.createElement('option');
    grp.value = GROUP_OPEN;
    grp.textContent = '受付中（抽選・予約）';
    statusSel.appendChild(grp);
    fillSelect(statusSel, statuses, function (v) { return statusLabels[v]; });
    fillSelect($('f-signal'), signals, function (v) { return sigLabels[v]; });
    statusOptions = statuses;
    statusOptionLabels = statusLabels;
  }

  /* 状態 quick filter (rail): one button per acceptance state that has a label, with the published
     by_status count. A tap filters 全商品一覧; the same button again clears it. */
  function buildStatusQuick() {
    var row = $('status-row');
    if (!row) { return; }
    row.textContent = '';
    statusOptions.forEach(function (s) {
      var n = pick(statNum('by_status', s), derived(function (p) { return p.status === s; }));
      var b = el('button', 'qchip');
      b.type = 'button';
      b.dataset.status = s;
      b.appendChild(el('span', null, statusOptionLabels[s]));
      b.appendChild(el('span', 'qchip-n', String(n)));
      b.setAttribute('aria-label', statusOptionLabels[s] + '（' + n + '件）で全商品一覧を絞り込む');
      b.addEventListener('click', function () {
        var again = filters.status === s;
        filters.status = again ? '' : s;
        filters.sec = '';
        state.page = 1;
        syncControlsFromFilters(); writeUrl(); renderList();
        if (!again) { scrollToId('sec-all'); }
      });
      row.appendChild(b);
    });
    $('status-quick').hidden = statusOptions.length === 0;
  }
  function syncStatusQuick() {
    var btns = document.querySelectorAll('#status-row .qchip');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(filters.status === btns[i].dataset.status));
    }
  }

  /* ------------------------------------------------------------ 利ざや候補（参考）
     Candidates = an effective level of 買い寄り or 様子見 (evidence, or 推論 when the product's own
     evidence is short). 見送り寄り is not a candidate. Products that are close to a level but not
     there yet are listed separately with what they still need — never mixed into the order. */
  var MARGIN_LEVELS = ['LEAN_BUY', 'MIXED_SIGNALS'];
  function isMarginCandidate(p) { return MARGIN_LEVELS.indexOf(effectiveLevel(p)) !== -1; }
  function isNearSignal(p) {
    var b = buySignalOf(p);
    return !!b && effectiveLevel(p) === 'NOT_ENOUGH_EVIDENCE' &&
      (num(b.analogs_evaluable) > 0 || /BOXの公式定価/.test(String(b.inference_blocked_ja || '')));
  }
  /* Ordering uses a ratio only when at least 3 analogs stand behind it (the reference minimum);
     a thinner ratio is still shown on the detail page with its 類似品N件, but it does not move the order. */
  function marginRatio(p) {
    var info = hasEvaluableBacktest(p) ? backtestRatioInfo(backtestOf(p)) : null;
    return info && info.n >= 3 ? info.ratio : null;
  }
  function cmpMargin(a, b) {
    var la = BUY_LEVELS.indexOf(effectiveLevel(a)), lb = BUY_LEVELS.indexOf(effectiveLevel(b));
    if (la !== lb) { return la - lb; }
    var ia = inferenceOf(a) ? 1 : 0, ib = inferenceOf(b) ? 1 : 0;
    if (ia !== ib) { return ia - ib; }
    var ra = marginRatio(a), rb = marginRatio(b);
    if (ra === null && rb !== null) { return 1; }
    if (rb === null && ra !== null) { return -1; }
    if (ra !== null && rb !== null && ra !== rb) { return rb - ra; }
    return cmpDeadline(a, b);
  }

  /** The chip's own headline (says plainly when nothing is 買い寄り) and the 「判定に近い商品」 list. */
  function renderMargin() {
    var rows = state.products.filter(inScope).filter(isMarginCandidate);
    var lean = rows.filter(function (p) { return effectiveLevel(p) === 'LEAN_BUY'; });
    var inferred = rows.filter(function (p) { return !!inferenceOf(p); }).length;
    var stateNode = $('margin-state');
    if (stateNode) {
      var infTxt = inferred ? '（うち推論 ' + inferred + '件）' : '';
      stateNode.textContent = '';
      keepText(stateNode, lean.length
        ? '「買い寄り」は ' + lean.length + '件です。目安が出ている ' + rows.length + '件' + infTxt + 'を並べています。'
        : (rows.length
          ? '今の時点で「買い寄り」の商品はありません。いちばん近いのは「様子見」の ' + rows.length + '件' + infTxt + 'です。'
          : '今の時点で、目安が出ている商品はありません。目安まであと少しの商品は下のとおりです。'));
      stateNode.classList.toggle('has-lean', lean.length > 0);
    }
    var near = state.products.filter(inScope).filter(isNearSignal).sort(cmpBuy);
    var wrap = $('margin-near-wrap');
    var list = $('margin-near');
    if (wrap && list) {
      list.textContent = '';
      wrap.hidden = near.length === 0;
      near.forEach(function (p) {
        var li = el('li', 'near-item');
        var a = el('a', 'near-link');
        a.href = detailHref(p);
        a.appendChild(wordWrapText(el('span', 'near-name'), String(p.product_name || '')));
        var need = buyNeedText(p);
        if (need) {
          var np = el('span', 'near-need');
          np.appendChild(el('span', 'near-need-lbl', 'あと必要なもの'));
          keepText(np, need);
          a.appendChild(np);
        }
        li.appendChild(a);
        list.appendChild(li);
      });
    }
    var go = $('buy-go-n');
    if (go) { go.textContent = String(rows.length + near.length); }
  }

  /* ------------------------------------------------------------ 分野タブ
     One row of buttons: すべて + every category that has a label and at least one product.
     A tab IS the カテゴリ filter (filters.cat): it narrows 今日チェック, the feed, the schedule and
     全商品一覧 alike, and the カテゴリ select stays in step with it. */
  function inTab(p) { return !filters.cat || p.category === filters.cat; }

  function setCategory(cat) {
    filters.cat = cat;
    filters.sec = '';
    state.page = 1;
    state.feedShown = FEED_PAGE;
    syncControlsFromFilters();
    writeUrl();
    renderScoped();
    renderList();
  }

  function buildCatTabs() {
    var row = $('cat-tabs-row');
    if (!row) { return; }
    row.textContent = '';
    var counts = {};
    var cats = [];
    state.products.forEach(function (p) {
      if (!catChoiceLabel(p.category)) { return; }
      if (!Object.prototype.hasOwnProperty.call(counts, p.category)) { counts[p.category] = 0; cats.push(p.category); }
      counts[p.category] += 1;
    });
    var order = Object.keys(CATEGORY_LABEL);
    cats.sort(function (a, b) {
      var ka = order.indexOf(a), kb = order.indexOf(b);
      return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb);
    });
    var tabs = [['', 'すべて', state.products.length]].concat(cats.map(function (c) {
      return [c, catChoiceLabel(c), counts[c]];
    }));
    tabs.forEach(function (t) {
      var b = el('button', 'cat-tab qchip');
      b.type = 'button';
      b.dataset.cat = t[0];
      b.appendChild(el('span', 'cat-tab-lbl', t[1]));
      b.appendChild(el('span', 'qchip-n', String(t[2])));
      b.setAttribute('aria-label', t[1] + '（' + t[2] + '件）');
      b.addEventListener('click', function () {
        if (filters.cat === t[0]) { return; }
        setCategory(t[0]);
      });
      row.appendChild(b);
    });
    var nav = $('cat-tabs');
    if (nav) { nav.hidden = cats.length === 0; }
    /* the navigation carries the same categories (short names), so its choices add up to the total */
    var end = $('topnav-cats-end');
    if (end) {
      var old = document.querySelectorAll('.topnav-cat-item');
      for (var i = 0; i < old.length; i++) { old[i].parentNode.removeChild(old[i]); }
      cats.forEach(function (c) {
        var li = el('li', 'topnav-cat-item');
        var b = el('button', 'topnav-cat', own(NAV_CAT_LABEL, c) || catChoiceLabel(c));
        b.type = 'button';
        b.dataset.navCat = c;
        b.setAttribute('aria-pressed', 'false');
        b.setAttribute('aria-label', catChoiceLabel(c) + '（' + counts[c] + '件）');
        b.addEventListener('click', function () {
          setCategory(filters.cat === c ? '' : c);
          scrollToId('feed');
        });
        li.appendChild(b);
        end.parentNode.insertBefore(li, end);
      });
    }
  }

  function syncCatTabs() {
    var btns = document.querySelectorAll('#cat-tabs-row .cat-tab');
    for (var i = 0; i < btns.length; i++) {
      btns[i].setAttribute('aria-pressed', String(btns[i].dataset.cat === (filters.cat || '')));
    }
    var navBtns = document.querySelectorAll('[data-nav-cat]');
    for (var j = 0; j < navBtns.length; j++) {
      navBtns[j].setAttribute('aria-pressed', String(navBtns[j].dataset.navCat === filters.cat));
    }
    var note = $('cat-tabs-note');
    if (note) {
      var label = filters.cat ? catChoiceLabel(filters.cat) : null;
      var n = state.products.filter(inTab).length;
      note.textContent = label ? '「' + label + '」の商品だけを表示しています（' + n + '件）。' : '';
      note.hidden = !label;
    }
  }

  /* ------------------------------------------------------------ これからの予定
     Every published calendar date on or after the as_of date becomes one agenda line. Only
     day-precision dates are used: a month-only release is never placed on a guessed day.
     Weekdays are calendar arithmetic on the published date, not new information. */
  var SCHEDULE_FIELDS = [
    ['release_date', '発売'], ['reservation_start', '予約開始'], ['reservation_end', '予約締切'],
    ['application_start', '応募開始'], ['application_end', '応募締切'],
    ['lottery_start', '抽選受付開始'], ['lottery_end', '抽選受付締切'], ['result_date', '抽選結果'],
    ['payment_deadline', '支払期限'], ['sales_end', '販売終了']
  ];
  var SCHEDULE_CAP = 8;
  var DOW_JA = ['日', '月', '火', '水', '木', '金', '土'];
  var scheduleOpen = false;

  function isoDay(v) {
    if (isUnknown(v)) { return null; }
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).slice(0, 10));
    return m ? m[0] : null;
  }
  function dayParts(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return { y: Number(m[1]), mo: Number(m[2]), d: Number(m[3]), dow: DOW_JA[d.getUTCDay()] };
  }
  function addDays(iso, n) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n));
    return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '-' + ('0' + d.getUTCDate()).slice(-2);
  }

  function scheduleEvents(asOf) {
    var out = [];
    state.products.filter(inTab).forEach(function (p) {
      var seen = {};
      SCHEDULE_FIELDS.forEach(function (f, order) {
        if (f[0] === 'release_date' && p.release_date_precision !== 'day') { return; }
        var day = isoDay(p[f[0]]);
        if (!day || day < asOf) { return; }
        var key = day + '|' + f[1];
        if (seen[key]) { return; }
        seen[key] = true;
        seen[day] = true;
        out.push({ day: day, kind: f[1], order: order, p: p });
      });
      /* the build's own nearest deadline, when no dated field above already covers that day */
      var dl = isoDay(p.deadline);
      if (dl && dl >= asOf && !seen[dl]) {
        out.push({ day: dl, kind: lbl(DEADLINE_KIND_LABEL, p.deadline_kind) || '締切', order: SCHEDULE_FIELDS.length, p: p });
      }
    });
    out.sort(function (a, b) {
      if (a.day !== b.day) { return a.day < b.day ? -1 : 1; }
      if (a.order !== b.order) { return a.order - b.order; }
      return String(a.p.product_name || '') < String(b.p.product_name || '') ? -1 : 1;
    });
    return out;
  }

  function renderSchedule() {
    var root = $('sec-schedule');
    var week = $('sched-week');
    var list = $('sched-list');
    var empty = $('sched-empty');
    var more = $('sched-more');
    if (!root || !week || !list) { return; }
    var asOf = state.doc ? isoDay(state.doc.as_of) : null;
    root.hidden = !asOf;
    if (!asOf) { return; }
    var events = scheduleEvents(asOf);
    var perDay = {};
    events.forEach(function (e) { perDay[e.day] = (perDay[e.day] || 0) + 1; });

    week.textContent = '';
    for (var i = 0; i < 7; i++) {
      var day = addDays(asOf, i);
      var dp = dayParts(day);
      var n = perDay[day] || 0;
      var li = el('li', 'sw-day' + (i === 0 ? ' is-base' : '') + (n ? ' has-events' : ''));
      li.appendChild(el('span', 'sw-dow', dp.dow));
      li.appendChild(el('span', 'sw-num', String(dp.d)));
      var dot = el('span', 'sw-dot');
      dot.setAttribute('aria-hidden', 'true');
      li.appendChild(dot);
      li.appendChild(el('span', 'visually-hidden',
        dp.mo + '月' + dp.d + '日' + (i === 0 ? '（基準日）' : '') + (n ? '・予定' + n + '件' : '・予定なし')));
      week.appendChild(li);
    }

    list.textContent = '';
    var baseYear = dayParts(asOf).y;
    var shown = scheduleOpen ? events : events.slice(0, SCHEDULE_CAP);
    shown.forEach(function (e) {
      var dp = dayParts(e.day);
      var li = el('li', 'sched-row');
      var a = el('a', 'sched-item');
      a.href = detailHref(e.p);
      var date = el('span', 'sched-date');
      date.appendChild(el('span', 'nb', (dp.y !== baseYear ? dp.y + '/' : '') + dp.mo + '/' + dp.d + '（' + dp.dow + '）'));
      a.appendChild(date);
      var body = el('span', 'sched-body');
      var meta = [e.kind];
      var cat = lbl(CATEGORY_LABEL, e.p.category);
      if (cat) { meta.push(cat); }
      body.appendChild(el('span', 'sched-kind', meta.join(' ・ ')));
      var sn = wordWrapText(el('span', 'sched-name'), isUnknown(e.p.product_name) ? '商品の詳細' : String(e.p.product_name));
      sn.title = sn.textContent;   /* clamped to two lines */
      body.appendChild(sn);
      a.appendChild(body);
      li.appendChild(a);
      list.appendChild(li);
    });
    if (empty) { empty.hidden = events.length !== 0; }
    /* the full agenda opens inside a bounded, keyboard-scrollable box — never a page-long list */
    list.classList.toggle('is-scroll', scheduleOpen);
    if (scheduleOpen) {
      list.setAttribute('tabindex', '0');
    } else {
      list.removeAttribute('tabindex');
    }
    if (more) {
      more.hidden = events.length <= SCHEDULE_CAP;
      more.setAttribute('aria-expanded', String(scheduleOpen));
      more.textContent = scheduleOpen ? '閉じる' : 'すべて見る（' + events.length + '件）';
    }
    var sub = $('sched-count');
    if (sub) { sub.textContent = events.length ? '全' + events.length + '件' : ''; }
  }

  /* ------------------------------------------------------------ sections / chips
     The predicates of the former highlight sections. The feed chips use them (so a chip, its
     count and 「この条件で全商品一覧を開く」 always describe the same set) and `?sec=` narrows the
     screener with them. */
  var SECTIONS = [
    { id: 'sec-closing', name: '締切間近', sort: cmpDeadline, pick: isClosingSoonRow },
    { id: 'sec-open', name: '受付中', sort: cmpDeadline, pick: isOpenStatus },
    /* 利ざや候補（参考, owner decision 2026-09-25): ordered by the value signal — level (evidence
       before 推論), then the similar products' median ratio, then the deadline. The only ratio ordering. */
    { id: 'sec-margin', name: '利ざや候補（参考）', sort: cmpMargin, pick: isMarginCandidate },
    { id: 'sec-nearterm', name: '期日が7日以内（締切間近以外）', sort: cmpDeadline, pick: isNearTermUnconfirmed },
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
      pick: function (p) { return p.is_new === true; } },   /* = stats new_items (the KPI); each row shows its own state */
    { id: 'sec-attention', name: '注目候補', sort: cmpDeadline,
      pick: function (p) { return p.is_attention === true && (!decisionOf(p) || decisionOf(p).actionable); } },
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

  /* chip -> the section it shows; `aux` is a weaker second list under the chip (締切間近 only). */
  var FEED_CHIPS = {
    all: { name: 'すべて', sec: null },
    open: { name: '受付中（締切間近を含む）', sec: 'sec-open' },
    closing: { name: '締切間近', sec: 'sec-closing', aux: 'sec-nearterm' },
    preorder: { name: '受付中の予約', sec: 'sec-preorder' },
    lottery: { name: '受付中の抽選', sec: 'sec-lottery' },
    restock: { name: '再販', sec: 'sec-restock' },
    attention: { name: '注目候補', sec: 'sec-attention' },
    margin: { name: '利ざや候補', sec: 'sec-margin' },
    new: { name: '新着', sec: 'sec-new' }
  };
  /* An empty chip is not hidden: it says why it is empty. */
  var FEED_EMPTY = {
    all: 'この条件に合う商品はありません。キーワードや分野を変えてみてください。',
    open: 'いまのところ、受付中と判定した商品はありません。',
    closing: 'いまのところ、締切まで7日以内で受付中と判定した商品はありません。',
    preorder: 'いまのところ、受付中と判定した予約・受注生産の商品はありません。販売方式が予約の商品は、全商品一覧の「販売方式」で探せます。',
    lottery: 'いまのところ、受付中と判定した抽選はありません。販売方式が抽選の商品は、全商品一覧の「販売方式」で探せます。',
    restock: 'いまのところ、再販・在庫復活と判定した商品はありません。',
    attention: 'いまのところ、両方の条件を満たす商品はありません。',
    margin: 'いまのところ、目安が出ている商品はありません。目安まであと少しの商品は上のとおりです。',
    new: 'いまのところ、掲載から14日以内の商品はありません。'
  };
  /* The former section ids are anchors now; each one selects its chip. */
  var ANCHOR_CHIP = {
    feed: 'all', 'sec-closing': 'closing', 'sec-nearterm': 'closing', 'sec-open': 'open', 'sec-buyable': 'open',
    'sec-lottery': 'lottery', 'sec-preorder': 'preorder', 'sec-restock': 'restock',
    'sec-attention': 'attention', 'sec-margin': 'margin', 'sec-backtest': 'margin', 'sec-new': 'new'
  };
  function chipFromHash() {
    var id = (window.location.hash || '').slice(1);
    var c = own(ANCHOR_CHIP, id);
    return c === undefined ? null : c;
  }

  function chipRows(key) {
    var chip = own(FEED_CHIPS, key) || FEED_CHIPS.all;
    var sec = chip.sec ? sectionById(chip.sec) : null;
    var rows = state.products.filter(inScope);
    if (sec) { rows = rows.filter(sec.pick).sort(sec.sort); }
    else {
      /* R22: すべて lists what is still worth a look (leads, items to follow) in the order to check them, minus the
         ones already at the top; finished and info-wait items are one step away in 全商品一覧 */
      var top = state.firstLookIds || [];
      rows = rows.filter(function (p) { return isListed(p) && top.indexOf(p.product_id) < 0; }).sort(cmpDecision);
    }
    return rows;
  }

  function renderFeed() {
    var list = $('feed-list');
    if (!list) { return; }
    var key = own(FEED_CHIPS, state.chip) !== undefined ? state.chip : 'all';
    var chip = FEED_CHIPS[key];
    var rows = chipRows(key);
    var shown = rows.slice(0, state.feedShown);
    state.markBoxes = {};
    list.textContent = '';
    var frag = document.createDocumentFragment();
    shown.forEach(function (p) { frag.appendChild(buildFeedRow(p)); });
    list.appendChild(frag);

    var count = $('feed-count');
    if (count) {
      count.textContent = '';
      keepText(count, chip.name + ' ' + rows.length + '件' + (rows.length > shown.length ? ' ・ ' + shown.length + '件を表示' : ''));
    }
    var empty = $('feed-empty');
    empty.textContent = FEED_EMPTY[key];
    empty.hidden = rows.length !== 0;

    /* the weaker 要確認 list under 締切間近 */
    var auxWrap = $('feed-aux');
    var auxList = $('feed-aux-list');
    auxList.textContent = '';
    var aux = chip.aux ? state.products.filter(inScope).filter(sectionById(chip.aux).pick).sort(cmpDeadline) : [];
    aux.forEach(function (p) { auxList.appendChild(buildFeedRow(p)); });
    auxWrap.hidden = aux.length === 0;

    var more = $('feed-more');
    var left = rows.length - shown.length;
    more.hidden = left <= 0;
    more.textContent = 'さらに' + Math.min(FEED_PAGE, left) + '件';
    var toList = $('feed-to-list');
    toList.hidden = !chip.sec || rows.length === 0;

    var notes = document.querySelectorAll('.feed-note');
    for (var i = 0; i < notes.length; i++) { notes[i].hidden = notes[i].dataset.note !== key; }
    var chips = document.querySelectorAll('#feed-chips .fchip');
    for (var j = 0; j < chips.length; j++) {
      chips[j].setAttribute('aria-pressed', String(chips[j].dataset.chip === key));
    }
    syncKpiPressed();
  }

  function setChip(key, scroll) {
    if (own(FEED_CHIPS, key) === undefined) { key = 'all'; }
    state.chip = key;
    state.feedShown = FEED_PAGE;
    writeUrl();
    renderFeed();
    if (scroll) { scrollToId('feed'); }
  }

  function scrollToId(id) {
    var target = $(id);
    if (target) { target.scrollIntoView({ block: 'start' }); }
  }

  /** 「数え方」 below the feed, the same text as on every detail page. */
  function mountHowCounted() {
    var foot = document.querySelector('#feed .feed-foot');
    if (!foot || $('how-counted')) { return; }
    var first = null;
    state.products.forEach(function (p) { if (!first && hasEvaluableBacktest(p)) { first = backtestOf(p); } });
    foot.parentNode.insertBefore(howCounted(first ? { fee_rate: first.fee_rate } : null, 'how-counted'), foot.nextSibling);
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

  /** The corpus size beside 全商品を詳しく探す — the same published total the strip shows. */
  function renderAllCount() {
    var node = $('all-count');
    if (!node) { return; }
    var total = pick(statNum('counts', 'total'), state.products.length);
    node.textContent = '全' + total + '件';
  }

  /* ------------------------------------------------------------ C SCREENER ROW */

  /**
   * One dense table row. Seven columns on a wide screen (商品名 / 状態・方式 / 締切 / 定価 / 発売日 /
   * 確認状況 / 角度・目安); an unknown value keeps an EMPTY cell there so the columns stay aligned,
   * and on a phone the empty cell is not shown at all. No picture, no marks: the feed and the detail
   * page carry those.
   */
  function buildCard(p) {
    var li = el('li', 'card card--row' + (isUnverifiedRow(p) ? ' is-unverified' : ''));
    li.dataset.id = p.product_id;
    var a = el('a', 'card-main');
    a.href = detailHref(p);

    var ident = el('div', 'c-ident');
    if (!isUnknown(p.product_name)) { ident.appendChild(wordWrapText(el('div', 'c-name'), String(p.product_name))); }
    var meta = identityMeta(p);
    if (meta.length) { ident.appendChild(el('div', 'c-cat', meta.join('・'))); }
    a.appendChild(ident);

    /* 現在状態 (+ flags) and 販売方式. An unconfirmed acceptance state has no badge at all. */
    var st = el('div', 'c-status');
    put(st, statusBadge(p));
    flagBadges(st, p);
    var mode = lbl(SALE_MODE_LABEL, p.sale_mode);
    if (mode) { st.appendChild(el('span', 'c-mode', mode)); }
    a.appendChild(st);

    /* 締切 — an unconfirmed acceptance state never gets the urgency colour. */
    var parts = deadlineParts(p, state.doc && state.doc.as_of);
    var dCell = cell('c-deadline', parts && parts.kind ? parts.kind : '締切', parts ? parts.date : null);
    if (parts) {
      var rel = deadlineRelText(p);
      if (rel || parts.kind) {
        /* the kind repeats the cell label, which the dense table hides; a phone shows the label instead */
        var sub = el('span', 'deadline-rel' + (isClosingSoonRow(p) ? '' : ' is-unconfirmed'));
        if (parts.kind) { sub.appendChild(el('span', 'deadline-kind', parts.kind + (rel ? '・' : ''))); }
        if (rel) { keepText(sub, rel); }
        dCell.appendChild(sub);
      }
      if (isClosingSoonRow(p)) { dCell.classList.add(p.closing_soon_band === 'WITHIN_24H' ? 'is-urgent' : 'is-soon'); }
    }
    a.appendChild(dCell);

    /* 定価 — the published list price. NOT an acquisition price. 取得原価 only when verified. */
    a.appendChild(cell('c-list-price', '定価', fmtListPrice(p)));
    put(a, cellIf('c-acq', '取得原価', fmtPrice(acquisitionCostOf(p))));
    a.appendChild(cell('c-release', '発売日', releaseText(p)));

    /* 確認状況 — an OUTLINE badge, never the filled state look */
    /* R21H: no verification badge in a list (the detail page shows it); the cell stays so the table keeps its grid */
    a.appendChild(el('div', 'c-ev'));

    /* 調べた角度 n/6 and the 買いの目安 glyph */
    var extra = el('div', 'c-extra');
    var b = buySignalOf(p);
    if (b) { extra.appendChild(buyMark(inferenceOf(p) || b, true)); }
    a.appendChild(extra);

    /* 注目理由: chips, full label + basis in the accessible name (hidden in the dense table) */
    var chips = signalChips(p, 2);
    if (chips) {
      var sigBox = el('div', 'c-signals');
      sigBox.appendChild(chips);
      a.appendChild(sigBox);
    }
    li.appendChild(a);
    return li;
  }

  /* -------------------------------------------------------------- list render */
  function renderList() {
    var rows = sortRows(applyFilters());
    var list = $('list');
    var head = $('list-head');
    var empty = $('list-empty');
    var pages = Math.max(1, Math.ceil(rows.length / LIST_PAGE));
    if (state.page > pages) { state.page = pages; }
    if (state.page < 1) { state.page = 1; }
    var start = (state.page - 1) * LIST_PAGE;
    var shown = rows.slice(start, start + LIST_PAGE);
    list.textContent = '';
    var rc = $('result-count');
    rc.textContent = '';
    keepText(rc, '該当 ' + rows.length + ' 件' +
      (rows.length > LIST_PAGE ? '（' + (start + 1) + '〜' + (start + shown.length) + '件目）' : ''));
    empty.hidden = rows.length !== 0;
    head.hidden = rows.length === 0;
    var frag = document.createDocumentFragment();
    shown.forEach(function (p) { frag.appendChild(buildCard(p)); });
    list.appendChild(frag);
    var pager = $('list-pager');
    pager.hidden = pages <= 1;
    $('pager-state').textContent = state.page + ' / ' + pages + 'ページ';
    $('pager-prev').disabled = state.page <= 1;
    $('pager-next').disabled = state.page >= pages;
    renderActiveSection();
    renderAdvancedState();
    syncKpiPressed();
    syncStatusQuick();
    renderBuyPanel();
    renderMyCheck();
  }

  /* 最近調べた商品: the items checked or observed most recently, newest first (updated_at, then
     first_seen_at), each with its 確認状況 badge. A compact list, so a fresh addition is reachable
     from the top of the page without paging the feed. */
  var RECENT_MAX = 8;
  function cmpRecent(a, b) {
    var ua = isUnknown(a.updated_at) ? '' : String(a.updated_at);
    var ub = isUnknown(b.updated_at) ? '' : String(b.updated_at);
    if (ua !== ub) { return ua < ub ? 1 : -1; }
    var fa = isUnknown(a.first_seen_at) ? '' : String(a.first_seen_at);
    var fb = isUnknown(b.first_seen_at) ? '' : String(b.first_seen_at);
    if (fa !== fb) { return fa < fb ? 1 : -1; }
    return a.product_id < b.product_id ? -1 : 1;
  }
  function renderRecent() {
    var list = $('recent-list');
    if (!list) { return; }
    list.textContent = '';
    var rows = state.products.filter(inScope).sort(cmpRecent).slice(0, RECENT_MAX);
    rows.forEach(function (p) {
      var li = el('li', 'recent-item' + (isUnverifiedRow(p) ? ' is-unverified' : ''));
      li.dataset.id = p.product_id;
      var upd = fmtShortDay(p.updated_at, state.doc && state.doc.as_of);
      if (upd) { li.appendChild(el('span', 'recent-day', upd)); }
      var badges = el('span', 'recent-badges');
      put(badges, statusBadge(p));
      li.appendChild(badges);
      var a = el('a', 'recent-link');
      a.href = detailHref(p);
      a.appendChild(wordWrapText(el('span', 'recent-name'), isUnknown(p.product_name) ? '商品の詳細' : String(p.product_name)));
      li.appendChild(a);
      list.appendChild(li);
    });
    $('recent').hidden = rows.length === 0;
  }

  /** Everything the category tab and the keyword narrow. */
  function renderScoped() {
    syncCatTabs();
    renderFeatured();
    renderRecent();
    renderMargin();
    renderFeed();
    renderSchedule();
  }

  /* ---------------------------------------------------------------- controls */
  function syncControlsFromFilters() {
    $('f-q').value = filters.q;
    $('f-q-top').value = filters.q;
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
    var before = filters.q + '\u0000' + filters.cat;
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
    $('f-q-top').value = filters.q;
    state.page = 1;
    writeUrl();
    if (before !== filters.q + '\u0000' + filters.cat) { state.feedShown = FEED_PAGE; renderScoped(); }
    renderList();
  }
  /** Reset every filter (sort is intentionally left alone). */
  function clearFilters() {
    filters.q = ''; filters.cat = ''; filters.mode = ''; filters.status = '';
    filters.ev = ''; filters.profit = ''; filters.signal = ''; filters.deadline = '';
    filters.release = ''; filters.mark = ''; filters.sec = ''; filters.buy = '';
    filters.onlyNew = false; filters.onlyRestock = false; filters.onlyAttention = false;
    state.page = 1;
  }
  /** A jump into 全商品一覧 from the rail: the category tab is kept, everything else is replaced. */
  function openListWith(apply) {
    var keepCat = filters.cat;
    var keepQ = filters.q;
    clearFilters();
    filters.cat = keepCat;
    filters.q = keepQ;
    apply();
    syncControlsFromFilters(); writeUrl(); renderList();
    scrollToId('sec-all');
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
    /* the masthead search is the same keyword filter */
    var top = $('f-q-top');
    top.addEventListener('input', function () {
      $('f-q').value = top.value;
      onControlChange();
    });
    top.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); scrollToId('feed'); }
    });
    $('btn-reset').addEventListener('click', function () {
      clearFilters();
      filters.sort = 'deadline';
      syncControlsFromFilters(); writeUrl(); renderScoped(); renderList();
    });
    $('pager-prev').addEventListener('click', function () { state.page -= 1; renderList(); scrollToId('sec-all'); });
    $('pager-next').addEventListener('click', function () { state.page += 1; renderList(); scrollToId('sec-all'); });
    var schedMore = $('sched-more');
    if (schedMore) {
      schedMore.addEventListener('click', function () {
        scheduleOpen = !scheduleOpen;
        renderSchedule();
      });
    }
    $('active-sec-clear').addEventListener('click', function () {
      filters.sec = '';
      state.page = 1;
      writeUrl(); renderList();
    });

    /* feed chips, 「さらに30件」 and the hand-over to 全商品一覧 */
    var chips = document.querySelectorAll('#feed-chips .fchip');
    for (var c = 0; c < chips.length; c++) {
      chips[c].addEventListener('click', function (e) { setChip(e.currentTarget.dataset.chip, false); });
    }
    $('feed-more').addEventListener('click', function () {
      state.feedShown += FEED_PAGE;
      renderFeed();
    });
    $('feed-to-list').addEventListener('click', function () {
      var chip = FEED_CHIPS[state.chip] || FEED_CHIPS.all;
      openListWith(function () {
        filters.sec = chip.sec || '';
        /* the value chip keeps its level order in the full list (買いの目安順) */
        if (state.chip === 'margin') { filters.sort = 'buy'; }
      });
    });

    /* status strip: each counter selects the chip with the identical predicate */
    var kpis = document.querySelectorAll('.kpi');
    for (var i = 0; i < kpis.length; i++) {
      kpis[i].addEventListener('click', function (e) {
        var chip = e.currentTarget.dataset.chip;
        if (chip) { setChip(chip, true); return; }
        openListWith(function () { filters.cat = ''; filters.q = ''; });
        renderScoped();
      });
    }


    /* 買いの目安 lines: one tap filters the full list to that level, sorted by the signal. */
    var buyJumps = document.querySelectorAll('[data-buy]');
    for (var k = 0; k < buyJumps.length; k++) {
      buyJumps[k].addEventListener('click', function (e) {
        var level = e.currentTarget.dataset.buy || '';
        var again = filters.buy === level;
        openListWith(function () { filters.buy = again ? '' : level; filters.sort = 'buy'; });
      });
    }

    var markJumps = document.querySelectorAll('[data-mark-filter]');
    for (var j = 0; j < markJumps.length; j++) {
      markJumps[j].addEventListener('click', function (e) {
        if (!marksAvailable) { return; }
        var mark = e.currentTarget.dataset.markFilter || '';
        var again = filters.mark === mark;
        openListWith(function () { filters.mark = again ? '' : mark; });
      });
    }

    /* in-page links to a former section id select its chip (a same-hash click fires no hashchange) */
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) { return; }
      var id = a.getAttribute('href').slice(1);
      var chip = own(ANCHOR_CHIP, id);
      if (chip !== undefined) { setChip(chip, false); }
      if (id === 'legend') { $('legend').open = true; }
    });
    window.addEventListener('hashchange', function () {
      var chip = chipFromHash();
      if (chip) { setChip(chip, false); }
      if (window.location.hash === '#legend') { $('legend').open = true; }
    });
    window.addEventListener('resize', function () { syncRail($('featured-list')); });
    /* a click outside an open 「印」 menu closes it */
    document.addEventListener('click', function (e) {
      var menus = document.querySelectorAll('.mark-menu[open]');
      for (var m = 0; m < menus.length; m++) {
        if (!menus[m].contains(e.target)) { menus[m].open = false; }
      }
    });
    var schedList = $('sched-to-list');
    if (schedList) {
      schedList.addEventListener('click', function () {
        openListWith(function () { filters.sort = 'deadline'; });
      });
    }
  }

  /* A row that scrolls sideways shows a 「›」 at its right edge while there is more to see. */
  function wireScrollCue(node) {
    if (!node) { return; }
    function update() {
      node.classList.toggle('can-scroll', node.scrollWidth - node.clientWidth - node.scrollLeft > 4);
    }
    node.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    node.__cue = update;
    update();
  }
  /* Rail modules are open on a wide screen; on a phone only the schedule starts open. */
  function openRailForWidth() {
    var wide = window.matchMedia && window.matchMedia('(min-width: 1100px)').matches;
    ['sec-schedule', 'buy-panel', 'my-check'].forEach(function (id) {
      var d = $(id);
      if (d) { d.open = wide || d.hasAttribute('data-open-phone'); }
    });
    if (window.location.hash === '#legend') { $('legend').open = true; }
  }

  /* -------------------------------------------------------------------- boot */
  loadProducts().then(function (doc) {
    state.doc = doc;
    state.products = doc.products;
    /* A flag that is true for (almost) everything carries no information. */
    state.showNewBadge = newBadgeShown(state.products);
    return Promise.all([loadOptionalJson(DATA_STATS), loadOptionalJson(DATA_METADATA)])
      .then(function (side) {
        state.stats = side[0];
        state.metadata = side[1];
        renderHeaderMeta(doc);
        renderKpis();
        renderTrackRecord();
        renderKpiNote();
        renderAllCount();
        buildSelects();
        readUrl();
        syncControlsFromFilters();
        /* an ignored value (?cat=BOGUS) does not stay in a link the reader might share */
        writeUrl();
        wireControls();
        buildCatTabs();
        buildStatusQuick();
        openRailForWidth();
        $('loading').hidden = true;
        $('app').hidden = false;
        renderScoped();
        mountHowCounted();
        renderList();
        ['topnav-list', 'kpi-row', 'feed-chips', 'featured-list'].forEach(function (id) { wireScrollCue($(id)); });
        if (!marksAvailable) {
          var note = $('my-check-note');
          if (note) { note.textContent = 'お使いのブラウザの設定により、印を保存できません。'; }
        }
        /* the browser tried to scroll to the hash before the lists existed: do it now */
        var hash = (window.location.hash || '').slice(1);
        if (hash && $(hash)) { $(hash).scrollIntoView({ block: 'start' }); }
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
      dd = elKeep('dd', null, normDateText(shown));
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
    /* R22: the price with its unit (「¥440／パック・1BOX（10パック）¥4,400」) when the harness has it */
    var dp = decisionOf(p) ? shownText(decisionOf(p).price_ja) : null;
    var listPrice = dp || fmtListPrice(p);
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

    /* the price-path chart is its own block (価格推移), right after this one */

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

  /** 「調べた角度 n/6」 and the six chips, each an in-page link to its angle's section. */
  function angleSummary(ra) {
    var box = el('section', 'angle-sum');
    box.setAttribute('aria-labelledby', 'angle-sum-title');
    var head = el('div', 'angle-sum-head');
    var title = el('h2', 'angle-sum-title', '調べた角度 ' + ra.checked + '/' + ra.total);
    title.id = 'angle-sum-title';
    head.appendChild(title);
    if (ra.officialChecked) { head.appendChild(el('span', 'angle-sum-sub', '公式ページでも確認')); }
    box.appendChild(head);
    var nav = el('nav', 'angle-bar angle-bar--links');
    nav.setAttribute('aria-label', '角度ごとの内容へ移動');
    ra.angles.forEach(function (a) {
      var link = el('a', 'angle-cell' + (a.known ? ' is-known' : ''), a.label);
      link.href = '#angle-' + a.key;
      link.setAttribute('aria-label', angleStateText(a));
      nav.appendChild(link);
    });
    box.appendChild(nav);
    box.appendChild(el('p', 'angle-legend', '塗りつぶしは確認できた角度、点線の枠はまだ確認できていない角度です。'));
    return box;
  }

  /** One section per angle (h2 = its label): a two-column list of what was confirmed, with the
      source host when a URL was published; an angle not confirmed yet says so in a dashed box. */
  function angleSections(p, ra) {
    var wrap = el('div', 'angle-secs');
    ra.angles.forEach(function (a) {
      var sec = el('section', 'angle-sec' + (a.known ? ' is-known' : ''));
      sec.id = 'angle-' + a.key;
      sec.appendChild(el('h2', 'angle-sec-title', a.label));
      if (a.rows.length) {
        var dl = el('dl', 'angle-dl');
        a.rows.forEach(function (r) {
          var rowEl = el('div', 'angle-row');
          rowEl.appendChild(el('dt', null, String(r.label_ja)));
          var dd = elKeep('dd', null, angleValueText(r.value_ja));
          if (isSafeHttpUrl(r.source_url) && hostOf(r.source_url)) {
            var src = el('a', 'angle-src', '出典: ' + hostOf(r.source_url).replace(/^www\./, ''));
            src.href = String(r.source_url);          /* https only, validated above */
            src.target = '_blank';
            src.rel = 'noopener noreferrer';
            dd.appendChild(src);
          }
          rowEl.appendChild(dd);
          dl.appendChild(rowEl);
        });
        sec.appendChild(dl);
      }
      if (!a.known) {
        var box = el('div', 'angle-unknown');
        box.appendChild(el('p', 'angle-unknown-head',
          a.rows.length ? 'この角度の判断材料は、まだ確認できていません。' : 'まだ確認できていません。'));
        if (a.key === 'value') {
          var need = buyNeedText(p);
          var bs = buySignalOf(p);
          var why = need ? 'あと必要なもの：' + need : (bs ? shownText(bs.reason_ja) : null);
          if (why) { box.appendChild(elKeep('p', 'angle-unknown-why', why)); }
        }
        sec.appendChild(box);
      }
      wrap.appendChild(sec);
    });
    return wrap;
  }

  /** 価格推移: the similar products' price path, as its own block. null without a usable trend. */
  function buildChartBlock(p) {
    var bt = backtestOf(p);
    var chart = bt ? buildTrendChart(bt) : null;
    if (!chart) { return null; }
    var g = el('section', 'dl-group dl-group--chart');
    g.appendChild(el('h2', null, '価格推移（似た過去の商品）'));
    g.appendChild(chart);
    return g;
  }

  /** 買いの目安（参考）: the answer first, then why, then what is missing, then the conditions. */
  function buildBuyBlock(p) {
    var bs = buySignalOf(p);
    if (!bs) { return null; }
    var g = el('section', 'dl-group dl-group--buy');
    g.appendChild(el('h2', null, '買いの目安（参考）'));
    var verdict = el('div', 'detail-buy buy-box--' + bs.level);
    var vHead = el('div', 'detail-buy-head');
    var headInf = inferenceOf(p);
    vHead.appendChild(buyPill(headInf || bs, true));
    verdict.appendChild(vHead);
    verdict.appendChild(el('p', 'detail-buy-why', headInf
      ? 'この商品自身の取引の根拠はまだ足りないため、似た種類の商品の過去の結果から推論した目安です。'
      : String(bs.reason_ja)));
    if (Array.isArray(bs.missing_ja) && bs.missing_ja.length) {
      verdict.appendChild(el('p', 'detail-buy-sub', 'この商品自身の根拠に足りないもの'));
      var ml = el('ul', 'detail-buy-list');
      bs.missing_ja.forEach(function (m) { ml.appendChild(el('li', null, String(m))); });
      verdict.appendChild(ml);
    }
    if (headInf) {
      var ib = el('div', 'detail-infer');
      ib.appendChild(el('p', 'detail-buy-sub', '推論の根拠'));
      ib.appendChild(el('p', 'detail-buy-why', String(headInf.basis_ja)));
      if (headInf.closure_ja) { ib.appendChild(el('p', 'detail-infer-line', '目安が変わる条件：' + headInf.closure_ja)); }
      ib.appendChild(el('p', 'detail-infer-line', 'これまでの成績：' + String(headInf.record_ja)));
      ib.appendChild(el('p', 'detail-infer-line', '確からしさ：' + String(headInf.confidence_ja) + '（件数が少なく、検証の途中です）'));
      verdict.appendChild(ib);
    } else if (bs.level === 'NOT_ENOUGH_EVIDENCE' && bs.inference_blocked_ja) {
      verdict.appendChild(el('p', 'detail-infer-line', '推論について：' + String(bs.inference_blocked_ja)));
    }
    var dm = marginOf(p);
    if (dm) { verdict.appendChild(marginTable(dm, '利ざやの計算（参考）')); }
    if (Array.isArray(bs.conditions_ja) && bs.conditions_ja.length) {
      verdict.appendChild(el('p', 'detail-buy-cond', '条件：' + bs.conditions_ja.join('／')));
    }
    g.appendChild(verdict);
    return g;
  }

  /** An outbound button: https only (isSafeHttpUrl), the destination host visible, new tab. */
  function extButton(url, label, primary) {
    if (!isSafeHttpUrl(url)) { return null; }
    var a = el('a', 'btn detail-cta' + (primary ? ' btn--primary' : ''));
    a.appendChild(el('span', 'cta-text', label));
    var host = hostOf(url);
    if (host) { a.appendChild(el('span', 'cta-host', host.replace(/^www\./, ''))); }
    a.href = String(url);                 /* data-driven anchor, validated above */
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('aria-label', label + '（外部サイト' + (host ? '・' + host : '') + '、新しいタブで開きます）');
    return a;
  }

  function render(doc, p) {
    var root = $('detail');
    var unverified = isUnverifiedRow(p);
    var card = el('div', 'detail-card' + (unverified ? ' is-unverified' : ''));

    /* --- TOP: 写真（なければ図） | 商品名・状態・締切・定価・発売日・販売方式・行き先・印.
           WHAT / WHEN / HOW MUCH / WHERE are all in this first block. The picture is the one the
           card showed, and its credit is visible text under it. --- */
    var hero = el('div', 'detail-hero');
    var fig = el('figure', 'detail-media');
    var im = productImageOf(p);
    var caption = el('figcaption', 'detail-credit');
    fig.appendChild(productMedia(p, 'hero', {
      eager: true,
      onFail: function () { caption.textContent = ''; caption.hidden = true; }
    }));
    var creditText = im ? imageCreditText(im) : null;
    if (creditText) {
      caption.textContent = creditText;
    } else {
      caption.hidden = true;
    }
    fig.appendChild(caption);
    hero.appendChild(fig);
    var heroBody = el('div', 'detail-hero-body');
    hero.appendChild(heroBody);

    var head = el('div', 'detail-head');
    head.appendChild(wordWrapText(el('h1', 'detail-title'),
      isUnknown(p.product_name) ? '商品の詳細' : String(p.product_name)));
    var detailMeta = identityMeta(p, false);
    if (detailMeta.length) { head.appendChild(el('p', 'detail-sub', detailMeta.join('・'))); }
    var badges = el('div', 'detail-badges');
    put(badges, statusBadge(p));
    put(badges, evidenceBadge(p));
    /* the same 新着 rule as the list: shown only while the flag is not on (almost) every product */
    if (p.is_new === true && newBadgeShown(doc.products)) { badges.appendChild(el('span', 'badge badge--flag', '新着')); }
    if (isRestockRow(p)) { badges.appendChild(el('span', 'badge badge--restock', '再販')); }
    if (p.is_attention === true) { badges.appendChild(el('span', 'badge badge--attention', '注目候補')); }
    if (badges.children.length) { head.appendChild(badges); }
    heroBody.appendChild(head);
    /* R22: the decision unit first — tier, confidence and its reasons, why now, price, similar products, risk,
       next check, evidence and its date — before the conditions table and the long sections */
    var dec0 = decisionOf(p);
    if (dec0) {
      var dbox = el('section', 'detail-decision tier-box--' + String(dec0.tier).toLowerCase());
      dbox.setAttribute('aria-label', '判断の要点');
      put(dbox, decisionChips(p));
      put(dbox, decisionFacts(p, true));
      heroBody.appendChild(dbox);
    }
    var profitSection = profitBlock(p, false);   /* R22: the profit layer; placed after the price, links and marks */
    /* R22: the unverified state is stated once, in the decision block (risk / next check), not in a warning box */


    /* Key–value block. 締切 splits date and 残り日数; the urgent look only for a closing_soon_band row
       (deadlineParts -> isClosingSoonRow). A value that is not confirmed is simply absent. */
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
    /* PRICE: 定価 と 取得原価 は別の量。確認できた方だけ。 */
    put(top, pricePair(p));
    [['発売日', releaseText(p)], ['販売方式', lbl(SALE_MODE_LABEL, p.sale_mode)]].forEach(function (kf) {
      var v = shownText(kf[1]);
      if (v === null) { return; }
      var it = el('div', 'keyfact');
      it.appendChild(el('span', 'price-lbl', kf[0]));
      it.appendChild(elKeep('span', 'keyfact-val', v));
      top.appendChild(it);
    });
    if (top.children.length) { heroBody.appendChild(top); }

    /* 買いの目安: one line here, the full reasoning in its own block below */
    var bsTop = buySignalOf(p);
    if (bsTop) {
      var bl = el('p', 'detail-buyline');
      bl.appendChild(el('span', 'detail-buyline-lbl', '買いの目安（参考）'));
      bl.appendChild(buyMark(inferenceOf(p) || bsTop));
      var jump = el('a', 'detail-buyline-go', '根拠を見る');
      jump.href = '#detail-buy';
      bl.appendChild(jump);
      heroBody.appendChild(bl);
    }

    var prices = el('div', 'detail-prices');
    var ctas = el('div', 'detail-ctas');
    put(ctas, extButton(p.official_url, (lbl(URL_KIND_LABEL, p.official_url_kind) === '販売ページ' ? '販売ページを見る' : '公式を見る'), true));
    if (p.purchase_url !== p.official_url) { put(ctas, extButton(p.purchase_url, '販売ページを見る', false)); }
    if (ctas.children.length) { prices.appendChild(ctas); }
    var priceNote = priceNoteText(p);
    if (priceNote !== null) { prices.appendChild(el('p', 'price-note', priceNote)); }
    if (prices.children.length) { heroBody.appendChild(prices); }

    /* あなたの印 (browser only) — the reader's own mark, not the 買いの目安 */
    var markWrap = el('div', 'detail-markbox');
    markWrap.appendChild(el('span', 'detail-mark-lbl', 'あなたの印'));
    var current = getMark(marks, p.product_id);
    var noteEl = el('p', 'note-line', '印はお使いのブラウザにだけ保存され、外部には送信されません。');
    var box = markControl(p.product_id, current, function (markId, boxEl) {
      if (markId === 'UNDECIDED') { delete marks[p.product_id]; }
      else { marks[p.product_id] = markId; }
      writeMarks(marks);
      syncMarkButtons(boxEl, markId);
      if (!marksAvailable) { noteEl.textContent = 'お使いのブラウザの設定により、印を保存できません。'; }
    }, 'detail-marks');
    markWrap.appendChild(box);
    markWrap.appendChild(noteEl);
    heroBody.appendChild(markWrap);
    put(heroBody, profitSection);
    card.appendChild(hero);

    /* --- BELOW: 販売・応募条件 → 6つの角度 → Evidence → 類似品相場 → 価格推移 → Source → 補足 --- */
    var wrap2 = el('div', 'detail-wrap');

    var g2 = group('販売・応募条件', true);
    row(g2.dl, '現在の状況', hasShownStatus(p) ? p.status_label_ja : null);
    /* v1.1.0 supplies the Japanese label; a raw token is never printed. */
    row(g2.dl, '状況の根拠', p.status_basis_label_ja);
    row(g2.dl, '補足', p.status_note_ja);
    var dKind = lbl(DEADLINE_KIND_LABEL, p.deadline_kind);
    var dRel = deadlineRelText(p);
    var dVal = isUnknown(p.deadline) ? null :
      fmtDate(p.deadline) + (dKind ? '（' + dKind + '）' : '') + (dRel ? ' / ' + dRel : '');
    row(g2.dl, '直近の期日', dVal);
    row(g2.dl, '予約開始', fmtDate(p.reservation_start));
    row(g2.dl, '予約終了', fmtDate(p.reservation_end));
    row(g2.dl, '抽選開始', fmtDate(p.lottery_start));
    row(g2.dl, '抽選終了', fmtDate(p.lottery_end));
    row(g2.dl, '応募開始', fmtDate(p.application_start));
    row(g2.dl, '応募終了', fmtDate(p.application_end));
    /* Same word as the card's 応募条件 row: two names for one date reads as two dates. */
    row(g2.dl, '当選発表', fmtDate(p.result_date));
    row(g2.dl, '支払期限', fmtDate(p.payment_deadline));
    row(g2.dl, '受取期間', p.pickup_period);
    row(g2.dl, '発送予定', p.shipping_period);
    row(g2.dl, '販売方式', lbl(SALE_MODE_LABEL, p.sale_mode));
    /* sale_mode_raw is a source code (retail, lottery …): shown only through a Japanese label,
       and the row is left out when there is no wording for it. */
    var rawMode = own(SALE_MODE_RAW_LABEL, p.sale_mode_raw);
    if (rawMode !== undefined) { row(g2.dl, '販売方法の詳細', rawMode); }
    row(g2.dl, '購入先', (Array.isArray(p.channel) && p.channel.length) ? p.channel.join('・') : null);
    row(g2.dl, '購入制限', p.purchase_limit);
    row(g2.dl, '再販状況', p.restock_status);
    row(g2.dl, '販売終了', fmtDate(p.sales_end));
    row(g2.dl, '作品名', p.ip);
    row(g2.dl, 'カテゴリ', lbl(CATEGORY_LABEL, p.category));
    var urlLabel = lbl(URL_KIND_LABEL, p.official_url_kind) || '公式ページ';
    row(g2.dl, urlLabel, null, linkNode(p.official_url, urlLabel + 'を開く'));
    row(g2.dl, '購入ページ', null, linkNode(p.purchase_url, '購入ページを開く'));
    put(wrap2, groupIfAny(g2));

    /* 6つの角度: 「調べた角度 n/6」, the six chips, then one section per angle */
    var angles = researchAnglesOf(p);
    if (angles) {
      var ab = el('div', 'angle-block');
      ab.appendChild(angleSummary(angles));
      ab.appendChild(angleSections(p, angles));
      wrap2.appendChild(ab);
    }

    /* Evidence: 買いの目安 → 注目理由 → 利益を考えるための材料 */
    put(wrap2, buildBuyBlock(p));
    put(wrap2, buildSignalsBlock(p));
    var btBlock = buildBacktestBlock(p);
    put(wrap2, buildProfitBlock(p, btBlock));
    /* 類似品相場 → 価格推移 */
    put(wrap2, btBlock);
    put(wrap2, buildChartBlock(p));

    /* Source: 確認状況と出典, then the similar products' verified routes */
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
    put(wrap2, groupIfAny(g5));
    put(wrap2, buildRouteBlock(p));

    /* 補足 */
    var g6 = group('補足情報', true);
    row(g6.dl, '備考', p.notes_ja);
    put(wrap2, groupIfAny(g6));

    /* Contents. Generated from the blocks that were actually appended above — never a fixed
       list, so a page with no route evidence does not claim to have a route section. */
    var toc = el('nav', 'detail-toc');
    toc.setAttribute('aria-label', 'このページの内容');
    var tocList = el('ul', 'detail-toc-list');
    var groups = wrap2.querySelectorAll('.dl-group');
    for (var gi = 0; gi < groups.length; gi++) {
      var heading = groups[gi].querySelector('h2');
      if (!heading || !heading.textContent) { continue; }
      var anchorId = groups[gi].classList.contains('dl-group--buy') ? 'detail-buy' : 'sec-detail-' + gi;
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
  var siteLink = document.querySelector('.site-title a');
  if (siteLink && !siteLink.querySelector('.brand-logo')) { siteLink.insertBefore(brandLogo(), siteLink.firstChild); }
  if (page === 'index') { initIndex(); }
  else if (page === 'product') { initProduct(); }
})();
