# Sedori Research Dashboard

公開用の静的ダッシュボードです。商品データは調査基盤側で生成された
サニタイズ済み JSON（`data/products.json`）のみを読み込みます。

- このリポジトリには調査基盤本体のデータ・ロジック・内部メモは含まれません。
- 表示される「未検証」項目は一次情報の確認が済んでいない発見候補です。
- 不明な項目は 0 や空欄ではなく「不明」と表示されます。
- 仕入れの最終判断は人間が行います。自動的な推奨は表示しません。
- 購入候補 / 監視 / 見送りの印はお使いのブラウザ内（localStorage）にのみ保存されます。

ページは静的ファイルのみで動作します（ビルド不要）。

## 監査用メタデータについて

`data/metadata.json` の `audit_metadata` には、生成物の識別子（builder / contract /
status engine / schema version）と件数の突合情報（source_tables・excluded_rows・
suppressed_fields・reconciliation）が入っています。

これは**外部の独立監査が、こちらの説明を信じずに公開値を再計算できるように、
公開契約へ明示的に含めているもの**です。内部情報が漏れたものではありません
（`deliberately_public: true` と `public_identifiers` で明示しています）。

一方、ローカルの絶対パス・内部モジュールパス・生の入力テーブルのパス・資格情報・
エージェントのログ・内部の判定値や閾値は公開していません。
