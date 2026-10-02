// @name HDR Step & Ramp (labeled)
// @category Generated images
// @generator true
// @order 260

// Generate four equal-height HDR bands, from top to bottom:
// warm RGB steps, labeled grayscale steps, grayscale ramp, warm RGB ramp.
// maxValue sets the range from 0 to 99 (default: 10).
// Outer bands use RGB 1:0.5:0.25; middle bands use equal RGB. Alpha is one.
// No input image is required. HDR values are not clamped to 0-1.
// 指定値：0～99
float maxValue = 10.0;
maxValue = clamp(maxValue, 0.0, 99.0);

float x = clamp(uv.x, 0.0, 1.0);
float maxInteger = floor(maxValue);
float stepCount = maxInteger + 1.0;
float level = min(floor(x * stepCount), maxInteger);

float value = (uv.y < 0.5) ? level : x * maxValue;
bool equalRgb = uv.y >= 0.25 && uv.y < 0.75;
vec3 rgb = value * (equalRgb ? vec3(1.0) : vec3(1.0, 0.5, 0.25));

// 2段目（同じ値・段階）だけに数字を描く
if (uv.y >= 0.25 && uv.y < 0.5) {
    // 各数字の7セグメントの点灯パターン
    const int patterns[10] = int[10](
        63, 6, 91, 79, 102,
        109, 125, 7, 127, 111
    );

    int number = int(level);
    int digitCount = (number >= 10) ? 2 : 1;

    float bandWidth = resolution.x / stepCount;

    // 数字の高さ。段の幅に合わせて縮小
    float fontHeight = min(
        24.0,
        min(bandWidth * 0.65, resolution.y * 0.12)
    );
    float scale = max(fontHeight * 0.5, 0.001);

    // 数字を各階調の中央、2段目の下端付近に配置
    vec2 center = vec2(
        (level + 0.5) / stepCount,
        0.45
    );

    vec2 p = (uv - center) * resolution / scale;

    float totalWidth = (digitCount == 2) ? 2.4 : 1.0;
    p += vec2(totalWidth * 0.5, 1.0);

    float nearest = 10000.0;

    for (int i = 0; i < 2; ++i) {
        if (i >= digitCount) break;

        int digit;
        if (digitCount == 2 && i == 0) {
            digit = number / 10;
        } else {
            digit = number % 10;
        }

        int bits = patterns[digit];
        vec2 q = p - vec2(float(i) * 1.4, 0.0);

        for (int s = 0; s < 7; ++s) {
            if ((bits & (1 << s)) == 0) continue;

            vec2 segmentCenter;
            vec2 halfSize;

            // 上・中央・下の横棒
            if (s == 0 || s == 3 || s == 6) {
                float sy = (s == 0) ? 0.05 :
                           (s == 3) ? 1.95 : 1.0;
                segmentCenter = vec2(0.5, sy);
                halfSize = vec2(0.38, 0.07);
            } else {
                // 左右の縦棒
                float sx = (s == 1 || s == 2) ? 0.95 : 0.05;
                float sy = (s == 1 || s == 5) ? 0.5 : 1.5;
                segmentCenter = vec2(sx, sy);
                halfSize = vec2(0.07, 0.38);
            }

            vec2 d = abs(q - segmentCenter) - halfSize;
            float distanceToSegment =
                length(max(d, vec2(0.0))) +
                min(max(d.x, d.y), 0.0);

            nearest = min(nearest, distanceToSegment);
        }
    }

    // 白い数字＋黒い縁取り
    float aa = 0.65 / scale;
    float outline = 1.2 / scale;

    float borderMask =
        1.0 - smoothstep(outline - aa, outline + aa, nearest);
    float textMask =
        1.0 - smoothstep(-aa, aa, nearest);

    rgb = mix(rgb, vec3(0.0), borderMask);
    rgb = mix(rgb, vec3(1.0), textMask);
}

outputColor = vec4(rgb, 1.0);
