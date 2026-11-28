const Tenant = require('../models/Tenant');

/** The shop that should keep live texts and clock punches when two tenants share a number. */
async function preferredShopTenantId() {
  const slug = String(process.env.TWILIO_INBOUND_TENANT_SLUG || '').trim();
  if (slug) {
    const tenant = await Tenant.findOne({ slug: slug.toLowerCase() }).select('_id').setOptions({ bypassTenant: true }).lean();
    if (tenant?._id) return String(tenant._id);
  }
  const envId = String(process.env.TWILIO_INBOUND_TENANT_ID || '').trim();
  if (/^[a-fA-F0-9]{24}$/.test(envId)) return envId;
  const fallback = await Tenant.findOne({ slug: 'default' }).select('_id').setOptions({ bypassTenant: true }).lean();
  return fallback?._id ? String(fallback._id) : '';
}

function pickPreferredTenantId(ids, preferred) {
  const list = [...new Set((ids || []).map((id) => String(id || '')).filter(Boolean))];
  if (!list.length) return '';
  if (preferred && list.includes(String(preferred))) return String(preferred);
  return list[0];
}

module.exports = {
  preferredShopTenantId,
  pickPreferredTenantId,
};
