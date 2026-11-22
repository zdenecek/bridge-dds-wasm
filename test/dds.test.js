import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createDds, DdsError } from '../dist/index.js';

// Club deals with tables and par scores from the PBN files that came with them.
const boards = JSON.parse(readFileSync(new URL('./boards.json', import.meta.url), 'utf8'));
const dds = await createDds();
const LHO = { N: 'E', E: 'S', S: 'W', W: 'N' };

test('calcTable matches the published tables', () => {
  for (const b of boards) assert.deepEqual(dds.calcTable(b.deal), b.table, b.deal);
});

test('par matches the published par scores', () => {
  for (const b of boards) {
    const par = dds.par(b.table, { dealer: b.dealer, vulnerability: b.vulnerability });
    assert.equal(par.score, b.parScore, b.deal);
    assert.ok(par.contracts.length > 0);
  }
});

test('par contracts agree with the table', () => {
  for (const b of boards) {
    const { contracts } = dds.par(b.table, { dealer: b.dealer, vulnerability: b.vulnerability });
    for (const c of contracts) {
      const seats = c.declarer.length === 2 ? c.declarer.split('') : [c.declarer];
      const tricks = Math.max(...seats.map((s) => b.table[s][c.strain]));
      assert.equal(tricks - 6 - c.level, c.result, `${b.deal} ${JSON.stringify(c)}`);
      assert.equal(c.doubled, c.result < 0);
    }
  }
});

test('analyse returns the table and dealer par', () => {
  const b = boards[0];
  const { table, par } = dds.analyse(b.deal, { dealer: b.dealer, vulnerability: b.vulnerability });
  assert.deepEqual(table, b.table);
  assert.equal(par.score, b.parScore);
});

test('sidesPar gives the dealer par for the side that starts', () => {
  for (const b of boards.slice(0, 10)) {
    const [ns, ew] = dds.sidesPar(b.table, b.vulnerability);
    const dealerPar = dds.par(b.table, { dealer: b.dealer, vulnerability: b.vulnerability });
    assert.equal('NS'.includes(b.dealer) ? ns.score : ew.score, dealerPar.score, b.deal);
  }
});

test('solveBoard scores every opening lead against the table', () => {
  for (const b of boards.slice(0, 5)) {
    for (const declarer of ['N', 'E']) {
      const { cards } = dds.solveBoard(b.deal, { trump: 'NT', leader: LHO[declarer] });
      assert.equal(cards.reduce((n, c) => n + 1 + c.equals.length, 0), 13);
      const best = Math.max(...cards.map((c) => c.tricks));
      assert.equal(best, 13 - b.table[declarer].NT, b.deal);
    }
  }
});

test('solveBoard accepts cards already played to the trick', () => {
  const b = boards[0];
  const lead = dds.solveBoard(b.deal, { trump: 'S', leader: 'E', solutions: 1 }).cards[0];
  const reply = dds.solveBoard(b.deal, { trump: 'S', leader: 'E', trick: [lead.card], solutions: 1 });
  assert.equal(reply.cards[0].tricks, b.table.N.S);
});

test('analysePlay keeps the value after the best lead and drops it after a bad one', () => {
  const b = boards[0];
  const { cards } = dds.solveBoard(b.deal, { trump: 'NT', leader: 'E' });
  const best = cards.reduce((x, y) => (y.tricks > x.tricks ? y : x));
  const worst = cards.reduce((x, y) => (y.tricks < x.tricks ? y : x));
  const declarerTricks = b.table.N.NT;
  assert.deepEqual(dds.analysePlay(b.deal, { trump: 'NT', leader: 'E', play: [best.card] }), [declarerTricks, declarerTricks]);
  assert.deepEqual(dds.analysePlay(b.deal, { trump: 'NT', leader: 'E', play: [worst.card] }), [declarerTricks, 13 - worst.tricks]);
});

test('a deal with a duplicate card raises DdsError', () => {
  assert.throws(() => dds.calcTable('N:AKQJ.T98.765.432 AKQJ.T98.765.432 AKQJ.T98.765.432 AKQJ.T98.765.432'), DdsError);
});

test('unknown seats and cards are rejected before reaching DDS', () => {
  assert.throws(() => dds.par(boards[0].table, { dealer: 'X', vulnerability: 'None' }), RangeError);
  assert.throws(() => dds.solveBoard(boards[0].deal, { trump: 'NT', leader: 'E', trick: ['S1'] }), RangeError);
});
