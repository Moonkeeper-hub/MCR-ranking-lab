# Prediction Benchmark

Prediction Benchmark compares rating methods out of sample.

For each tournament the lab uses the ranking snapshot that existed **before** that tournament. The tournament result is then treated as unseen test data. Historical ratings are never rebuilt using the tested event before scoring it.

## Metrics

### Pairwise accuracy
For every pair of participants for whom the method had distinct pre-tournament ratings, the higher-rated player is predicted to finish higher. Accuracy is the fraction of correctly ordered pairs.

### Pair coverage
Not every method ranks every newcomer before an event. Pair coverage is the share of all possible participant pairs for which the method produced a usable prediction. Tied ratings are treated as no prediction.

### Player coverage
Share of tournament participations for which a pre-event rating existed.

### Mean Spearman
For each tournament, Spearman rank correlation is calculated between pre-event rating order and final place among rated participants. The displayed value is the arithmetic mean across scored tournaments. Positive values are better because both orders are oriented best-to-worst.

### Latent rho
If `results.csv` contains `latent_elo_at_event`, the benchmark additionally measures Spearman correlation between pre-event rating order and the synthetic ground-truth strength. This column is intended for mock datasets only and must never be consumed by a rating engine itself.

## Recommended synthetic protocol

- 2023: burn-in;
- 2024-2025: development / parameter tuning;
- 2026: untouched holdout.

Use `historyInitialMode=clean` when all methods are supposed to start without imported MCR information.

## Interpretation

Do not compare pairwise accuracy without coverage. A method can obtain deceptively good accuracy by rating only established players and refusing to make predictions for newcomers.

The event-level CSV export is intended for later statistical analysis, bootstrap confidence intervals and paired method comparisons on the same tournaments.
