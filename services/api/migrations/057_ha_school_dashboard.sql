-- Home Assistant school-week sharing is independent from generic calendar/message audiences.
-- Both the approved source and its person must be selected; empty arrays are default-deny.
ALTER TABLE integration_ha_sharing
  ADD COLUMN school_person_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN school_source_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT integration_ha_school_people_size_check CHECK(cardinality(school_person_ids)<=50),
  ADD CONSTRAINT integration_ha_school_sources_size_check CHECK(cardinality(school_source_ids)<=50);
