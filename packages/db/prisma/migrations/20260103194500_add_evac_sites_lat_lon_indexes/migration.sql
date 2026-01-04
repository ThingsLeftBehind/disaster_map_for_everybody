DO $$
DECLARE
  table_schema text;
  table_name text;
  lat_col text;
  lon_col text;
BEGIN
  SELECT n.nspname, c.relname
  INTO table_schema, table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.relname IN ('evac_sites', 'EvacSite', 'evacsite', 'evac_site', 'evacSites')
    AND c.relkind IN ('r', 'p', 'm')
  ORDER BY (c.relname = 'evac_sites') DESC, (n.nspname = 'public') DESC
  LIMIT 1;

  IF table_name IS NULL THEN
    RAISE NOTICE 'evac sites table not found';
    RETURN;
  END IF;

  SELECT column_name
  INTO lat_col
  FROM information_schema.columns
  WHERE table_schema = table_schema
    AND table_name = table_name
    AND lower(column_name) IN ('latitude', 'lat', 'ido', 'y', 'lat_deg', 'y_deg', 'lat_e7', 'lat_e6')
  ORDER BY CASE WHEN lower(column_name) = 'lat' THEN 0 ELSE 1 END
  LIMIT 1;

  SELECT column_name
  INTO lon_col
  FROM information_schema.columns
  WHERE table_schema = table_schema
    AND table_name = table_name
    AND lower(column_name) IN ('longitude', 'lon', 'lng', 'keido', 'x', 'lon_deg', 'x_deg', 'lon_e7', 'lon_e6')
  ORDER BY CASE WHEN lower(column_name) IN ('lon', 'lng') THEN 0 ELSE 1 END
  LIMIT 1;

  IF lat_col IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I)', table_name || '_lat_idx', table_schema, table_name, lat_col);
  END IF;
  IF lon_col IS NOT NULL THEN
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I)', table_name || '_lon_idx', table_schema, table_name, lon_col);
  END IF;
  IF lat_col IS NOT NULL AND lon_col IS NOT NULL THEN
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I.%I (%I, %I)',
      table_name || '_lat_lon_idx',
      table_schema,
      table_name,
      lat_col,
      lon_col
    );
  END IF;
END $$;
