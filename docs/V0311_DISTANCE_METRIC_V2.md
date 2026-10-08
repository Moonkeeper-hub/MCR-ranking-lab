# v0.31.1 — ranking-distance metric revision 2

This patch is based on v0.31.0. The separate, unaccepted Double Strike experiment is **not included**.

Changed only the ranking-distance analysis and its explanatory UI/export labels. Rating engines are unchanged.

## Rule

- First ranked position = baseline personal best; no observation.
- Before #1: record only strict personal-best improvements.
- At first #1: record the improvement that reaches #1 (unless the player starts at #1, in which case #1 is only the initial anchor).
- After #1: record distance between every later return to #1.
- At the end: if #1 had been reached and there is an unfinished interval, record its residual distance as a censored #1 observation.
- If #1 was never reached, do not add a trailing non-improvement interval.

The old method-specific decay horizon is no longer part of observation construction.
