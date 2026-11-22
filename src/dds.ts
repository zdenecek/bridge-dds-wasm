import createDdsModule, { type DdsModule } from '../wasm/dds.mjs';
import { DdsError } from './error.js';

export { DdsError };

export type Seat = 'N' | 'E' | 'S' | 'W';
export type Suit = 'S' | 'H' | 'D' | 'C';
export type Strain = Suit | 'NT';
export type Rank = '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'T' | 'J' | 'Q' | 'K' | 'A';
export type Vulnerability = 'None' | 'NS' | 'EW' | 'All' | 'Both';

/** A card as two characters, suit then rank, e.g. `"SA"` or `"HT"`. */
export type Card = `${Suit}${Rank}`;

/** Double dummy tricks for each declarer and strain. */
export type DdTable = Record<Seat, Record<Strain, number>>;

export interface ParContract {
  level: number;
  strain: Strain;
  /** A pair when either partner can declare it. */
  declarer: Seat | 'NS' | 'EW';
  /** Sacrifices are doubled. */
  doubled: boolean;
  /** Overtricks as a positive number, undertricks as a negative one. */
  result: number;
}

export interface Par {
  /** From North–South's point of view. */
  score: number;
  /** Every contract that reaches the par score. */
  contracts: ParContract[];
}

export interface CardScore {
  card: Card;
  /** Lower cards of the same suit that give the same result. */
  equals: Card[];
  /** Tricks for the side to play, or -1 when DDS did not score the card. */
  tricks: number;
}

export interface SolveOptions {
  trump: Strain;
  /** Who led to the current trick. */
  leader: Seat;
  /** Cards already played to the current trick, at most three. */
  trick?: Card[];
  /** DDS `target`, default -1 (find the maximum). */
  target?: number;
  /** DDS `solutions`: 1 one best card, 2 all best cards, 3 every card (default). */
  solutions?: 1 | 2 | 3;
  /** DDS `mode`, default 1. */
  mode?: 0 | 1 | 2;
}

export interface Solution {
  nodes: number;
  cards: CardScore[];
}

export interface PlayOptions {
  trump: Strain;
  /** The opening leader. */
  leader: Seat;
  /** Cards in the order played. */
  play: Card[];
}

const SEATS: Seat[] = ['N', 'E', 'S', 'W'];
const SUITS: Suit[] = ['S', 'H', 'D', 'C'];
// DDS orders strains S, H, D, C, NT in tables and trumps, but NT first in par contracts.
const TABLE_STRAINS: Strain[] = ['S', 'H', 'D', 'C', 'NT'];
const PAR_STRAINS: Strain[] = ['NT', 'S', 'H', 'D', 'C'];
const PAR_SEATS: ParContract['declarer'][] = ['N', 'E', 'S', 'W', 'NS', 'EW'];
const RANKS = '23456789TJQKA';
const VULNERABILITY: Record<Vulnerability, number> = { None: 0, All: 1, Both: 1, NS: 2, EW: 3 };

const OUT_INTS = 128;
const TEXT_BYTES = 128;

function seatIndex(seat: Seat): number {
  const i = SEATS.indexOf(seat);
  if (i < 0) throw new RangeError(`Unknown seat ${seat}`);
  return i;
}

function strainIndex(strain: Strain): number {
  const i = TABLE_STRAINS.indexOf(strain);
  if (i < 0) throw new RangeError(`Unknown strain ${strain}`);
  return i;
}

function vulnerabilityIndex(vulnerability: Vulnerability): number {
  const i = VULNERABILITY[vulnerability];
  if (i === undefined) throw new RangeError(`Unknown vulnerability ${vulnerability}`);
  return i;
}

function parseCard(card: Card): [suit: number, rank: number] {
  const suit = SUITS.indexOf(card[0] as Suit);
  const rank = RANKS.indexOf(card[1] ?? '') + 2;
  if (suit < 0 || rank < 2 || card.length !== 2) throw new RangeError(`Unknown card ${card}`);
  return [suit, rank];
}

function cardName(suit: number, rank: number): Card {
  return `${SUITS[suit]}${RANKS[rank - 2]}` as Card;
}

/** Takes the cards of a trick in progress out of a PBN deal; DDS wants only the cards still held. */
function removePlayed(deal: string, leader: Seat, trick: Card[]): string {
  if (trick.length === 0) return deal;
  const match = /^\s*([NESW]):(.*)$/.exec(deal);
  if (!match) throw new RangeError('Deal must be PBN, e.g. "N:AK.Q.J.T ..."');
  const first = seatIndex(match[1] as Seat);
  const hands = match[2]!.trim().split(/\s+/).map((hand) => hand.split('.'));
  trick.forEach((card, i) => {
    const [suit] = parseCard(card);
    const hand = hands[(seatIndex(leader) + i - first + 4) % 4];
    if (hand?.[suit] !== undefined) hand[suit] = hand[suit]!.replace(card[1]!, '');
  });
  return `${match[1]}:${hands.map((hand) => hand.join('.')).join(' ')}`;
}

function equalCards(suit: number, holding: number): Card[] {
  const cards: Card[] = [];
  for (let rank = 14; rank >= 2; rank--) {
    if (holding & (1 << rank)) cards.push(cardName(suit, rank));
  }
  return cards;
}

/** Synchronous solver. Calls block, so in a browser run it in a worker (see `bridge-dds-wasm/worker`). */
export class Dds {
  private readonly out: number;
  private readonly text: number;
  private readonly ints: number;

  constructor(private readonly module: DdsModule) {
    this.out = module._malloc(OUT_INTS * 4);
    this.text = module._malloc(TEXT_BYTES);
    this.ints = module._malloc(32 * 4);
  }

