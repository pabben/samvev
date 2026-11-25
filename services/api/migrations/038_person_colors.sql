ALTER TABLE persons ADD COLUMN color_token text;

WITH ordered AS (
  SELECT id, ((row_number() OVER (PARTITION BY household_id ORDER BY created_at,id)-1) % 12)::integer AS palette_index
  FROM persons
)
UPDATE persons person
SET color_token = (ARRAY['teal','blue','violet','rose','amber','green','coral','orange','lime','cyan','sky','indigo'])[ordered.palette_index+1]
FROM ordered
WHERE ordered.id=person.id;

ALTER TABLE persons ALTER COLUMN color_token SET NOT NULL;
ALTER TABLE persons ADD CONSTRAINT persons_color_token_check CHECK (color_token IN ('teal','blue','violet','rose','amber','green','coral','orange','lime','cyan','sky','indigo'));

CREATE FUNCTION assign_person_color_before_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.color_token IS NULL THEN
    PERFORM 1 FROM households WHERE id=NEW.household_id FOR UPDATE;
    SELECT palette.token INTO NEW.color_token
    FROM unnest(ARRAY['teal','blue','violet','rose','amber','green','coral','orange','lime','cyan','sky','indigo']::text[]) WITH ORDINALITY AS palette(token,palette_order)
    LEFT JOIN (
      SELECT color_token,count(*) AS usage_count FROM persons WHERE household_id=NEW.household_id GROUP BY color_token
    ) used ON used.color_token=palette.token
    ORDER BY COALESCE(used.usage_count,0),palette.palette_order
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER persons_assign_color_before_insert
BEFORE INSERT ON persons FOR EACH ROW EXECUTE FUNCTION assign_person_color_before_insert();
