import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router-dom';
import { api, newIdempotencyKey } from '../../lib/api.js';
import { useApi } from '../../lib/useApi.js';
import { useAuth } from '../../lib/auth.jsx';
import { Button, Card, ConfirmDialog, DirtyStateBar, ErrorState, PageHeader, RefetchOverlay, Skeleton, cx } from '../../components/ui.jsx';
import { PermissionMatrix } from '../../components/admin.jsx';

export default function Roles() {
  const { perms } = useAuth();
  const { data, error, loading, refetch } = useApi('/admin-roles');
  const [grants, setGrants] = useState(null);
  const [dirty, setDirty] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (data?.grants) {
      setGrants(data.grants);
      setDirty(null);
    }
  }, [data]);

  const canUpdate = perms.can('roles', 'update');
  const denied = !canUpdate;

  const changeCount = dirty ? Object.keys(dirty).length : 0;

  // Data-router navigation guard: block in-app route changes while dirty.
  const blocker = useBlocker(() => changeCount > 0);

  // Tab close / refresh isn't a router navigation, so it needs its own guard.
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (changeCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [changeCount]);

  const handleChange = (roleKey, module, action) => {
    // Lockout cells never reach here — MatrixCell disables onChange itself
    // when toggling would strip the last roles.update grant.
    const perm = `${module}.${action}`;
    const currentGrants = dirty || data.grants;
    const rolePerms = [...(currentGrants[roleKey] || [])];
    const hasIt = rolePerms.includes(perm);

    if (hasIt) {
      rolePerms.splice(rolePerms.indexOf(perm), 1);
    } else {
      rolePerms.push(perm);
    }

    const next = { ...currentGrants, [roleKey]: rolePerms };
    setDirty(next);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await api('/admin-roles', {
        method: 'PUT',
        body: { grants: dirty },
        idempotencyKey: newIdempotencyKey(),
      });
      setGrants(result.grants);
      setDirty(null);
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDiscard = () => {
    setGrants(data.grants);
    setDirty(null);
    setSaveError(null);
  };

  if (!perms.can('roles', 'read')) {
    return (
      <Card className="p-8 text-center">
        <p className="text-[16px] font-semibold text-[var(--text-primary)]">
          You do not have access to permissions
        </p>
      </Card>
    );
  }

  if (error) {
    return (
      <ErrorState
        title="Could not load the permission matrix"
        detail={error.message}
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Permissions"
        scope={denied ? 'View only' : undefined}
      >
        <p className="text-[12px] text-[var(--text-secondary)]">
          Changes apply on each user's next load.
        </p>
      </PageHeader>

      {denied && (
        <Card className="p-4 border border-[var(--status-warning)] bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)]">
          <p className="text-[13px] text-[var(--text-primary)]">
            View only — you cannot change permissions
          </p>
        </Card>
      )}

      <RefetchOverlay active={!!data && loading}>
        <PermissionMatrix
          roles={data?.roles || []}
          grants={dirty || grants || {}}
          original={data?.grants}
          loading={loading && !data}
          denied={denied}
          onChange={handleChange}
        />
      </RefetchOverlay>

      <DirtyStateBar
        count={changeCount}
        onDiscard={handleDiscard}
        onSave={handleSave}
        saving={saving}
        error={saveError}
      />

      <ConfirmDialog
        open={blocker.state === 'blocked'}
        title="Leave without saving?"
        body="You have unsaved changes. Leaving now will discard them."
        confirmLabel="Leave"
        onConfirm={() => blocker.proceed?.()}
        onClose={() => blocker.reset?.()}
      />
    </div>
  );
}
