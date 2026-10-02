CREATE TABLE players (
    player_id text PRIMARY KEY,
    player_name text NOT NULL,
    initial_eu integer NOT NULL DEFAULT 0,
    initial_marks smallint NOT NULL DEFAULT 0,
    initial_dan_date date
);

CREATE TABLE tournaments (
    tournament_id text PRIMARY KEY,
    tournament_name text NOT NULL,
    tournament_date date NOT NULL,
    tournament_order integer NOT NULL,
    participants integer NOT NULL CHECK (participants > 1),
    sessions integer NOT NULL CHECK (sessions > 0),
    is_world_europe boolean NOT NULL DEFAULT false,
    tournament_tier text,
    location text
);

CREATE TABLE tournament_results (
    tournament_id text NOT NULL REFERENCES tournaments(tournament_id) ON DELETE RESTRICT,
    player_id text NOT NULL REFERENCES players(player_id) ON DELETE RESTRICT,
    place integer NOT NULL CHECK (place > 0),
    PRIMARY KEY (tournament_id, player_id),
    UNIQUE (tournament_id, place)
);

CREATE TABLE ref_legacy_level (
    eu integer PRIMARY KEY,
    level_kind text NOT NULL CHECK (level_kind IN ('kyu','dan')),
    ordinal integer NOT NULL,
    label text NOT NULL UNIQUE
);

CREATE TABLE ref_legacy_kt_participants (
    participants integer PRIMARY KEY,
    kt_component numeric(5,2) NOT NULL
);

CREATE TABLE ref_legacy_age_weight (
    min_months integer PRIMARY KEY,
    max_months integer,
    weight numeric(4,2) NOT NULL,
    CHECK (max_months IS NULL OR max_months >= min_months)
);

CREATE TABLE ref_legacy_tournament_status (
    status_code text PRIMARY KEY,
    kt_bonus numeric(4,2) NOT NULL
);

CREATE TABLE ref_legacy_constant (
    constant_code text PRIMARY KEY,
    numeric_value numeric NOT NULL,
    description text NOT NULL
);

CREATE OR REPLACE FUNCTION forbid_legacy_reference_mutation()
RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'Legacy reference table % is immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER no_update_ref_legacy_level
BEFORE UPDATE OR DELETE ON ref_legacy_level
FOR EACH ROW EXECUTE FUNCTION forbid_legacy_reference_mutation();

CREATE TRIGGER no_update_ref_legacy_kt_participants
BEFORE UPDATE OR DELETE ON ref_legacy_kt_participants
FOR EACH ROW EXECUTE FUNCTION forbid_legacy_reference_mutation();

CREATE TRIGGER no_update_ref_legacy_age_weight
BEFORE UPDATE OR DELETE ON ref_legacy_age_weight
FOR EACH ROW EXECUTE FUNCTION forbid_legacy_reference_mutation();

CREATE TRIGGER no_update_ref_legacy_tournament_status
BEFORE UPDATE OR DELETE ON ref_legacy_tournament_status
FOR EACH ROW EXECUTE FUNCTION forbid_legacy_reference_mutation();

CREATE TRIGGER no_update_ref_legacy_constant
BEFORE UPDATE OR DELETE ON ref_legacy_constant
FOR EACH ROW EXECUTE FUNCTION forbid_legacy_reference_mutation();
