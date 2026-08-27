"""
የግዕዝ ቁጥሮች -- Ge'ez numerals.

Ethiopian dates are traditionally written in Ge'ez numerals rather than Arabic
digits, so an app rendering "2018" as a year usually wants ፳፻፲፰.

The system is additive-multiplicative with two separators: ፻ (100) and
፼ (10,000). A number is read in blocks of four digits; within each block the
hundreds part is written, then ፻, then the remainder. Blocks above the first are
suffixed with one ፼ per block, so 10^6 is ፻፼ and 10^8 is ፼፼.

There is no zero: Ge'ez has no symbol for it, and a "one" that multiplies a
separator is left implicit (100 is ፻, never ፩፻).

Port of ts/src/core/geez.ts.
"""

from __future__ import annotations

ONES = ["", "፩", "፪", "፫", "፬", "፭", "፮", "፯", "፰", "፱"]
TENS = ["", "፲", "፳", "፴", "፵", "፶", "፷", "፸", "፹", "፺"]
HUNDRED = "፻"
TEN_THOUSAND = "፼"


def _render_two(v: int) -> str:
    """1-99."""
    return TENS[v // 10] + ONES[v % 10]


def _render_four(v: int) -> str:
    """1-9999: the hundreds part, then ፻, then the remainder."""
    hi, lo = divmod(v, 100)
    s = ""
    # A leading "one" before ፻ is implicit: 100 is ፻, not ፩፻.
    if hi:
        s += ("" if hi == 1 else _render_two(hi)) + HUNDRED
    if lo:
        s += _render_two(lo)
    return s


def to_geez(n: int) -> str:
    """Convert a positive integer to Ge'ez numerals."""
    if not isinstance(n, int) or isinstance(n, bool) or n < 1:
        raise ValueError(
            f"Ge'ez numerals represent positive integers only, got {n}. There is no zero."
        )
    if n > 999_999_999:
        raise ValueError(f"Number too large to render in Ge'ez numerals: {n}.")

    # Split into blocks of 10,000, least significant first.
    blocks = []
    rest = n
    while rest > 0:
        blocks.append(rest % 10_000)
        rest //= 10_000

    out = ""
    for j in range(len(blocks) - 1, -1, -1):
        v = blocks[j]
        if v == 0:
            continue
        # As with ፻, a lone "one" multiplying ፼ is implicit: 10,000 is ፼. But
        # only for the leading block -- an interior implicit 1 would sit its ፼
        # run against the previous block's and become unreadable (10^8 + 10^4
        # must be ፼፼፩፼, since ፼፼፼ already means 10^12).
        leading = j == len(blocks) - 1
        out += ("" if (v == 1 and j > 0 and leading) else _render_four(v)) + TEN_THOUSAND * j
    return out


def from_geez(s: str) -> int:
    """
    Parse Ge'ez numerals back to an integer.

    Not exposed as an endpoint, but it makes the forward conversion testable:
    the suite round-trips every integer from 1 to 100,000.
    """
    chars = list(s.strip())
    if not chars:
        raise ValueError("Empty Ge'ez numeral.")

    # A block's magnitude is set by the RUN of ፼ that follows it: ፫፼፼ is
    # 3 x 10^8, not (3 x 10^4) x 10^4 applied cumulatively. So: accumulate a
    # block, count the ፼ run that closes it, and add block x 10^(4 x run).
    total = 0
    block = 0      # current block: hundreds already applied
    pending = 0    # digits since the last ፻
    saw_block = False

    def flush(run: int) -> None:
        nonlocal total, block, pending, saw_block
        v = block + pending
        # The implicit 1 exists only for a real ፼ run (፼ alone is 10,000); the
        # final flush of trailing digits must contribute nothing when empty.
        total += (1 if (v == 0 and not saw_block and run > 0) else v) * (10_000 ** run)
        block = pending = 0
        saw_block = False

    i = 0
    while i < len(chars):
        ch = chars[i]
        if ch in ONES[1:]:
            pending += ONES.index(ch); saw_block = True; i += 1
        elif ch in TENS[1:]:
            pending += TENS.index(ch) * 10; saw_block = True; i += 1
        elif ch == HUNDRED:
            block += (pending or 1) * 100; pending = 0; saw_block = True; i += 1
        elif ch == TEN_THOUSAND:
            run = 0
            while i < len(chars) and chars[i] == TEN_THOUSAND:
                run += 1; i += 1
            flush(run)
        else:
            raise ValueError(f"Not a Ge'ez numeral character: {ch!r}.")
    flush(0)
    return total
