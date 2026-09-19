// Plain env-var-backed feature flags. Suppliers is a real planned feature,
// intentionally not built yet — this flag is the single on/off switch for
// it everywhere (nav visibility, the /suppliers route). Flip it on by
// setting REACT_APP_SUPPLIERS_ENABLED=true wherever the real feature ships.
export const SUPPLIERS_ENABLED = process.env.REACT_APP_SUPPLIERS_ENABLED === 'true';
