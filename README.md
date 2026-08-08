# HDRI Value Viewer



https://github.com/user-attachments/assets/53fd2ff5-9d39-4b50-b34e-35220dcfc0dd



ブラウザだけで動く HDR / EXR 等の画像の値を計測するためのビューア。

https://tomosud.github.io/hdri_view/




![アプリ全体のスクリーンショット](doc_asset/ui_all.png)

## できること

- PNG / JPEG / WebP / AVIF / GIF / BMP に加え、**HDR (Radiance)** / **EXR (OpenEXR)** をブラウザ上でそのまま開ける
- カーソル位置の **linear値 / sRGB値** をステータスバーにリアルタイム表示
- 複数の画像をウィンドウとして並べて比較
- 任意の点をピックしてリストに記録、CSV としてコピー
- 矩形選択した範囲の最小・最大・平均値と、値の分布を **3Dグラフ** で可視化
- 開いた画像を PNG / JPEG / WebP、HDR 画像は HDR RGBE / EXR Float として保存
- **GLSL** を書いて画像を加工、またはコードだけから任意サイズの画像を生成

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
- **Channel**: RGBA / RGB / R / G / B / A の表示切り替え。**RGBA を選んでいる間は、Picker /
  Selection / ステータスバーが返す RGB 値に alpha を乗算します**（黒背景と合成された、
  実際に画面で見えている値に合わせるため）。alpha を掛けない素の値が欲しいときは **RGB** を選びます
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

### 5. GLSL で加工・生成する

画像ウィンドウのタイトルバーには **Original / GLSL** タブがあります。**GLSL** を初めて選ぶと
Passthrough シェーダが作られ、同じウィンドウ内で結果へ切り替わります。**Original** に戻せば、
いつでも未加工の元画像を確認できます。GLSL は元画像を書き換えません。

GLSL 表示のウィンドウを選択している間だけエディタが現れます。Original または別ウィンドウを選ぶと
エディタ全体が隠れ、GLSL 表示へ戻るとその画像のコードで再表示されます。エディタ右上の **x** で
一時的に閉じることもできます。

トップバーの **New Image** は入力なしで、コードだけから任意サイズの画像を作ります。この場合は
元画像が無いため、画像ウィンドウは **GLSL** のみです。

コードを打ち終わって 300ms 後に自動で再実行され、同じウィンドウの GLSL 表示が更新されます
（実行ボタンはありません）。エラー時は直前に成功した画像を残し、エラーのある編集中コードも
保持します。

書くのは以下の関数の中身だけで、`outputColor` に代入します。

```glsl
void mainImage(out vec4 outputColor, in vec2 uv, in vec4 inputColor) {
    // ここを書く
    outputColor = inputColor;
}
```

| 名前 | 内容 |
| --- | --- |
| `outputColor` | 出力先。代入する（再宣言しない） |
| `uv` | 0..1 の座標。(0,0) が左上 |
| `inputColor` | 入力画像の色（linear） |
| `resolution` / `inputResolution` | 出力 / 入力の解像度（px） |
| `inputTexture` | 任意座標をサンプリングする `sampler2D` |

`luminance()` / `srgbToLinear()` / `linearToSrgb()` / `texelSize()` / `sampleInput()` が使えます。
値は linear float のままクランプされないので、`inputColor.rgb *= 2.0;` の結果を HDR / EXR として
そのまま保存できます。出力は普通の画像ウィンドウなので Picker も Selection Graph も効きます。

コンパイルエラーは、自分が書いた行番号でパネル下部に表示されます。

WebGL2 と `EXT_color_buffer_float` が必要です。使えない環境では理由がステータスに表示されます。
GPU メモリと readPixels によるフリーズを避けるため、GLSL の入力と出力は最大 8,388,608 ピクセル
（例: 4096 x 2048、3840 x 2160）です。通常の画像閲覧にはこの制限はありません。GLSL 出力画素は
セッションへ複製保存せず、コードと解像度から復元します。

## 対応フォーマット

| 用途 | 形式 |
| --- | --- |
| 読み込み | PNG, JPEG, WebP, AVIF, GIF, BMP, HDR (Radiance), EXR (OpenEXR) |
| 保存 | PNG, JPEG, WebP, HDR RGBE（HDRI画像）, EXR Float（HDRI画像） |

## 技術構成

- ビルド不要の静的サイト（GitHub Pages でホスト可能）
- [three.js](https://threejs.org/) の `EXRLoader` / `RGBELoader` を利用して HDR/EXR を読み込み
- PNG は `png-decoder.js` で自前デコード（後述）
- GLSL 加工・生成は `glsl-runtime.js`（WebGL2 を直接使用、RGBA32F の FBO に描いて `readPixels`）
- 選択範囲の集計処理は Web Worker（`selection-worker.js`）にオフロード

### 値の正確性について

計測用途のため、PNG は Canvas を経由せず `png-decoder.js` で直接デコードしています
（IDAT の展開はブラウザ内蔵の `DecompressionStream` を使用、外部ライブラリなし）。

Canvas 2D 経由（`drawImage` → `getImageData`）だと以下の非可逆変換が入るためです。

- **premultiplied alpha の往復**: alpha < 255 の画素で RGB が量子化される。誤差は alpha に反比例し、
  alpha=1 では 129 → 255、**alpha=0 では RGB が完全に失われる**（マスクを alpha に入れた
  テクスチャなどで実害が出る）
- **8bit 固定**: 16bit PNG の下位ビットが落ちる

自前デコードでは、ビット深度 1/2/4/8/16、カラータイプ gray / rgb / palette / gray+alpha / rgba、
`tRNS`、Adam7 インタレースに対応し、ファイルに書かれた値をそのまま取り出します。

PNG 以外（JPEG / WebP / AVIF / GIF / BMP）は従来どおり Canvas 経由です。alpha を持たない画像は
この経路でも値は一致します。半透明を含む画像を Canvas 経由で読み込んだ場合は、View Settings の
**Type** 欄に `(canvas: RGB approximate where alpha < 1)` と表示されます。

## ローカルで動かす

```bat
run.bat
```

ローカルサーバー（`python -m http.server`、既定ポート 8000）を起動してブラウザを開きます。
