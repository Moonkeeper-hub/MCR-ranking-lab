# v0.31.2 — polynomial trend for the ranking-distance metric

Patrick clarification: each histogram series is supplemented with one global least-squares polynomial trend, degree no higher than 3.

Implementation:

- X is the midpoint of the rank bin.
- Y is the displayed histogram metric (`meanTournaments` or `normalizedByAllTournaments`).
- The fit uses every non-empty bin in the selected Top-N range; empty bins are missing observations, not zero-valued measurements.
- One polynomial is fitted globally to the whole available series using ordinary least squares (OLS / МНК); there is no piecewise fitting.
- User can select degree 1, 2 or 3; default is 3.
- If there are not enough distinct points, degree is automatically reduced.
- The fitted polynomial is evaluated across the full rank domain 1..Top-N, so gaps and edge sections are extrapolated by the same global curve.
- Negative fitted values are clipped to zero only when drawing the SVG because tournament distance cannot be negative. Raw polynomial predictions remain available in CSV.
- The chart displays the effective polynomial degree and R².
- CSV export includes midpoint, fitted value, effective degree and R² for both histogram series.

The ranking-distance observation algorithm itself is unchanged from revision 2.
