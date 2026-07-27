package amm

import (
	"fmt"
	"math/big"
	"strings"
)

// decimalPlaces mirrors bignumber.js's default DECIMAL_PLACES (20). The web
// AmmRouter runs on bignumber.js with its default config, where addition,
// subtraction and multiplication are exact (unbounded) and only division rounds
// — to 20 decimal places, ROUND_HALF_UP (nearest, ties away from zero). The Go
// router reproduces those exact semantics so hub and web quotes never diverge.
//
// sdkmath.LegacyDec is deliberately NOT used here: its Mul rounds to 18 places,
// which bignumber.js's exact multiplication does not, so LegacyDec would drift
// from the web on multi-hop routes.
const decimalPlaces = 20

// dec is an exact rational used for the AMM math. Every operation returns a new
// value; the zero dec (nil rat) must not be used — construct with newDec/decInt.
type dec struct{ r *big.Rat }

// decInt builds a dec from an int64 (used for constants like 1 and 100).
func decInt(i int64) dec { return dec{new(big.Rat).SetInt64(i)} }

// newDec parses a decimal string (integer, "0.003", or scientific form). Chain
// values arrive as strings: reserves as integers, fee as a LegacyDec string.
func newDec(s string) (dec, error) {
	r, ok := new(big.Rat).SetString(s)
	if !ok {
		return dec{}, fmt.Errorf("invalid number %q", s)
	}
	return dec{r}, nil
}

func (d dec) add(o dec) dec { return dec{new(big.Rat).Add(d.r, o.r)} }
func (d dec) sub(o dec) dec { return dec{new(big.Rat).Sub(d.r, o.r)} }
func (d dec) mul(o dec) dec { return dec{new(big.Rat).Mul(d.r, o.r)} }

// quo divides and rounds the result to decimalPlaces, ties away from zero —
// exactly bignumber.js's dividedBy under its default config. Division by zero is
// reported so callers can treat the pool as having no usable liquidity rather
// than panicking (big.Rat.Quo panics on a zero divisor).
func (d dec) quo(o dec) (dec, error) {
	if o.r.Sign() == 0 {
		return dec{}, fmt.Errorf("division by zero")
	}
	q := new(big.Rat).Quo(d.r, o.r)
	return dec{roundRat(q, decimalPlaces)}, nil
}

func (d dec) cmp(o dec) int  { return d.r.Cmp(o.r) }
func (d dec) sign() int      { return d.r.Sign() }
func (d dec) isZero() bool   { return d.r.Sign() == 0 }
func (d dec) gt(o dec) bool  { return d.r.Cmp(o.r) > 0 }
func (d dec) lte(o dec) bool { return d.r.Cmp(o.r) <= 0 }

// roundRat rounds r to dp decimal places, half away from zero.
func roundRat(r *big.Rat, dp int) *big.Rat {
	scale := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(dp)), nil)
	scaled := new(big.Rat).Mul(r, new(big.Rat).SetInt(scale))
	num := scaled.Num()   // sign matches the value
	den := scaled.Denom() // always > 0
	q := new(big.Int).Quo(num, den)
	rem := new(big.Int).Rem(num, den)
	if rem.Sign() != 0 {
		// Compare 2*|rem| against den: >= means the fraction is >= 0.5, so round
		// the truncated quotient away from zero.
		twiceRem := new(big.Int).Abs(rem)
		twiceRem.Lsh(twiceRem, 1)
		if twiceRem.Cmp(den) >= 0 {
			if num.Sign() >= 0 {
				q.Add(q, big.NewInt(1))
			} else {
				q.Sub(q, big.NewInt(1))
			}
		}
	}
	return new(big.Rat).SetFrac(q, scale)
}

// text renders d as a plain decimal string. Every value the router produces is a
// terminating decimal (divisions round to a power-of-ten denominator; +,-,* keep
// that property), so this is exact — no display rounding is imposed on top of the
// bignumber.js-faithful math.
func (d dec) text() string {
	if d.r.Sign() == 0 {
		return "0"
	}
	den := new(big.Int).Set(d.r.Denom())
	twos := factorOut(den, big.NewInt(2))
	fives := factorOut(den, big.NewInt(5))
	if den.Cmp(big.NewInt(1)) != 0 {
		// Not a terminating decimal — unexpected for router outputs, but format at
		// a high fixed precision instead of looping forever.
		return trimTrailingZeros(d.r.FloatString(50))
	}
	dp := twos
	if fives > dp {
		dp = fives
	}
	return trimTrailingZeros(d.r.FloatString(dp))
}

// factorOut divides n in place by p as many times as p divides evenly, returning
// the count. Used to find how many decimal places a terminating rational needs.
func factorOut(n, p *big.Int) int {
	count := 0
	quo := new(big.Int)
	rem := new(big.Int)
	for n.Sign() != 0 {
		quo.QuoRem(n, p, rem)
		if rem.Sign() != 0 {
			break
		}
		n.Set(quo)
		count++
	}
	return count
}

func trimTrailingZeros(s string) string {
	if !strings.Contains(s, ".") {
		return s
	}
	s = strings.TrimRight(s, "0")
	return strings.TrimRight(s, ".")
}
