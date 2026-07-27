ALTER TABLE `DemandCreditEntry`
  ADD CONSTRAINT `ck_dce_attribution_event_identity`
  CHECK (`kind` <> 'ATTRIBUTION' OR `eventIdentity` IS NOT NULL);
