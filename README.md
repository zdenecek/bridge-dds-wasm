# bridge-dds-wasm

The [double dummy solver (DDS)](https://github.com/dds-bridge/dds) for contract bridge,
compiled to WebAssembly, with a small typed API. Works in browsers, Web Workers and Node,
with no threads and no special server headers. One ES module, about 150 KB gzipped.

```bash
npm install bridge-dds-wasm
```

## Use

```ts
import { createDds } from 'bridge-dds-wasm';

const dds = await createDds();
const deal = 'N:K8632.94.6.Q9642 97.AT3.A9432.A53 A4.KQ8.KQT.KJT87 QJT5.J7652.J875.';

const { table, par } = dds.analyse(deal, { dealer: 'S', vulnerability: 'None' });
table.N.C;   // 10 tricks for North in clubs
par;         // { score: 130, contracts: [{ level: 4, strain: 'C', declarer: 'NS', doubled: false, result: 0 }] }

dds.solveBoard(deal, { trump: 'C', leader: 'E' });
// { nodes, cards: [{ card: 'DA', equals: [], tricks: 3 }, …] } – tricks for the side to play

dds.analysePlay(deal, { trump: 'C', leader: 'E', play: ['DA', 'DT', 'D5', 'D6'] });
// declarer's double dummy tricks before the play and after each card
```

| method | DDS function | what it returns |
| --- | --- | --- |
| `calcTable(deal)` | `CalcDDtablePBN` | tricks for every declarer and strain |
| `par(table, { dealer, vulnerability })` | `DealerParBin` | par score and contracts when the dealer starts |
| `sidesPar(table, vulnerability)` | `SidesParBin` | par with NS starting, then with EW starting |
| `analyse(deal, { dealer, vulnerability })` | both of the above | `{ table, par }` |
| `solveBoard(deal, options)` | `SolveBoardPBN` | value of each card the next player can play |
| `analysePlay(deal, options)` | `AnalysePlayPBN` | declarer's tricks after each card played |

Scores are always from North–South's point of view. Cards are two characters, suit then
rank (`'SA'`, `'HT'`). Errors from DDS are thrown as `DdsError` with the DDS `code`.

A table takes about 150–200 ms. Calls block, so in a browser run them in a worker:

```ts
import { connectDdsWorker } from 'bridge-dds-wasm';

const dds = connectDdsWorker();          // same methods, returning promises
const { table, par } = await dds.analyse(deal, { dealer: 'S', vulnerability: 'None' });
```

`connectDdsWorker()` starts the worker that ships with the package. With Vite, pass the
worker in yourself, because dependency pre-bundling breaks the package-relative URL:

```ts
import DdsWorker from 'bridge-dds-wasm/worker?worker';
const dds = connectDdsWorker(new DdsWorker());
```

## Build

DDS is a git submodule pinned to a tested commit.

```bash
git submodule update --init
npm install
npm run build:wasm   # needs emcc on PATH, or EMCC_DOCKER=1 to build in emscripten/emsdk
npm test
```

The tests compare tables and par scores with 40 real club deals whose analysis came with
their PBN files.

## License

Apache-2.0, like DDS. See `NOTICE`.
