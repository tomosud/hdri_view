# Optional vendor rebuild only. Serving the site needs no compiler or build step.
param([string]$Zig = "zig")
$ErrorActionPreference = "Stop"
& $Zig cc -target wasm32-freestanding -O3 -nostdlib -fno-builtin `
    '-Wl,--no-entry' '-Wl,--export=__heap_base' '-Wl,--export-memory' `
    '-Wl,-z,stack-size=65536' '-Wl,--initial-memory=131072' `
    '-Wl,--max-memory=1073741824' `
    "$PSScriptRoot/bridge.c" -o "$PSScriptRoot/bcdec.wasm"
if ($LASTEXITCODE -ne 0) { throw "bcdec WASM build failed" }
