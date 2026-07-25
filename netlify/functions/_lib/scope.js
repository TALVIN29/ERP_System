/**
 * The values a list page may filter by, and offer in a create form.
 *
 * The pages read `data.scope` (see useCrudPage in src/components/crud.jsx) to
 * build their Region/Category dropdowns and their scope chip. The fixture
 * backend returned it and the real endpoints did not, so on live data every
 * filter dropdown rendered empty.
 *
 * A scoped user gets only their own values; an unscoped one gets everything,
 * derived from the data rather than hardcoded.
 */
export async function scopeOptions(supa, userId) {
  const [{ data: opts }, { data: profile }] = await Promise.all([
    supa.rpc('get_scope_options'),
    supa.from('profiles').select('scope_regions, scope_categories').eq('user_id', userId).single(),
  ]);

  const row = Array.isArray(opts) ? opts[0] : opts;
  const allRegions = row?.regions || [];
  const allCategories = row?.categories || [];

  // Empty scope array means "all" — the same rule RLS uses.
  const regions = profile?.scope_regions?.length ? profile.scope_regions : allRegions;
  const categories = profile?.scope_categories?.length ? profile.scope_categories : allCategories;

  return { regions, categories, allRegions, allCategories };
}
