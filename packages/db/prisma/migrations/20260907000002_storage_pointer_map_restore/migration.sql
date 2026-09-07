CREATE OR REPLACE FUNCTION "storage_pointer_map_valid"(pointer_map JSONB)
RETURNS BOOLEAN
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN jsonb_typeof(pointer_map) IS DISTINCT FROM 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1
      FROM jsonb_each(pointer_map) AS entry
      WHERE NOT "public"."storage_pointer_valid"(entry.value)
    )
  END;
$$;
