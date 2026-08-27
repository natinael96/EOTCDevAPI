/**
 * የግዕዝ ቁጥሮች -- Ge'ez numerals.
 *
 * Ethiopian dates are traditionally written in Ge'ez numerals rather than
 * Arabic digits, so an app rendering "2018" as a year usually wants ፳፻፲፰.
 *
 * The system is additive-multiplicative with two separators: ፻ (100) and
 * ፼ (10,000). A number is read in blocks of four digits; within each block the
 * hundreds part is written, then ፻, then the remainder. Blocks above the first
 * are suffixed with one ፼ per block, so 10^6 is ፻፼ and 10^8 is ፼፼.
 *
 * There is no zero: Ge'ez has no symbol for it, and a "one" that multiplies a
 * separator is left implicit (100 is ፻, never ፩፻).
 */

const ONES = ['', '፩', '፪', '፫', '፬', '፭', '፮', '፯', '፰', '፱'] as const;
const TENS = ['', '፲', '፳', '፴', '፵', '፶', '፷', '፸', '፹', '፺'] as const;
const HUNDRED = '፻';
const TEN_THOUSAND = '፼';

/** 1-99. */
function renderTwo(v: number): string {
  return TENS[Math.floor(v / 10)] + ONES[v % 10];
}

/** 1-9999: the hundreds part, then ፻, then the remainder. */
function renderFour(v: number): string {
  const hi = Math.floor(v / 100);
  const lo = v % 100;
  let s = '';
  // A leading "one" before ፻ is implicit: 100 is ፻, not ፩፻.
  if (hi) s += (hi === 1 ? '' : renderTwo(hi)) + HUNDRED;
  if (lo) s += renderTwo(lo);
  return s;
}

/** Convert a positive integer to Ge'ez numerals. */
export function toGeez(n: number): string {
  if (!Number.isInteger(n) || n < 1) {
    throw new RangeError(`Ge'ez numerals represent positive integers only, got ${n}. There is no zero.`);
  }
  if (n > 999_999_999) {
    throw new RangeError(`Number too large to render in Ge'ez numerals: ${n}.`);
  }

  // Split into blocks of 10,000, least significant first.
  const blocks: number[] = [];
  for (let rest = n; rest > 0; rest = Math.floor(rest / 10_000)) blocks.push(rest % 10_000);

  let out = '';
  for (let j = blocks.length - 1; j >= 0; j--) {
    const v = blocks[j];
    if (v === 0) continue;
    // As with ፻, a lone "one" multiplying ፼ is implicit: 10,000 is ፼. But
    // only for the leading block -- an interior implicit 1 would sit its ፼
    // run against the previous block's and become unreadable (10^8 + 10^4
    // must be ፼፼፩፼, since ፼፼፼ already means 10^12).
    const leading = j === blocks.length - 1;
    out += (v === 1 && j > 0 && leading ? '' : renderFour(v)) + TEN_THOUSAND.repeat(j);
  }
  return out;
}

/**
 * Parse Ge'ez numerals back to an integer.
 *
 * Not exposed as an endpoint, but it makes the forward conversion testable:
 * the suite round-trips every integer from 1 to 100,000.
 */
export function fromGeez(s: string): number {
  const chars = [...s.trim()];
  if (chars.length === 0) throw new RangeError('Empty Ge\'ez numeral.');

  // A block's magnitude is set by the RUN of ፼ that follows it: ፫፼፼ is
  // 3 x 10^8, not (3 x 10^4) x 10^4 applied cumulatively. So: accumulate a
  // block, count the ፼ run that closes it, and add block x 10^(4 x run).
  let total = 0;
  let block = 0;   // current block: hundreds already applied
  let pending = 0; // digits since the last ፻
  let sawBlock = false;

  const flush = (run: number) => {
    const v = block + pending;
    // The implicit 1 exists only for a real ፼ run (፼ alone is 10,000); the
    // final flush of trailing digits must contribute nothing when empty.
    total += (v === 0 && !sawBlock && run > 0 ? 1 : v) * Math.pow(10_000, run);
    block = 0; pending = 0; sawBlock = false;
  };

  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    const one = ONES.indexOf(ch as never);
    const ten = TENS.indexOf(ch as never);
    if (one > 0) { pending += one; sawBlock = true; i++; }
    else if (ten > 0) { pending += ten * 10; sawBlock = true; i++; }
    else if (ch === HUNDRED) { block += (pending || 1) * 100; pending = 0; sawBlock = true; i++; }
    else if (ch === TEN_THOUSAND) {
      let run = 0;
      while (i < chars.length && chars[i] === TEN_THOUSAND) { run++; i++; }
      flush(run);
    }
    else throw new RangeError(`Not a Ge'ez numeral character: '${ch}'.`);
  }
  flush(0);
  return total;
}
