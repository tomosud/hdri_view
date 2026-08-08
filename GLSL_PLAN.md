# GLSL エディタ機能

画像ウィンドウごとに GLSL フラグメントシェーダを書き、linear float RGBA のまま画像を加工・生成する。
ビルド工程や外部エディタライブラリは追加せず、GitHub Pages で動く静的構成を維持する。

## 1. 現在の UI

### 読み込んだ画像

画像ウィンドウのタイトルバーに `Original / GLSL` タブを表示する。

- `Original`: 読み込んだ元画像を表示する。
- `GLSL`: 初回選択時に Passthrough シェーダを作り、同じウィンドウ内で結果へ切り替える。
- 元画像と GLSL 結果は別ウィンドウにしない。GLSL 実行によって元画像を書き換えない。
- GLSL 結果の解像度が元画像と異なる場合、タイトルバーのサイズ表示も現在のタブに合わせる。

### New Image

トップバーの `New Image` は入力画像なしの GLSL 画像を作る。

- 既定サイズは 1024 x 1024。
- `Original` を持たず、ウィンドウには `GLSL` だけを表示する。
- 入力テクスチャは 1 x 1 の黒、`inputColor` は `vec4(0, 0, 0, 1)`。

### エディタの表示

選択中のウィンドウが `GLSL` 表示のときだけ GLSL エディタを表示する。

- 別のウィンドウ、`Original`、または画像の無い背景を選ぶとエディタ全体を隠し、予約中の実行を取り消す。
- 選択中の画像を閉じた場合は画像選択を解除し、エディタを隠す。残った画像は自動選択しない。
- GLSL 表示のウィンドウを再選択すると、そのウィンドウのコードと解像度でエディタを再表示する。
- エディタの `x` で一時的に閉じられる。GLSL ウィンドウを再選択すれば再表示する。
- View Settings などと同じフローティングパネルで、ドラッグ移動とダブルクリックによる折り畳みに対応する。
- 下端のグリップで高さを変更でき、コード編集領域を表示範囲内で拡大できる。高さはセッションへ保存する。

## 2. データ構造と既存機能との接続

1つの画像レコードに `original` と `glsl` の表示データを保持する。タブ切替時に、既存機能が参照する
`pixels / width / height / range / type / sourceFormat` を現在の表示へ差し替える。

```text
画像レコード
├ original: 元の Float32Array とメタデータ（New Image では無し）
├ glsl:     出力 Float32Array、コード、解像度、値域
└ mode:     original | glsl
```

元画像の Float32Array は参照を保持し、タブ用に複製しない。現在タブの `image.pixels` を Picker、Selection、
Selection Graph、保存処理がそのまま読むため、各機能に GLSL 専用分岐を増やさない。

タブ間で View Settings、Picker、Selection は同じウィンドウ状態を共有する。解像度が小さい表示へ
切り替えたとき、範囲外になった Picker は除外し、Selection は表示範囲内へ収める。

## 3. シェーダの契約

ユーザーが書くのは `mainImage()` の本体だけ。アプリが WebGL2 用のラッパ、uniform、補助関数を付ける。

```glsl
void mainImage(out vec4 outputColor, in vec2 uv, in vec4 inputColor) {
    // ユーザーが書く部分
    outputColor = inputColor;
}
```

| 名前 | 内容 |
| --- | --- |
| `outputColor` | 出力先の `out vec4` |
| `uv` | 0..1 の座標。`(0, 0)` は左上 |
| `inputColor` | 元画像の同じ座標の色（linear） |
| `resolution` | GLSL 出力解像度 |
| `inputResolution` | 元画像解像度。New Image では 1 x 1 |
| `inputTexture` | 元画像を任意座標で読む `sampler2D` |
| `time` | 予約済み uniform。現在は常に 0 |

常時使える補助関数は `luminance()`、`srgbToLinear()`、`linearToSrgb()`、`texelSize()`、
`sampleInput()`。入出力は linear float で、0..1 にクランプしない。

