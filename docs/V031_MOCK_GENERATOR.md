# v0.31 — Mock data generator

Third workspace: synthetic player pool, tournament-template stack and reproducible history generation.

## Players

Player templates define latent ELO, participation probabilities, consistency, skill drift, active dates, internal-rating visibility and optional initial MCR state. A multiplier expands one template into many persistent players. Simulation-only fields are retained in generated `players.csv` and ignored by rating engines.

## Tournaments

Tournament templates define size, minimum field, sessions, seating mode (Random / Swiss / Seeded→Swiss), internal/external scope, status quota, quota method, reserved substitutes, frequency/calendar, skill weight and tournament randomness. A multiplier creates several parallel series of the same template.

Reserved substitute seats are filled before the regular player-selection stage. For external tournaments only quota-qualified `include_in_rating=true` players may enter from the internal pool. All non-quota regular seats are drawn from `include_in_rating=false` players; if the foreign pool is insufficient, one-use substitutes fill the remaining seats.

## History simulation

`Generate history` requires at least one player template and one tournament template. Generation is deterministic for identical templates/config and seed.

Players can participate only while the tournament date lies inside their `active_from` / `active_to` interval. After `active_to` they remain in the generated player file and therefore remain available to rating engines for inactivity/decay behavior.

Tournament results are simulated round by round. Per-table performance uses current latent ELO (including drift), player consistency, tournament randomness and session count. Tournament places are derived from cumulative table points, raw performance and average placement as deterministic tie-breakers.

The default quota selector is a neutral synthetic rating: normalized tournament place (0..1000) updated by EMA with configurable alpha. It uses only prior generated results and never reads latent ELO. Default MCR-2026, RR, TrueSkill Tournament and Elo-PL are also available as quota selectors.

Exports: `players_mock.csv`, `results_mock.csv`, `mock_manifest.json`. `Use in Rating Lab` loads the generated dataset directly into Comparison without a download/re-upload cycle.
