# Ranking-distance metric — revision 2

The metric follows Patrick’s clarified rule and no longer uses a decay horizon to create the first observation.

For each ranked player:

1. The first ranked position after a tournament played by that player establishes the initial personal best. It is an anchor only and does not create an observation.
2. Before the player reaches rank #1, a pair `(player tournaments; achieved rank)` is created only when the player strictly improves the previous personal best. The distance counts that player’s processed tournaments after the previous achievement, including the tournament that sets the new best.
3. The first achievement of rank #1 ends the improvement phase. From then on, the target remains #1. Each later return to #1 creates a repeat observation containing the tournament distance since the previous #1.
4. If the history ends after #1 without another return, the remaining tournament distance is stored as a censored trailing observation at rank #1.
5. If a player never reaches #1, no unfinished non-improvement interval is added at the end: before #1, observations exist strictly on personal-best improvements.

`Top-N` limits the achievements shown in the charts, and `step` groups ranking places from 1 to 10 positions per bin.

Two histograms are rendered for every compared method:

1. `sum(tournament distance) / number of observations in the rank bin`;
2. `sum(tournament distance) / total processed tournaments of the method`.

All methods displayed together use a shared Y scale for corresponding histograms. Each method card exports the histogram pair as SVG and aggregated bin values as CSV.
