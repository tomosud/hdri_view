# HDRI Value Viewer



https://github.com/user-attachments/assets/53fd2ff5-9d39-4b50-b34e-35220dcfc0dd



ブラウザだけで動く HDR / EXR 画像ビューア。ピクセルの実数値（linear / sRGB）をその場で確認しながら、露出やチャンネルを切り替えて画像を検証できます。サーバー処理なしの静的ページなので、GitHub Pages でそのまま公開しています。

https://tomosud.github.io/hdri_view/




![アプリ全体のスクリーンショット](doc_asset/ui_all.png)

## できること

- PNG / JPEG / WebP / AVIF / GIF / BMP に加え、**HDR (Radiance)** / **EXR (OpenEXR)** をブラウザ上でそのまま開ける
- カーソル位置の **linear値 / sRGB値** をステータスバーにリアルタイム表示
- 複数の画像をウィンドウとして並べて比較
- 任意の点をピックしてリストに記録、CSV としてコピー
- 矩形選択した範囲の最小・最大・平均値と、値の分布を **3Dグラフ** で可視化
- 開いた画像を PNG / JPEG / WebP、HDR 画像は HDR RGBE / EXR Float として保存

## 使い方

### 1. 画像を開く

![ヘッダー](doc_asset/crop/header.png)

左上の **Open** ボタンからファイルを選択するか、画面上に画像をドラッグ＆ドロップします。複数選択すると、それぞれがウィンドウとして開きます。

### 2. 表示設定を調整する

![ビュー設定パネル](doc_asset/crop/view_settings.png)

画像ウィンドウを選択すると、右側の **VIEW SETTINGS** パネルで以下を調整できます。

- **Zoom**: Fit / 100%〜3200% の固定倍率
- **Filtering**: Auto / Nearest / Linear（拡大時の補間）
- **Auto level**: HDR画像の輝度を自動でレベル補正
- **Brightness**: 露出値を数値入力、または ±1 EV ボタンで調整
- **Channel**: RGBA / RGB / R / G / B / A の表示切り替え
- **Save**: 表示中の画像を各フォーマットで保存（HDR/EXRはHDRI画像のみ）

パネル下部には開いている画像の **Name / Size / Type / Range**（値域）も表示されます。

### 3. ピクセル値を調べる（Picker）

![ピッカーで打った点](doc_asset/picker.png)

**Pickers** タブで Picker ボタンを有効にし、画像上をクリックすると座標に番号付きのマーカーが打たれます。

![ピッカーの値リスト](doc_asset/picker_ui.png)

打った点は一覧に linear 値（R, G, B, A）とともに記録され、**Copy** で CSV としてコピーできます（Full CSV / Values only を選択可）。ステータスバーには常にカーソル位置の linear / sRGB 値が表示されます。

### 4. 範囲選択して分布を見る（Selection）

![矩形選択](doc_asset/crop/viewport.png)

画像上をドラッグすると矩形範囲を選択できます。**Selection Graph** パネルに、選択範囲の値（輝度）を高さで表した3Dグラフが自動的に描画されます。

![Selectionグラフ](doc_asset/crop/selection_graph.png)

グラフはダウンサンプルされたグリッド単位で表示され、カラースケールと Min / Avg / Max が確認できます。

![Selectionタブの詳細](doc_asset/crop/selection_panel.png)

**Selection** タブでは選択範囲の Rect / Count / Min / Max / Average（RGB・Luminance）が数値で確認でき、生の値マトリクスを **Copy Matrix** または **CSV** で書き出せます。

## 対応フォーマット

| 用途 | 形式 |
| --- | --- |
| 読み込み | PNG, JPEG, WebP, AVIF, GIF, BMP, HDR (Radiance), EXR (OpenEXR) |
| 保存 | PNG, JPEG, WebP, HDR RGBE（HDRI画像）, EXR Float（HDRI画像） |

## 技術構成

- ビルド不要の静的サイト（GitHub Pages でホスト可能）
- [three.js](https://threejs.org/) の `EXRLoader` / `RGBELoader` を利用して HDR/EXR を読み込み
- 選択範囲の集計処理は Web Worker（`selection-worker.js`）にオフロード

## ローカルで動かす

```bat
run.bat
```

ローカルサーバー（`python -m http.server`、既定ポート 8000）を起動してブラウザを開きます。
