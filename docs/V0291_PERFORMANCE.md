# v0.29.1 — performance patch

This patch changes calculation orchestration only. The mathematical algorithms in `legacy.ts`, `evolution.ts`, `simulation.ts`, `rr.ts`, and `rankingDistance.ts` are not modified.

## What is cached

The browser now memoizes final MCR and RR runs by:

- loaded dataset revision;
- evaluation date;
- complete method configuration;
- table/override configuration.

Changing an MCR laboratory coefficient therefore does not recalculate RR default, RR lab, or unchanged MCR default. The inverse applies to RR changes.

Full history is cached separately by method configuration and dataset. UI-only actions such as selecting a player, changing the visible history period, sorting tables, exporting CSV/SVG, or reopening a previously calculated method reuse the existing history.

The distance metric reuses the cached method history and has its own cache keyed by method, evaluation date, Top-N and rank step.

## Dataset indexes

Tournament events and their result rows are indexed once per loaded dataset. RR history still executes the same original RR algorithm at every historical snapshot, but no longer scans the complete results array to rediscover each tournament's rows.

## Memory limits

Caches are bounded LRU caches so repeated laboratory experiments do not retain an unlimited number of old calculation results.

## Invalidating caches

Loading a new pair of CSV files or the built-in demo dataset increments the dataset revision and invalidates all calculation/history/metric caches.

Changing only presentation state does not invalidate calculations.
