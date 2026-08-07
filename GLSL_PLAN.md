# GLSL エディタ機能 計画

画像ウィンドウごとに GLSL フラグメントシェーダを書いて画像加工できるようにする。
あわせて「入力画像なし・任意サイズ」でコードだけから画像を生成できるようにする。

結論から言うと **両方とも実現可能**。既存構成（ビルド不要の静的サイト）を崩さずに実装できる。

---

## 1. 実現可能性の根拠（既存構成との相性）

現状のデータフローは以下になっている。

```
ファイル ──> loadImageFile()
              ├ raster: ImageData → srgbToLinear → Float32Array RGBA
              └ hdr/exr: three.js Loader → Float32Array RGBA
          ──> createImageRecord()  { pixels: Float32Array, width, height, range, ... }
          ──> ensureDisplayCanvas()  Float32Array → Canvas2D（CPU でトーンマップ表示）
          ──> Picker / Selection / Graph / Save(HDR/EXR)  ← すべて image.pixels を直接読む
```

ポイントは **すべての計測・保存機能が `image.pixels`（linear float RGBA）しか見ていない** こと。

したがって GLSL 処理は

```
image.pixels ──> WebGL2 テクスチャ(RGBA32F) ──> ユーザーシェーダで描画 ──> readPixels
             ──> 新しい Float32Array ──> 新しい image レコード（＝普通の画像ウィンドウ）
```

という「Float32Array を入れて Float32Array を返す純関数」として差し込める。
出力は普通の画像ウィンドウなので、**Picker も Selection Graph も EXR 保存も自動的に効く**。
表示パイプライン（Canvas 2D）には一切手を入れない。

- WebGL2 は `document.createElement("canvas").getContext("webgl2")` でオフスクリーンに使う。three.js は不要。
- HDR の値域を保つため `EXT_color_buffer_float` を有効化して RGBA32F の FBO に描画する。
- 外部ライブラリを増やさない（エディタも素の `<textarea>`）。ライセンス条件・静的ホスティング条件を満たす。

---

## 2. UI 設計

### 2.1 起動口

| 場所 | ボタン | 動作 |
| --- | --- | --- |
| 画像ウィンドウのタイトルバー | `GLSL` | その画像を入力とした GLSL エディタを開く |
| トップバー（Open の隣） | `New Image` | 入力なし・任意サイズの生成モードでエディタを開く |

### 2.2 GLSL エディタウィンドウ

既存の `makeFloatingPanelDraggable()` を再利用したフローティングパネル。

```
┌ GLSL — derelict_airfield_02_2k.hdr ────────────────── [x] ┐
│ Input : derelict_airfield_02_2k.hdr (2048×1024)          │  ← 生成モードでは "none"
│ Output: [ 2048 ] × [ 1024 ]  [Match input]               │
│ Preset: [ Passthrough ▼ ]                                │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 1  vec2 texelSize = 1.0 / resolution;                │ │
│ │ 2  vec4 center = texture(inputTexture, uv);          │ │  ← textarea（等幅・Tab入力可）
│ │ 3  ...                                               │ │
│ └──────────────────────────────────────────────────────┘ │
│ ● Compiled  /  ✕ ERROR: 0:12: 'foo' : undeclared         │  ← エラー行を表示
│ [Auto preview ☑]  [Run]  [Replace image]  [New window]   │
└───────────────────────────────────────────────────────────┘
```

- **Auto preview**: 入力停止 300ms 後に自動コンパイル＆実行。巨大画像は縮小解像度でプレビューし、確定時のみフル解像度。
- **Run / New window**: 結果を新しい画像ウィンドウとして開く（元画像は残す）。
- **Replace image**: 元ウィンドウの `pixels` を差し替える。元データは `image.originalPixels` に退避して `Revert` 可能にする（非破壊）。
- エラー時は前回成功した結果を保持し、画像を壊さない。

---

## 3. シェーダの契約（ユーザーが書ける変数）

### 3.1 生成されるラッパ

ユーザーが書くのは `main()` の中身だけ。アプリ側が以下で囲む。

```glsl
#version 300 es
precision highp float;

uniform sampler2D inputTexture;   // 入力画像（生成モードでは 1x1 の黒）
uniform vec2  resolution;         // 出力解像度 (px)
uniform vec2  inputResolution;    // 入力解像度 (px)
uniform float time;               // 秒（プレビュー用・既定 0）

in  vec2 vUv;
out vec4 fragColor;

// ---- 補助関数（常に利用可能）----
float luminance(vec3 c)      { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3  srgbToLinear(vec3 c)   { ... }
vec3  linearToSrgb(vec3 c)   { ... }
vec4  sampleClamped(vec2 p)  { return texture(inputTexture, clamp(p, vec2(0.0), vec2(1.0))); }

void main() {
  vec2 uv = vUv;                          // ← 自動宣言（ユーザーが再宣言したら省略）
  vec4 inputColor = texture(inputTexture, uv);   // ← 同上
  vec4 outputColor = inputColor;                 // ← 同上

/* ===== USER CODE ===== */
  ...ユーザーのコード...
/* ===================== */

  fragColor = outputColor;
}
```

| 名前 | 型 | 内容 |
| --- | --- | --- |
| `uv` | `vec2` | 0..1 の正規化座標。**(0,0) が左上**（Picker の px 座標と同じ向き） |
| `resolution` | `vec2` | 出力解像度（px） |
| `inputResolution` | `vec2` | 入力解像度（px） |
| `inputColor` | `vec4` | `texture(inputTexture, uv)` の結果（linear） |
| `outputColor` | `vec4` | 書き込み先。最終的に `fragColor` になる |
| `inputTexture` | `sampler2D` | 任意座標サンプリング用 |
| `time` | `float` | プレビュー用の時間 |

