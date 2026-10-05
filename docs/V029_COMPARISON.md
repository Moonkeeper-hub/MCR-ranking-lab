# v0.29 — Comparison / ranking-distance metric

v0.29 implements the comparison metric proposed by the working group for studying how much tournament distance is required to occupy and later re-occupy a ranking position.

For each rating method the analysis uses that method's own zero-weight horizon (36 months for default MCR-2026, 24 months for default RR; presets use their configured value). For every ranked player the opening horizon produces a mandatory observation consisting of the number of the player's processed tournaments in that horizon and the best rank reached. After the opening horizon, each later return to the same or a better rank produces another observation. A better reached rank becomes the next target. The unfinished interval before the end of the history is included as the mandatory final observation.

The Comparison page groups observations by rank. `Top-N` controls the maximum position included and `step` groups positions from 1 to 10 places per bin.

Two histograms are rendered for every compared method:

1. `sum(tournaments to rank) / number of observations in the rank bin`;
2. `sum(tournaments to rank) / total processed tournaments of the method`.

All methods displayed together use a shared Y scale for the corresponding histogram, so visual comparison is not distorted by independent autoscaling.

Each method card can export the pair of histograms as a standalone SVG and the aggregated bin values as CSV.
