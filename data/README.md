# MCR mock dataset

Deterministic seed: 20261002

Generated:
- 120 players;
- 12 seasons, 2015–2026;
- 36 tournaments total;
- 2–4 tournaments per year;
- one major tournament of 80–112 participants every year;
- smaller regional tournaments of 16–64 participants;
- players skip tournaments with individual activity propensities;
- results use a latent skill + yearly form + tournament noise model;
- player skill slowly evolves across seasons.

## Files

### App-ready
- `players.csv`
- `results.csv`

These can be loaded directly by the current Streamlit MVP.

### Normalized / future API model
- `players_api.csv`
- `tournaments_api.csv`
- `results_api.csv`

These reflect the future PostgreSQL/API split:
`players` → `tournaments` → `results`.

### Diagnostic mock source
- `players_mock.csv` contains synthetic latent skill/activity fields.
- `tournaments_mock.csv` contains tier/location metadata.
- `results_mock.csv` is the full denormalized event result table.

Synthetic helper fields beginning with `mock_` should NOT go into the production rating API.