### 3.2 再宣言の扱い（重要）

ユーザーの書き方には 2 通りある。

```glsl
outputColor = inputColor;              // 代入だけ
vec4 outputColor = (l + c + r) / 3.0;  // 自分で宣言
```

そこで **USER CODE を正規表現で走査し、`vec4 outputColor` / `vec2 uv` / `vec4 inputColor` の宣言があればラッパ側の自動宣言を出力しない**。
どちらの書き方でも通るようにする（宣言が無い場合のみアプリ側が用意する）。

### 3.3 値のレンジ

- 入出力とも **linear float**。0..1 にクランプしない（`inputColor.rgb *= 2.0;` が HDR として正しく保存できる）。
- 入力が LDR 画像でも、読み込み時点で既に linear 化されているのでシェーダ側の扱いは同一。
- 出力画像の `range` は `computeRange()` で再計算し、HDR 相当なら Auto level を既定 ON にする。

---

## 4. プリセット（Preset ドロップダウン）

| 名前 | 内容 |
| --- | --- |
| Passthrough | `outputColor = inputColor;` |
| Exposure | `inputColor.rgb *= 2.0; outputColor = inputColor;` |
| Grayscale | `outputColor = vec4(vec3(luminance(inputColor.rgb)), inputColor.a);` |
| Blur 3tap (H) | ユーザー提示の texelSize を使った横 3 タップ平均 |
| Channel swap | `outputColor = inputColor.bgra;` |
| **Gradient (生成)** | `outputColor = vec4(uv.x, uv.y, 0.0, 1.0);` |
| **Radial (生成)** | 中心からの距離で減衰する HDR 光源っぽいパターン |

生成用プリセットは「New Image」から開いたときの初期値になる。

---

## 5. 任意サイズの画像生成について

「入力なしの GLSL 実行」として、フィルタ機能と**完全に同じ実装で賄える**。

- 出力 W/H を入力欄で指定（既定 1024×1024、上限は `MAX_TEXTURE_SIZE` を見て制限）
- `inputTexture` には 1×1 の黒テクスチャをバインド（`inputColor` は `vec4(0,0,0,1)`）
- 使えるのは `uv` / `resolution` / `time` と数式のみ
- 出力は通常の画像ウィンドウ → そのまま HDR / EXR 保存できる

つまり **フィルタ機能の出力解像度を可変にした時点で、生成機能は自動的に手に入る**。
実装上は「入力あり／なし」のフラグ 1 つの差でしかない。

---

## 6. 実装ステップ（段階的）

1. **WebGL2 基盤** — `glsl-runtime.js` を新規追加。オフスクリーン canvas / `EXT_color_buffer_float` 検出 / フルスクリーン三角形 / RGBA32F FBO / `readPixels` → Float32Array。単体で「Passthrough が入力と一致する」ことを確認。
2. **ラッパ生成とコンパイル** — USER CODE の埋め込み、再宣言検出、コンパイルログの行番号補正（ラッパ分オフセットを引いてユーザー行番号に直す）。
3. **エディタ UI** — フローティングパネル、textarea、Tab キー、エラー表示、Run で新規ウィンドウ生成。画像ウィンドウに `GLSL` ボタン追加。
4. **出力サイズ指定＋生成モード** — トップバーに `New Image` を追加。プリセット追加。
5. **Auto preview / Replace / Revert** — デバウンス実行、低解像度プレビュー、元画像退避。
6. **セッション保存** — `source: { kind: "glsl", code, inputId, width, height }` を保存し、復元時に再実行（またはピクセルを embedded として保存）。
7. **README / PROGRESS 更新**、`index.html` のキャッシュバスター更新。

各ステップごとにユーザーが実機確認 → 次へ。

---

## 7. 技術的な注意点・リスク

| 項目 | 内容 | 対応 |
| --- | --- | --- |
| float FBO 非対応環境 | `EXT_color_buffer_float` が無いと RGBA32F に描画できない | RGBA16F にフォールバック → それも不可なら機能を無効化して明示メッセージ |
| float の線形補間 | `OES_texture_float_linear` が無いと float テクスチャは NEAREST のみ | 既定 NEAREST。拡張があれば LINEAR を選択可にする |
| メモリ | 8k×4k RGBA32F ≒ 536MB。`readPixels` 先の Float32Array も同サイズ | 上限解像度チェック、プレビューは縮小、必要ならタイル分割描画 |
| 上下反転 | WebGL の v 軸と画像の行順が逆 | アップロード時に行順を保ち、`vUv.y` を反転して **uv(0,0)=左上** に統一。Passthrough で往復一致を必ず検証 |
| 精度 | `precision highp float` 必須（mediump だと HDR が壊れる） | ラッパで固定 |
| GLSL のエラー行 | ラッパ分ずれる | コンパイルログをパースして行番号を補正して表示 |
| 無限ループ | GLSL に `while(true)` を書かれると GPU ハング／コンテキストロスト | `webglcontextlost` を捕捉して復旧＋警告。ループ回数の静的チェックまではしない |
| セッション容量 | 生成画像を embedded で保存すると IndexedDB が肥大 | コード＋パラメータのみ保存して復元時に再実行する方式を優先 |

---

## 8. 今回のスコープ外（将来）

- 複数入力テクスチャ（`inputTexture2` で 2 枚合成）
- スライダ uniform（`u_param0..3`）を UI から調整
- マルチパス（前パス結果を次パスの入力に）
- シェーダのローカル保存 / インポート・エクスポート
- 補完・シンタックスハイライト付きエディタ（外部ライブラリ導入となるため要ライセンス確認）
