#!/usr/bin/env bash
# Compiles DDS (git submodule in dds/) and native/bridge_dds.cpp to a single
# ES module with the wasm inlined. Needs emcc on PATH; set EMCC_DOCKER=1 to use
# the emscripten/emsdk image instead.
set -euo pipefail
cd "$(dirname "$0")/.."

out=wasm
mkdir -p "$out"

srcs=()
while IFS= read -r f; do srcs+=("$f"); done < <(find dds/library/src -name '*.cpp' ! -iname '*test*' | sort)

flags=(
  -O3 -std=c++20 -fexceptions -fwasm-exceptions
  -I dds/library/src
  "${srcs[@]}" native/bridge_dds.cpp
  -sWASM=1 -sSINGLE_FILE=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createDdsModule
  -sENVIRONMENT=web,worker,node
  -sALLOW_MEMORY_GROWTH=1 -sINITIAL_MEMORY=67108864 -sSTACK_SIZE=4194304
  "-sEXPORTED_FUNCTIONS=['_bdw_calc_table','_bdw_dealer_par','_bdw_sides_par','_bdw_solve_board','_bdw_analyse_play','_bdw_error_message','_malloc','_free']"
  "-sEXPORTED_RUNTIME_METHODS=['stringToUTF8','UTF8ToString','HEAP32']"
  -o "$out/dds.mjs"
)

if [[ "${EMCC_DOCKER:-}" == 1 ]]; then
  docker run --rm -v "$PWD:/src" -w /src emscripten/emsdk:6.0.13 em++ "${flags[@]}"
else
  em++ "${flags[@]}"
fi

cat > "$out/dds.d.mts" <<'EOF'
export interface DdsModule {
  HEAP32: Int32Array;
  _malloc(size: number): number;
  _free(ptr: number): void;
  _bdw_calc_table(pbn: number, out: number): number;
  _bdw_dealer_par(table: number, dealer: number, vulnerable: number, out: number): number;
  _bdw_sides_par(table: number, vulnerable: number, out: number): number;
  _bdw_solve_board(pbn: number, trump: number, first: number, trick: number, target: number, solutions: number, mode: number, out: number): number;
  _bdw_analyse_play(pbn: number, trump: number, first: number, play: number, out: number): number;
  _bdw_error_message(code: number, line: number): void;
  stringToUTF8(str: string, ptr: number, maxBytes: number): void;
  UTF8ToString(ptr: number): string;
}
export default function createDdsModule(options?: object): Promise<DdsModule>;
EOF

ls -l "$out"
