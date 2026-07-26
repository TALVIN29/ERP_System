import { useEffect, useState } from 'react';
import { api, newIdempotencyKey } from '../lib/api.js';
import { useApi, useDebounced } from '../lib/useApi.js';
import { useAuth } from '../lib/auth.jsx';
import { Button, Card, cx, DirtyStateBar, ErrorState, Field, InlineError, PageHeader, SegmentedControl, Select, Spinner, TextField, fmtCurrency } from '../components/ui.jsx';
import { SettingsCard, ThresholdPreview } from '../components/admin.jsx';

export default function Settings() {
  const { perms, theme, setTheme } = useAuth();
  const { data, error, loading, refetch } = useApi('/settings');

  const [orgSaving, setOrgSaving] = useState(false);
  const [orgError, setOrgError] = useState(null);

  const [orgName, setOrgName] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [fiscalYearStart, setFiscalYearStart] = useState('01-01');
  const [discountAlert, setDiscountAlert] = useState(0.2);
  const [minLoss, setMinLoss] = useState(1000);

  const debouncedDiscountAlert = useDebounced(discountAlert, 500);
  const { data: thresholdData, loading: thresholdLoading } = useApi(
    '/threshold-preview',
    { discount_alert: debouncedDiscountAlert }
  );

  const [defaultPage, setDefaultPage] = useState('dashboard');
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [prefError, setPrefError] = useState(null);
  // Quiet per-control "Saved" flash: fades out on its own, no error path needed.
  const [prefSaved, setPrefSaved] = useState(null);

  useEffect(() => {
    if (data?.org) {
      setOrgName(data.org.org_name || '');
      setCurrency(data.org.currency || 'USD');
      setFiscalYearStart(data.org.fiscal_year_start || '01-01');
      setDiscountAlert(data.org.discount_alert || 0.2);
      setMinLoss(data.org.min_loss || 1000);
      setOrgError(null);
    }
    if (data?.user) {
      setDefaultPage(data.user.default_page || 'dashboard');
      setRowsPerPage(data.user.rows_per_page || 25);
    }
  }, [data]);

  const canEditOrg = data?.canEditOrg;

  const orgChanged =
    orgName !== data?.org?.org_name ||
    currency !== data?.org?.currency ||
    fiscalYearStart !== data?.org?.fiscal_year_start ||
    discountAlert !== data?.org?.discount_alert ||
    minLoss !== data?.org?.min_loss;

  const handleSaveOrg = async () => {
    setOrgSaving(true);
    setOrgError(null);
    try {
      await api('/settings', {
        method: 'PUT',
        body: {
          org: {
            org_name: orgName,
            currency,
            fiscal_year_start: fiscalYearStart,
            discount_alert: discountAlert,
            min_loss: minLoss,
          },
        },
        idempotencyKey: newIdempotencyKey(),
      });
      refetch();
    } catch (err) {
      setOrgError(err.message);
    } finally {
      setOrgSaving(false);
    }
  };

  const handleDiscardOrg = () => {
    setOrgName(data?.org?.org_name || '');
    setCurrency(data?.org?.currency || 'USD');
    setFiscalYearStart(data?.org?.fiscal_year_start || '01-01');
    setDiscountAlert(data?.org?.discount_alert || 0.2);
    setMinLoss(data?.org?.min_loss || 1000);
    setOrgError(null);
  };

  const handleChangePref = async (key, value) => {
    const newValue = { [key]: value };
    if (key === 'default_page') setDefaultPage(value);
    if (key === 'rows_per_page') setRowsPerPage(value);

    setPrefError(null);
    try {
      await api('/settings', {
        method: 'PUT',
        body: { user: newValue },
        idempotencyKey: newIdempotencyKey(),
      });
      const id = Date.now();
      setPrefSaved({ key, id, fading: false });
      setTimeout(() => setPrefSaved((s) => (s?.id === id ? { ...s, fading: true } : s)), 900);
      setTimeout(() => setPrefSaved((s) => (s?.id === id ? null : s)), 1500);
    } catch (err) {
      setPrefError(key);
      if (key === 'default_page') setDefaultPage(data?.user?.default_page || 'dashboard');
      if (key === 'rows_per_page') setRowsPerPage(data?.user?.rows_per_page || 25);
    }
  };

  if (!perms.can('settings', 'read')) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[16px] font-semibold text-[var(--text-primary)]">
          You do not have access to settings
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load settings"
        detail={error.message}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Settings" />

      <SettingsCard
        title="Preferences"
        description="Applies to you"
      >
        <div className="space-y-4">
          <div>
            <label className="text-[12px] font-medium text-[var(--text-secondary)] mb-1.5 block">
              Theme
            </label>
            <SegmentedControl
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
              name="theme"
            />
          </div>

          <div>
            <label htmlFor="default-page" className="text-[12px] font-medium text-[var(--text-secondary)] block mb-1.5">
              Default page
            </label>
            <select
              id="default-page"
              value={defaultPage}
              onChange={(e) => handleChangePref('default_page', e.target.value)}
              className="h-9 w-full px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px] text-[var(--text-primary)]"
            >
              <option value="dashboard">Dashboard</option>
              <option value="orders">Orders</option>
              <option value="products">Products</option>
              <option value="customers">Customers</option>
            </select>
            {prefError === 'default_page' && (
              <InlineError>Failed to save. Try again.</InlineError>
            )}
            {prefSaved?.key === 'default_page' && (
              <span className={cx(
                'text-[11px] text-[var(--status-good)] transition-opacity duration-500',
                prefSaved.fading ? 'opacity-0' : 'opacity-100'
              )}>
                Saved
              </span>
            )}
          </div>

          <div>
            <label htmlFor="rows-per-page" className="text-[12px] font-medium text-[var(--text-secondary)] block mb-1.5">
              Rows per page
            </label>
            <select
              id="rows-per-page"
              value={rowsPerPage}
              onChange={(e) => handleChangePref('rows_per_page', Number(e.target.value))}
              className="h-9 w-full px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px] text-[var(--text-primary)]"
            >
              {[10, 25, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            {prefError === 'rows_per_page' && (
              <InlineError>Failed to save. Try again.</InlineError>
            )}
            {prefSaved?.key === 'rows_per_page' && (
              <span className={cx(
                'text-[11px] text-[var(--status-good)] transition-opacity duration-500',
                prefSaved.fading ? 'opacity-0' : 'opacity-100'
              )}>
                Saved
              </span>
            )}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard
        title="Organisation"
        description={canEditOrg ? undefined : 'Requires the settings.update permission'}
      >
        <div className="space-y-4">
          <TextField
            label="Organisation name"
            value={orgName}
            onChange={(e) => setOrgName(e.target.value)}
            disabled={!canEditOrg}
          />

          <div>
            <label htmlFor="currency" className="text-[12px] font-medium text-[var(--text-secondary)] block mb-1.5">
              Currency
            </label>
            <select
              id="currency"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={!canEditOrg}
              className="h-9 w-full px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px] text-[var(--text-primary)] disabled:opacity-60"
            >
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </select>
            <p className="text-[11px] text-[var(--text-muted)] mt-1">
              Display only — values are not converted.
            </p>
          </div>

          <TextField
            label="Fiscal year start"
            value={fiscalYearStart}
            onChange={(e) => setFiscalYearStart(e.target.value)}
            disabled={!canEditOrg}
            placeholder="MM-DD"
          />

          <div>
            <label htmlFor="discount-alert" className="text-[12px] font-medium text-[var(--text-secondary)] block mb-1.5">
              Discount alert at
            </label>
            <input
              id="discount-alert"
              type="number"
              step="0.01"
              min="0"
              max="1"
              value={discountAlert}
              onChange={(e) => setDiscountAlert(Number(e.target.value))}
              disabled={!canEditOrg}
              className="h-9 w-full px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px] text-[var(--text-primary)] disabled:opacity-60"
            />
            <ThresholdPreview
              value={discountAlert}
              total={thresholdData?.flagged || 0}
              loading={thresholdLoading}
            />
          </div>

          <TextField
            label="Minimum loss"
            type="number"
            value={minLoss}
            onChange={(e) => setMinLoss(Number(e.target.value))}
            disabled={!canEditOrg}
          />

          {!canEditOrg && (
            <p className="text-[12px] text-[var(--text-muted)]">
              Your role does not have the settings.update permission.
            </p>
          )}
        </div>
      </SettingsCard>

      {canEditOrg && orgChanged && (
        <DirtyStateBar
          count={1}
          onDiscard={handleDiscardOrg}
          onSave={handleSaveOrg}
          saving={orgSaving}
          error={orgError}
        />
      )}
    </div>
  );
}