  /** Tricks for every declarer and strain. `deal` is a PBN deal such as `"N:AKQ2.… … … …"`. */
  calcTable(deal: string): DdTable {
    this.check(this.module._bdw_calc_table(this.string(deal), this.out));
    const raw = this.read(this.out, 20);
    const table = {} as DdTable;
    SEATS.forEach((seat, h) => {
      table[seat] = {} as Record<Strain, number>;
      TABLE_STRAINS.forEach((strain, s) => (table[seat][strain] = raw[s * 4 + h]!));
    });
    return table;
  }

  /** Par when the dealer starts the bidding (DDS `DealerPar`). */
  par(table: DdTable, options: { dealer: Seat; vulnerability: Vulnerability }): Par {
    this.writeTable(table);
    this.check(this.module._bdw_dealer_par(
      this.ints, seatIndex(options.dealer), vulnerabilityIndex(options.vulnerability), this.out));
    return this.readPar(this.out);
  }

  /** Par with North–South starting the bidding, then with East–West starting (DDS `SidesPar`). */
  sidesPar(table: DdTable, vulnerability: Vulnerability): [Par, Par] {
    this.writeTable(table);
    this.check(this.module._bdw_sides_par(this.ints, vulnerabilityIndex(vulnerability), this.out));
    const ew = this.readPar(this.out + 52 * 4);
    // DDS scores this half from East–West's side.
    ew.score = -ew.score || 0;
    return [this.readPar(this.out), ew];
  }

  /** Table and dealer par in one call, which is what a results page usually needs. */
  analyse(deal: string, options: { dealer: Seat; vulnerability: Vulnerability }): { table: DdTable; par: Par } {
    const table = this.calcTable(deal);
    return { table, par: this.par(table, options) };
  }

  /**
   * Double dummy value of each card the next player can play. `deal` is the PBN deal of
   * the cards still held; cards of the current trick are taken out of it if still there.
   */
  solveBoard(deal: string, options: SolveOptions): Solution {
    const trick = options.trick ?? [];
    if (trick.length > 3) throw new RangeError('A trick in progress has at most three cards');
    deal = removePlayed(deal, options.leader, trick);
    const heap = this.module.HEAP32;
    for (let i = 0; i < 3; i++) {
      const [suit, rank] = trick[i] ? parseCard(trick[i]!) : [0, 0];
      heap[(this.ints >> 2) + 2 * i] = suit;
      heap[(this.ints >> 2) + 2 * i + 1] = rank;
    }
    const pbn = this.string(deal);
    this.check(this.module._bdw_solve_board(
      pbn, strainIndex(options.trump), seatIndex(options.leader), this.ints,
      options.target ?? -1, options.solutions ?? 3, options.mode ?? 1, this.out));
    const raw = this.read(this.out, 2 + 4 * 13);
    const cards: CardScore[] = [];
    for (let i = 0; i < raw[1]!; i++) {
      const [suit, rank, equals, score] = raw.slice(2 + 4 * i, 6 + 4 * i) as [number, number, number, number];
      cards.push({ card: cardName(suit, rank), equals: equalCards(suit, equals), tricks: score });
    }
    return { nodes: raw[0]!, cards };
  }

  /**
   * Declarer's double dummy tricks before the play and after each card.
   * Declarer is the player to the right of `leader`.
   */
  analysePlay(deal: string, options: PlayOptions): number[] {
    if (options.play.length > 52) throw new RangeError('At most 52 cards');
    options.play.forEach(parseCard);
    const pbn = this.string(deal);
    const play = this.module._malloc(TEXT_BYTES);
    try {
      this.module.stringToUTF8(options.play.join(''), play, TEXT_BYTES);
      this.check(this.module._bdw_analyse_play(
        pbn, strainIndex(options.trump), seatIndex(options.leader), play, this.out));
    } finally {
      this.module._free(play);
    }
    const count = this.module.HEAP32[this.out >> 2]!;
    return this.read(this.out + 4, count);
  }

  private string(value: string): number {
    if (value.length >= TEXT_BYTES) throw new RangeError('Deal is too long for PBN');
    this.module.stringToUTF8(value, this.text, TEXT_BYTES);
    return this.text;
  }

  private read(ptr: number, count: number): number[] {
    return Array.from(this.module.HEAP32.subarray(ptr >> 2, (ptr >> 2) + count));
  }

  private writeTable(table: DdTable): void {
    const heap = this.module.HEAP32;
    SEATS.forEach((seat, h) => TABLE_STRAINS.forEach((strain, s) => {
      heap[(this.ints >> 2) + s * 4 + h] = table[seat][strain];
    }));
  }

  private readPar(ptr: number): Par {
    const raw = this.read(ptr, 52);
    const contracts: ParContract[] = [];
    for (let i = 0; i < raw[1]!; i++) {
      const [level, denom, seats, under, over] = raw.slice(2 + 5 * i, 7 + 5 * i) as [number, number, number, number, number];
      contracts.push({
        level,
        strain: PAR_STRAINS[denom]!,
        declarer: PAR_SEATS[seats]!,
        doubled: under > 0,
        result: under > 0 ? -under : over,
      });
    }
    return { score: raw[0]!, contracts };
  }

  private check(code: number): void {
    if (code === 1) return;
    const line = this.module._malloc(80);
    try {
      this.module._bdw_error_message(code, line);
      throw new DdsError(code, this.module.UTF8ToString(line));
    } finally {
      this.module._free(line);
    }
  }
}

let shared: Promise<Dds> | undefined;

/** Loads the solver once and returns the same instance on later calls. */
export function createDds(): Promise<Dds> {
  shared ??= createDdsModule().then((module) => new Dds(module));
  return shared;
}

