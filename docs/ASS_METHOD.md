# ASS — Arslan's Simplified Scoring

Experimental MCR rating method for the laboratory. The name is intentionally unserious; the implementation is deterministic and intended for comparison with Legacy MCR, Project MCR, RR, TrueSkill Tournament and Elo-PL.

## Core idea

The displayed rating combines two different signals:

\[
ASS = w_S S + w_A A, \qquad w_S+w_A=1.
\]

Default: `wS = 0.5`, `wA = 0.5`.

### 1. PL strength

Every tournament is one full Plackett–Luce ordering. Internal player strength is `mu`; all players in a tournament are updated simultaneously from the gradient of the full-order log-likelihood.

A player not previously known to the engine is **not** assigned zero strength. Before a tournament their `mu` is set to the median `mu` of already known participants in that tournament. If no participant is known, the global start value is used.

Confidence is deliberately simplified. `sigma` is a confidence proxy rather than an exact Bayesian posterior:

\[
\sigma = \frac{\sigma_0}{\sqrt{1+I}},
\]

where `I` accumulates with tournaments and can give somewhat more information to larger/longer events. Calendar inactivity does not increase `sigma`.

The conservative strength is `mu - k*sigma`, mapped to a fixed 0–1000 logistic scale:

\[
S = 1000\,\sigma_{log}\!\left(\frac{(\mu-k\sigma)-\mu_0}{d}\right).
\]

The fixed mapping avoids min/max normalization against the current player pool.

### 2. Tournament achievement

For tournament `i`:

\[
P_i = \left(\frac{N_i-p_i}{N_i-1}\right)^\alpha.
\]

`alpha > 1` gives more value to top finishes than to the same one-place movement in the middle of the table.

Field strength is measured from participant ratings **before** the tournament. The median field strength is mapped to a bounded multiplier `Q_i`; its influence can be reduced to zero from the laboratory controls.

\[
A_i = 1000\,P_i\,Q_i.
\]

Achievements decay exponentially:

\[
w_i = 2^{-t_i/H},
\]

where `H` is the half-life in months.

The achievement component is a decayed weighted mean with a neutral prior, not a cumulative sum:

\[
A = \frac{W_0A_0 + \sum_i w_iA_i}{W_0 + \sum_i w_i}.
\]

Therefore simply playing more tournaments does not automatically increase the rating, while very old results gradually lose influence and the achievement component drifts toward the prior.

## Default assumptions

- PL full-order update, not independent pair decomposition.
- Unknown player prior: median `mu` of known participants in the tournament.
- `sigma` measures accumulated confidence only; no calendar inflation.
- Calendar time acts only through achievement decay.
- Field strength multiplier is bounded and intentionally modest because PL already accounts for opponent strength.
- All major coefficients are exposed in the laboratory and should be treated as hypotheses until predictive validation.

## Validation target

The method must not be selected because it reproduces the current official ranking. Its main validation target is **out-of-sample predictive power**: calculate the ranking using only tournaments before date T, then evaluate how well that ranking predicts the order in the next tournament(s).

Recommended metrics for a later validation module:

- pairwise prediction accuracy;
- pairwise log-loss / Brier score after converting rating differences to win probabilities;
- Spearman correlation between pre-tournament rating and final place;
- calibration by predicted-probability bins;
- newcomer convergence speed on synthetic data with known latent skill;
- activity-bias test: equally strong players with different tournament counts should not systematically diverge;
- parameter sensitivity / rolling-origin cross-validation.
