# v0.30 — TrueSkill Tournament and Elo-PL

This patch adds two tournament-order rating engines to the browser laboratory. Both engines consume the same normalized `players.csv + results.csv` dataset and treat the final tournament standings as the observation. No hand-by-hand data is reconstructed.

## TrueSkill Tournament

The implementation treats each tournament as one multiplayer free-for-all observation: each participant is a one-player team and `place` is used as the strict rank order. Ties are not expected in the tournament data. Since v0.30.1 the TrueSkill update is implemented locally in TypeScript with a dependency-free Gaussian factor graph; `ts-trueskill` and its transitive `mathjs` dependency are no longer required.

Canonical base parameters:

- `mu = 25`
- `sigma = 25 / 3`
- `beta = 25 / 6`
- `tau = 25 / 300`
- conservative leaderboard score `R = mu - 3 sigma`

The laboratory exposes multiplicative coefficients for `mu`, `sigma`, `beta`, `tau`, and leaderboard `k`. Coefficient `1` preserves the base value.

### Calendar tau / decay

Because the dataset contains tournaments rather than fixed match periods, the patch maps the dynamics parameter to calendar inactivity. Before a player's next tournament:

`σ_prior = sqrt(σ² + τ² * Δt_years)`

where `τ = (25/300) * tauCoef`. `tauCoef = 0` disables calendar uncertainty growth; the slider goes to `3`.

The TrueSkill environment itself is executed with per-observation `tau = 0`, avoiding double application of the dynamics factor.

### Tournament correction

A standard TrueSkill posterior is calculated first. A bounded tournament weight then scales the posterior step:

`mu' = mu + wT * (mu_TS - mu)`

`sigma' = sigma + wT * (sigma_TS - sigma)`

`wT = 1 + (cT/3) * ((cN/3 * sN + cH/3 * sH) / 2)`

where:

- `cT` — overall tournament correction coefficient;
- `cN` — participant-count coefficient;
- `cH` — session/hanchan coefficient;
- `sN = (N - Nmin) / N`, bounded to `0..1`;
- `sH = (H - 4) / H` for `H >= 4`, bounded to `0..1`.

Thus `cT = 0` gives an unmodified TrueSkill update (`wT = 1`). All correction coefficients use the laboratory range `0..3` and default to `1`.

## Elo-PL

Elo-PL uses a full Plackett-Luce likelihood for the complete order rather than decomposing the tournament into pairwise matches.

For finishing order `π`:

`P(π) = Π_i exp(r_{π_i}/s) / Σ_{j=i..N} exp(r_{π_j}/s)`

The implementation computes the simultaneous gradient of the log-likelihood with respect to the normalized utilities. For the player at position `j`:

`g_j = 1 - Σ_{i<=j} exp(r_j/s) / Σ_{k>=i} exp(r_k/s)`

and updates:

`r'_j = r_j + K_j * g_j`

Default internal start rating is `1500`. Default `PL scale` is `400 / ln(10)`, linking the exponential scale to the familiar Elo logistic scale.

### Editable K factors

`K_j = K0 * F_N * F_E * F_H`

- `K0`: base K, default `32`;
- `F_N`: participant-count modifier;
- `F_E`: player-experience modifier;
- `F_H`: session/hanchan modifier.

Each modifier has an independent coefficient `0..3`; zero disables that factor. The experience modifier decreases smoothly as the player's tournament count increases and exposes an editable half-life parameter.

## Display normalization

Elo-PL can display:

- raw internal scale (`Off`);
- min-max normalized `0–1000`;
- min-max normalized `0–3000`.

Normalization is display-only. Internal state, likelihood calculation, and future updates always use the raw Elo-PL rating.

## Eligibility and external players

Both methods accept any tournament with valid unique positive places and at least the configured minimum number of participants (default `4`).

Players with `include_in_rating=false` still participate in the tournament mathematics and influence all other players, but they are omitted from the displayed/internal ranking table.

## Comparison / history / presets

Both methods are integrated into:

- Laboratory method selector;
- interactive KaTeX formula + parameter inspector;
- local user presets;
- top comparison table;
- two-method historical comparison selector;
- two-worker calculation pool and cache;
- distance metric / histogram pipeline.

TrueSkill Tournament and Elo-PL have no hard result-expiry cutoff. For the v0.29 distance metric only, the comparison layer uses a neutral 24-month analytical horizon. This does not modify either rating engine.

## Dependency

v0.30.1 removes the external `ts-trueskill` dependency. After applying this patch to a checkout that previously installed v0.30.0, run `npm install` once so `package-lock.json` and `node_modules` drop `ts-trueskill` and transitive `mathjs`. Normal `npm ci` workflows can then resume.
