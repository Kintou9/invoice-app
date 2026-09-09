// Guesses a human-readable supplier name from a product URL's domain, so a
// user pasting an Amazon/RepairClinic/etc. link doesn't also have to type
// the supplier name by hand. Returns null (never throws) when the URL is
// missing, malformed, or from an unrecognized domain — the caller falls
// back to whatever the user typed manually.
const SUPPLIER_DOMAINS = {
  'amazon.com': 'Amazon',
  'ebay.com': 'eBay',
  'repairclinic.com': 'RepairClinic',
  'marcone.com': 'Marcone',
  'encompass.com': 'Encompass Supply',
  'appliancepartspros.com': 'Appliance Parts Pros',
};

function autoDetectSupplier(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    for (const [domain, name] of Object.entries(SUPPLIER_DOMAINS)) {
      if (hostname === domain || hostname.endsWith(`.${domain}`)) return name;
    }
    return null;
  } catch {
    return null;
  }
}

module.exports = { autoDetectSupplier };
