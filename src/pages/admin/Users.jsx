import { useEffect, useState } from 'react';
import { api, newIdempotencyKey } from '../../lib/api.js';
import { useApi, useDebounced } from '../../lib/useApi.js';
import { useAuth } from '../../lib/auth.jsx';
import { scopeLabel } from '../../lib/perms.js';
import { Button, Card, DataTable, Drawer, ErrorState, Field, InlineError, PageHeader, RelativeTime, Spinner, TextField, Select } from '../../components/ui.jsx';
import { RoleSelect, ScopeMultiSelect, ScopePreview } from '../../components/admin.jsx';

export default function Users() {
  const auth = useAuth();
  const { perms, profile } = auth;
  const { data, error, loading, refetch } = useApi('/admin-users');
  const [drawer, setDrawer] = useState(false);
  const [selected, setSelected] = useState(null);
  const [role, setRole] = useState('');
  const [regions, setRegions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [scopeError, setScopeError] = useState(null);

  const debouncedRegions = useDebounced(regions, 200);
  const debouncedCategories = useDebounced(categories, 200);

  const { data: scopeData, loading: scopeLoading } = useApi(
    '/scope-preview',
    debouncedRegions.length || debouncedCategories.length
      ? {
          region: debouncedRegions,
          category: debouncedCategories,
        }
      : null,
    { skip: !selected }
  );

  const handleOpenEdit = (user) => {
    setSelected(user);
    setRole(user.role);
    setRegions([...user.scope_regions]);
    setCategories([...user.scope_categories]);
    setSaveError(null);
    setScopeError(null);
    setDrawer(true);
  };

  const handleClose = () => {
    setDrawer(false);
    setSelected(null);
  };

  const handleSave = async () => {
    const isSelfDowngrade =
      selected.user_id === profile.user_id &&
      role !== profile.role_key &&
      perms.can('roles', 'update');

    if (isSelfDowngrade) {
      const confirm = window.confirm(
        'This will remove your own admin access. You will need another admin to restore it.'
      );
      if (!confirm) return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      await api('/admin-users', {
        method: 'PATCH',
        body: {
          user_id: selected.user_id,
          role,
          scope_regions: regions,
          scope_categories: categories,
        },
        idempotencyKey: newIdempotencyKey(),
      });
      refetch();
      handleClose();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!perms.can('users', 'read')) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[16px] font-semibold text-[var(--text-primary)]">
          You do not have access to users
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load users"
        detail={error.message}
        onRetry={refetch}
      />
    );
  }

  const users = data?.users || [];
  const availableRoles = data?.roles || [];
  const availableRegions = data?.regions || [];
  const availableCategories = data?.categories || [];

  const columns = [
    { key: 'full_name', label: 'Name', sortable: true },
    { key: 'email', label: 'Email' },
    { key: 'role', label: 'Role', render: (u) => availableRoles.find((r) => r.key === u.role)?.name || u.role },
    {
      key: 'scope',
      label: 'Scope',
      render: (u) => (
        <span className="text-[12px]">
          {scopeLabel(u.scope_regions, 'All regions')}
          {u.scope_categories.length > 0 && ` · ${scopeLabel(u.scope_categories)}`}
        </span>
      ),
    },
    { key: 'last_seen', label: 'Active', render: (u) => <RelativeTime value={u.last_seen} /> },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Users"
        count={users.length}
      />

      <DataTable
        columns={columns}
        rows={users}
        rowKey={(u) => u.user_id}
        loading={loading}
        empty={
          <div className="text-center py-8">
            <p className="text-[14px] text-[var(--text-secondary)]">No other users yet</p>
          </div>
        }
        actions={perms.can('users', 'update') ? (u) => (
          <Button
            variant="ghost"
            onClick={() => handleOpenEdit(u)}
            className="text-[12px] px-2 py-1"
          >
            Edit
          </Button>
        ) : undefined}
      />

      <Drawer
        open={drawer}
        title={selected?.full_name}
        subtitle={selected?.email}
        onClose={handleClose}
        footer={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose}>Cancel</Button>
            <Button
              variant="primary"
              loading={saving}
              onClick={handleSave}
            >
              Save changes
            </Button>
          </div>
        }
      >
        {selected && (
          <div className="space-y-4">
            <RoleSelect
              value={role}
              onChange={setRole}
              options={availableRoles}
            />

            <ScopeMultiSelect
              label="Regions"
              values={regions}
              onChange={setRegions}
              options={availableRegions}
              hint="Leave empty for access to all regions"
            />

            <ScopeMultiSelect
              label="Categories"
              values={categories}
              onChange={setCategories}
              options={availableCategories}
              hint="Leave empty for access to all categories"
            />

            <ScopePreview
              regions={regions}
              categories={categories}
              matched={scopeData?.matched || 0}
              total={scopeData?.total || 0}
              loading={scopeLoading}
            />

            {saveError && <InlineError>{saveError}</InlineError>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
