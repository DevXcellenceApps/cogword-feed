// Cogword's lock engine for the free weekly web lock: a plain-JavaScript port of
// CogwordKit/Sources/CogwordKit/Engine (Puzzle and PuzzleState). It must give exactly the app's
// letters, moves, lamps and solved state: `node --test web/play/test/engine.test.mjs` replays the fixtures that
// CogwordKit's WebEngineFixtureTests checks against the Swift engine.

export const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** ((x % 26) + 26) % 26: offsets are kept unreduced, so this reads a letter at any distance. */
export function mod26(x) {
  return ((x % 26) + 26) % 26;
}

/** A lock's definition: the solution square, its links and its scramble. */
export class Lock {
  /** @param {{size:number, rows:string[], links:{from:number,to:number,dir:string}[], start:number[], par:number}} data */
  constructor(data) {
    this.size = data.size;
    this.rows = data.rows.map((r) => r.toUpperCase());
    this.start = data.start.slice();
    this.par = data.par;
    this.wheelCount = this.size * this.size;
    // Driver → its links, in the file's order (the cascade visits them in this order).
    this.links = new Map();
    for (const l of data.links) {
      if (!this.links.has(l.from)) this.links.set(l.from, []);
      this.links.get(l.from).push({ target: l.to, sign: l.dir === 'opposite' ? -1 : 1 });
    }
  }

  /** The alphabet index (0–25) of wheel i's solution letter. */
  solutionIndex(i) {
    return ALPHABET.indexOf(this.rows[Math.floor(i / this.size)][i % this.size]);
  }

  isDriver(i) {
    return (this.links.get(i) || []).length > 0;
  }

  /** Every wheel a turn of i moves, depth-first: i itself, then each driven wheel followed by
   *  its own cascade. An even number of opposite links along the way means the same direction. */
  cascade(i) {
    const steps = [];
    const visit = (w, depth, sign, driver) => {
      steps.push({ wheel: w, depth, sign, driver });
      for (const link of this.links.get(w) || []) visit(link.target, depth + 1, sign * link.sign, w);
    };
    visit(i, 0, 1, null);
    return steps;
  }

  /** 3 at par or better, 2 within par + 2, otherwise 1 (the web has no hints). */
  stars(moves) {
    return moves <= this.par ? 3 : moves <= this.par + 2 ? 2 : 1;
  }
}

/** A lock being played: unreduced offsets from each solution letter, moves and the wheel the
 *  current move is adjusting. `accepted` is the accepted word list (a Set of upper-case words). */
export class State {
  constructor(lock, accepted) {
    this.lock = lock;
    this.accepted = accepted;
    this.offsets = lock.start.slice();
    this.moves = 0;
    this.lastWheel = null;
  }

  /** Turns wheel i one notch (+1 forward, −1 back) with its whole cascade. Starts a new move
   *  unless i is the wheel the current move is already adjusting. A solved board doesn't turn:
   *  returns null. */
  turn(i, direction) {
    if (this.isSolved) return null;
    const rowsBefore = this.litRows, colsBefore = this.litColumns;
    const cascade = this.lock.cascade(i);
    for (const step of cascade) this.offsets[step.wheel] += direction * step.sign;
    if (this.lastWheel !== i) {
      this.moves += 1;
      this.lastWheel = i;
    }
    const rows = this.litRows, cols = this.litColumns;
    return {
      cascade,
      lockedRows: rows.filter((r) => !rowsBefore.includes(r)),
      lockedColumns: cols.filter((c) => !colsBefore.includes(c)),
      solvedBoard: this.isSolved,
    };
  }

  reset() {
    this.offsets = this.lock.start.slice();
    this.moves = 0;
    this.lastWheel = null;
  }

  /** For Undo: the board, moves and merging wheel before a turn. */
  snapshot() {
    return { offsets: this.offsets.slice(), moves: this.moves, lastWheel: this.lastWheel };
  }

  restore(s) {
    this.offsets = s.offsets.slice();
    this.moves = s.moves;
    this.lastWheel = s.lastWheel;
  }

  /** The unreduced letter position of wheel i (solution index + offset): animate by this. */
  position(i) {
    return this.lock.solutionIndex(i) + this.offsets[i];
  }

  letterIndex(i) {
    return mod26(this.position(i));
  }

  letter(i) {
    return ALPHABET[this.letterIndex(i)];
  }

  wordInRow(r) {
    let s = '';
    for (let c = 0; c < this.lock.size; c++) s += this.letter(r * this.lock.size + c);
    return s;
  }

  wordInColumn(c) {
    let s = '';
    for (let r = 0; r < this.lock.size; r++) s += this.letter(r * this.lock.size + c);
    return s;
  }

  isRowSolved(r) {
    for (let c = 0; c < this.lock.size; c++) if (mod26(this.offsets[r * this.lock.size + c]) !== 0) return false;
    return true;
  }

  isColumnSolved(c) {
    for (let r = 0; r < this.lock.size; r++) if (mod26(this.offsets[r * this.lock.size + c]) !== 0) return false;
    return true;
  }

  /** True when the grid shows the intended words. */
  get showsIntendedSolution() {
    return this.offsets.every((o) => mod26(o) === 0);
  }

  /** True when every row and column is an accepted word. */
  get isWordSquare() {
    for (let i = 0; i < this.lock.size; i++) {
      if (!this.accepted.has(this.wordInRow(i)) || !this.accepted.has(this.wordInColumn(i))) return false;
    }
    return true;
  }

  get isSolved() {
    return this.showsIntendedSolution || this.isWordSquare;
  }

  /** Lamps: lines showing their intended word, or every line once the board is solved. */
  get litRows() {
    const all = [...Array(this.lock.size).keys()];
    return this.isSolved ? all : all.filter((r) => this.isRowSolved(r));
  }

  get litColumns() {
    const all = [...Array(this.lock.size).keys()];
    return this.isSolved ? all : all.filter((c) => this.isColumnSolved(c));
  }

  get stars() {
    return this.lock.stars(this.moves);
  }
}
