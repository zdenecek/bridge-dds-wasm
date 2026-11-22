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
