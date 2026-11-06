BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.traffic_links) OR EXISTS (SELECT 1 FROM auth.traffic_acquisition_daily) THEN
    RAISE EXCEPTION 'Exportar campañas y métricas antes de revertir 0126; no se borran datos automáticamente';
  END IF;
END $$;
DROP TABLE auth.traffic_acquisition_receipts, auth.traffic_acquisition_visitors,
  auth.traffic_acquisition_daily, auth.traffic_links;
COMMIT;
