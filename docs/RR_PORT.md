# RR engine port (v0.28)

`src/engine/rr.ts` is a browser-side TypeScript port of the supplied `RatingRRCalculation`.

Implemented source semantics:

- rolling two-year rating window;
- minimum two tournaments to enter RR;
- base rank from 1000 (first) to 0 (last);
- tournament coefficient = player-count component + session-count component;
- age weight: full during year 1, six two-month decay steps during year 2, then zero;
- P1: all tournaments through 5, then `5 + ceil(0.8 * (T - 5))`, with the subset chosen to maximize the weighted ratio;
- P1 missing-data denominator padding to five tournaments;
- P2: four best deltas divided by the four largest age-adjusted tournament coefficients in the rating window;
- final score `0.5 * P1 + 0.5 * P2`;
- players excluded from the displayed/internal rating are not ranked by RR, but still count in tournament participant totals.

The historical `HARDCODED_COEFFICIENTS` table is included as the default set of staged-tournament player overrides. The lab exposes them as `(tournament_id, player_id, coefficient)` rows and lets the user edit them. A matching hardcoded value replaces the ordinary tournament coefficient for that player. For the P2 global denominator candidate pool, staged tournaments contribute each distinct hardcoded coefficient, mirroring the Python source.

The separate tournament-type multiplier table is retained only as a laboratory experiment and defaults to `1.0`; it is not a substitute for the historical hardcoded table.

All RR coefficients exposed by the algorithm are editable in the browser: P1/P2 weights, tournament counts, additional-tournament share, player-count bands, session-count bands, caps, age decay, base-rank scale, hardcoded staged-tournament coefficients and experimental tournament-type multipliers.
