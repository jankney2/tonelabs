// Lawllama contacts carry sensitive data we have no use for (matching uses phone, email, name).
// These fields are removed before anything leaves the service class, so they are never landed in the
// database, logged, or printed by the probe.
export const REDACTED_CONTACT_FIELDS = ['ssn', 'date_of_birth', 'immigration_status'];

/** Returns a copy of a JSON:API contact resource without the sensitive attributes. Other resources pass through. */
export function redactContact(resource) {
  if (resource?.type !== 'contacts' || !resource.attributes) return resource;
  const attributes = { ...resource.attributes };
  for (const f of REDACTED_CONTACT_FIELDS) delete attributes[f];
  return { ...resource, attributes };
}

/** Redact every contact in a response body: `data` (single or list) and `included`. */
export function redactBody(body) {
  if (!body || typeof body !== 'object') return body;
  const out = { ...body };
  if (Array.isArray(out.data)) out.data = out.data.map(redactContact);
  else if (out.data) out.data = redactContact(out.data);
  if (Array.isArray(out.included)) out.included = out.included.map(redactContact);
  return out;
}
