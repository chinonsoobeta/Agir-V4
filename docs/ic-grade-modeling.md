# IC-Grade Modeling Extensions

Workstream 1 adds optional equity timing, mezzanine debt, and a deterministic
LP/GP distribution waterfall. All three extensions are additive and disabled by
default. A deal without the new approved inputs keeps the legacy calculation
path.

## Modeling conventions

### Equity draw timing

The legacy convention remains an upfront equity contribution at time zero.
Setting `phase_equity_draws` to `1` changes only the return timing convention:
the same total equity is drawn in equal monthly amounts over
`construction_months`. Equity multiple is unchanged because it is timing-free.
IRR uses the timed monthly contributions.

### Mezzanine debt

The existing debt terms remain the senior tranche. A mezzanine tranche is
created only when `mezzanine_amount` is greater than zero. If an amount is
approved without an approved mezzanine rate, readiness fails closed.

Interest reserve, total debt, loan payoff, LTC, required equity, annual debt
service, debt yield, and all-in DSCR include both tranches. Senior DSCR remains
available separately.

### LP/GP waterfall

The waterfall is European and runs over the complete timed levered equity cash
flow:

1. Return LP and GP contributed capital pro rata.
2. Pay the accrued LP preferred return.
3. Pay an optional GP catch-up.
4. Split residual cash through one or two promote tiers.

Preferred return compounds between cash-flow dates on outstanding LP capital
and unpaid preferred return. A second promote tier begins after the LP reaches
its configured IRR hurdle.

GP promote is the GP profit distribution above the GP's pro-rata share of total
deal profit. When waterfall inputs are absent, LP IRR and equity multiple equal
the deal-level returns, while GP promote and GP equity multiple are zero.

## New assumption keys

| Taxonomy key | Engine key | Unit | Default |
| --- | --- | --- | --- |
| `phase_equity_draws` | `phase_equity_draws` | count | `0`, upfront equity |
| `mezzanine_amount` | `mezzanine_amount` | $ | `0`, no mezzanine |
| `mezzanine_interest_rate` | `mezz_interest_rate_pct` | % | Required when mezzanine amount is positive |
| `mezzanine_amortization_years` | `mezz_amort_years` | yr | `0`, interest-only |
| `mezzanine_io_months` | `mezz_io_months` | mo | `0` |
| `lp_equity_split` | `lp_equity_split_pct` | % | `100`, LP equals deal |
| `preferred_return` | `preferred_return_pct` | % | `0` |
| `gp_catch_up` | `gp_catch_up` | count | `0`, disabled |
| `promote_tier_1_hurdle` | `promote_tier_1_hurdle_pct` | % | `0` |
| `promote_tier_1_gp_split` | `promote_tier_1_gp_split_pct` | % | `0`, no tier |
| `promote_tier_2_hurdle` | `promote_tier_2_hurdle_pct` | % | `0` |
| `promote_tier_2_gp_split` | `promote_tier_2_gp_split_pct` | % | `0`, no tier |

## New persisted outputs

Every output is emitted by the deterministic engine with readable formula text
and is persisted through the existing `financial_outputs` write path:

- `senior_annual_debt_service`
- `senior_dscr`
- `lp_irr`
- `lp_equity_multiple`
- `gp_irr`
- `gp_equity_multiple`
- `gp_promote`

The existing `annual_debt_service` and `dscr` outputs become all-in values when
mezzanine debt is present. With no mezzanine tranche, they are identical to the
legacy senior-only values.