### 宣言ルール

書き方は通常の GLSL に一本化する。

- `outputColor` は関数引数なので、再宣言せず代入する。
- `uv` と `inputColor` も関数引数としてそのまま使う。
- ユーザーが追加するローカル変数は、通常どおり自分で宣言する。
- アプリは再宣言の検出、削除、自動書き換えを行わない。誤った宣言は通常のコンパイルエラーとして表示する。

```glsl
vec2 texel = 1.0 / resolution;
vec4 left = texture(inputTexture, uv - vec2(texel.x, 0.0));
vec4 right = texture(inputTexture, uv + vec2(texel.x, 0.0));
outputColor = (left + inputColor + right) / 3.0;
```

## 4. 実行と失敗時の扱い

- 入力停止から 300 ms 後に自動実行する。Run / Apply ボタンは置かない。
- コンパイル失敗または実行失敗時は、直前に成功した GLSL 出力を残す。
- 編集中コードと最後に成功したコードを別々に保持する。エラーのある編集内容もタブ移動やセッション保存で失わない。
- コンパイルログの行番号はラッパ分を補正し、ユーザーコードの行番号で表示する。
- タブ切替・ウィンドウ切替・削除時は予約中の自動実行を取り消す。
- GLSL 結果の反映時は Selection の進行中ジョブとキャッシュを破棄し、古い画素の集計結果を混ぜない。

## 5. 負荷とクラッシュを避けるルール

- WebGL2 と `EXT_color_buffer_float` を必須とする。使えない場合は理由を表示して実行しない。
- GPU の `MAX_TEXTURE_SIZE` に加え、GLSL の入力と出力を最大 8,388,608 ピクセルに制限する
  （例: 4096 x 2048、3840 x 2160）。巨大な RGBA32F、readPixels、表示用 ImageData の同時確保を
  避けるための仕様上限で、通常の画像閲覧には適用しない。
- 同じ元画像の編集中は GPU 入力テクスチャを再利用し、打鍵ごとの再アップロードを避ける。
- GLSL 出力の巨大な Float32Array は IndexedDB へ毎回保存しない。コードと解像度を保存し、復元時に再実行する。
- コンテキストロストを監視し、次の実行時に WebGL2 コンテキストを作り直す。
- 無限ループなど任意シェーダの完全な安全判定は行わない。静的解析の例外処理を増やさず、通常の GLSL と
  ブラウザの WebGL コンテキスト保護に従う。

## 6. プリセット

- Passthrough
- Exposure +1 EV
- Grayscale
- Blur 3 tap (horizontal)
- Box blur (loop, adjustable): `radius` を変更してぼかし範囲を調整。負荷が二乗で増えるため 1〜4 を推奨
- Edge detection (Sobel)
- Channel swap (BGRA)
- Gradient (generate)
- Radial HDR light (generate)
- Cosine stripes (generate): `stripeCount` と `angle` をコード内で調整

New Image の初期値は `Gradient (generate)`。

## 7. 実装ファイルと確認状況

| ファイル | 内容 |
| --- | --- |
| `glsl-runtime.js` | WebGL2 初期化、ラッパ、コンパイル、RGBA32F 描画、readPixels、上限検査、GPU キャッシュ |
| `app.js` | タブ状態、エディタ、自動実行、既存機能との接続、セッション保存復元 |
| `index.html` | New Image と GLSL エディタのマークアップ |
| `style.css` | Original / GLSL タブとエディタパネル |

Node の構文検査と、ラッパ・プリセット・エラー行補正の非 WebGL テストを行う。
WebGL 描画を含むブラウザ実機確認は `run.bat` で行う。

## 8. 将来候補（現在は対象外）

- GLSL 結果を別シェーダの入力にするチェーン
- 複数入力テクスチャ
- UI から操作する追加 uniform とアニメーション
- マルチパス
- シェーダファイルのインポート／エクスポート
- シンタックスハイライトや補完を持つ外部エディタ
