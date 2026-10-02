// @name ColorChecker Classic (2014+, sRGB)
// @category Generated images
// @generator true
// @order 300

// 24-patch digital reference; X-Rite November 2014 formulation and newer.
// Lab D50 source: https://babelcolor.com/index_htm_files/ColorChecker24_After_Nov2014.txt
// Conversion: https://registry.color.org/rgb-registry/files/sRGB.pdf (p.4 inverse matrix).
// Lab D50 -> XYZ D50 -> Bradford-adapted linear sRGB D65; no white/black rescaling.
// Out-of-sRGB components are clipped to [0,1]; alpha is one.
// Export size: 768x512, 1536x1024, 3072x2048 (3:2). Other ratios are letterboxed.
// PNG export: Current display, RGB, Linear, Auto level OFF, Brightness 0 EV,
// Display Gamma 1.0, Invert OFF, same dimensions (or Nearest).
// Do not use RAW PNG export: the viewer tone-maps GLSL/HDR sources there.
// Reproduce from reference-data via python scripts/generate_colorchecker.py.
const vec3 patches[24] = vec3[24](
    vec3(0.1737017973, 0.0787826141, 0.0528512142), // A1 Dark skin
    vec3(0.5598449530, 0.2774117244, 0.2108740650), // B1 Light skin
    vec3(0.1042247733, 0.1888997690, 0.3289082674), // C1 Blue sky
    vec3(0.1057649409, 0.1507396824, 0.0508316901), // D1 Foliage
    vec3(0.2274716975, 0.2123882049, 0.4264183901), // E1 Blue flower
    vec3(0.1153483230, 0.5074008550, 0.4110970837), // F1 Bluish green
    vec3(0.7459688395, 0.2021071770, 0.0298616548), // A2 Orange
    vec3(0.0587535624, 0.1011748853, 0.3877242649), // B2 Purplish blue
    vec3(0.5601722364, 0.0801327360, 0.1145770255), // C2 Moderate red
    vec3(0.1091775172, 0.0419952245, 0.1381284622), // D2 Purple
    vec3(0.3328204490, 0.4973373350, 0.0425854225), // E2 Yellow green
    vec3(0.7711201696, 0.3578694136, 0.0204406969), // F2 Orange yellow
    vec3(0.0209600737, 0.0475313862, 0.2841121545), // A3 Blue
    vec3(0.0460939726, 0.2920239033, 0.0614705019), // B3 Green
    vec3(0.4462016981, 0.0363913190, 0.0405471966), // C3 Red
    vec3(0.8417938487, 0.5743393012, 0.0046512358), // D3 Yellow
    vec3(0.5223801887, 0.0777988875, 0.2892942167), // E3 Magenta
    vec3(0.0000000000, 0.2336469406, 0.3771646151), // F3 Cyan
    vec3(0.8796672622, 0.8849399241, 0.8341841750), // A4 White
    vec3(0.5845858249, 0.5921098775, 0.5844346621), // B4 Neutral 8
    vec3(0.3577505156, 0.3670410085, 0.3652390103), // C4 Neutral 6.5
    vec3(0.1901237834, 0.1908473577, 0.1897993413), // D4 Neutral 5
    vec3(0.0859430900, 0.0887266049, 0.0897973147), // E4 Neutral 3.5
    vec3(0.0313591647, 0.0314927513, 0.0323201866) // F4 Black
);

// Preserve square patches at any output aspect ratio.
float cellSize = min(resolution.x / 6.0, resolution.y / 4.0);
vec2 offset = (resolution - cellSize * vec2(6.0, 4.0)) * 0.5;
vec2 grid = (uv * resolution - offset) / cellSize;
vec3 rgb = vec3(0.0);
if (all(greaterThanEqual(grid, vec2(0.0))) && all(lessThan(grid, vec2(6.0, 4.0)))) {
    ivec2 cell = ivec2(floor(grid));
    vec2 p = fract(grid);
    if (all(greaterThanEqual(p, vec2(0.0625))) && all(lessThan(p, vec2(0.9375)))) {
        rgb = patches[cell.y * 6 + cell.x];
    }
}
outputColor = vec4(rgb, 1.0);
