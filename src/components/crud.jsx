import { useState, useCallback, useEffect } from 'react';
import {
  Button, Card, Drawer, Field, InlineError, Select, TextField,
  ConfirmDialog, DataTable, Pagination, EmptyState, RefetchOverlay,
  PageHeader, fmtCurrency, fmtNumber,
} from './ui';
import { api, newIdempotencyKey, ApiError } from '../lib/api';
import { useApi, useDebounced } from '../lib/useApi';
import { useAuth } from '../lib/auth';

const cx = (...parts) => parts.filter(Boolean).join(' ');

/* ===================================================================== hooks  */

/**
 * Shared CRUD list/filter/sort/paginate/drawer/delete state. All pages
 * (Orders, Products, Customers) reuse this single hook.
 */
export function useCrudPage(endpoint, { columns = [], filterSchema = [], perms = {} }) {
  const { perms: authPerms } = useAuth();

  // State
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState('-order_date');
  const [filters, setFilters] = useState({});
  const [searchQ, setSearchQ] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerItem, setDrawerItem] = useState(null);
  const [idempotencyKey, setIdempotencyKey] = useState(null);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmItem, setConfirmItem] = useState(null);
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [confirmBlocked, setConfirmBlocked] = useState(false);
  const [deleteReportMsg, setDeleteReportMsg] = useState(null);

  const debouncedSearch = useDebounced(searchQ, 300);

  // API call with all filters
  const apiParams = {
    page,
    pageSize,
    sort,
    q: debouncedSearch,
    ...filters,
  };
  const { data, error, loading, refetching } = useApi(`/${endpoint}`, apiParams);

  const rows = data?.rows || [];
  const total = data?.total || 0;
  const scope = data?.scope || {};

  // Drawer: open for new
  const handleNewClick = () => {
    setIdempotencyKey(newIdempotencyKey());
    setDrawerItem(null);
    setSubmitError(null);
    setDeleteReportMsg(null);
    setConfirmBlocked(false);
    setDrawerOpen(true);
  };

  // Drawer: open for edit
  const handleEditClick = (item) => {
    setIdempotencyKey(newIdempotencyKey());
    setDrawerItem(item);
    setSubmitError(null);
    setDeleteReportMsg(null);
    setConfirmBlocked(false);
    setDrawerOpen(true);
  };

  // Drawer: close
  const handleDrawerClose = () => {
    setDrawerOpen(false);
  };

  // Drawer: submit
  const handleSubmit = useCallback(async (formData) => {
    setSubmitError(null);
    setSubmitLoading(true);
    const isNew = !drawerItem;
    const method = isNew ? 'POST' : 'PATCH';

    try {
      const body = isNew ? formData : { ...drawerItem, ...formData };
      await api(`/${endpoint}`, { method, body, idempotencyKey });

      // Success: refresh list and close drawer
      setDrawerOpen(false);
      setIdempotencyKey(null);
      setSubmitLoading(false);
      // Reset to page 1 on new
      if (isNew) setPage(1);
    } catch (err) {
      setSubmitLoading(false);
      if (err instanceof ApiError) {
        setSubmitError(err.message);
      } else {
        setSubmitError('Failed to save');
      }
      // Drawer stays open with data intact
    }
  }, [endpoint, drawerItem, idempotencyKey]);

  // Delete: confirm dialog
  const handleDeleteClick = async (item) => {
    setConfirmItem(item);
    setDeleteReportMsg(null);
    setConfirmBlocked(false);

    // Products: check for 409 and pre-report before asking
    if (endpoint === 'products') {
      try {
        await api(`/${endpoint}`, { method: 'DELETE', body: item, idempotencyKey: newIdempotencyKey() });
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          setDeleteReportMsg(err.message);
          setConfirmBlocked(true);
          setConfirmOpen(true);
          return;
        }
        // Non-409 errors still allow the normal delete flow
      }
    }

    setConfirmOpen(true);
  };

  // Delete: execute
  const handleConfirmDelete = useCallback(async () => {
    setConfirmLoading(true);
    try {
      await api(`/${endpoint}`, {
        method: 'DELETE',
        body: confirmItem,
        idempotencyKey: newIdempotencyKey(),
      });
      setConfirmOpen(false);
      setConfirmLoading(false);
      setPage(1);
    } catch (err) {
      setConfirmLoading(false);
      if (err instanceof ApiError && err.status === 409) {
        setDeleteReportMsg(err.message);
        setConfirmBlocked(true);
      }
    }
  }, [endpoint, confirmItem]);

  return {
    // Data
    rows, total, page, pageSize, sort, filters, scope,
    searchQ, drawerOpen, drawerItem, submitError, idempotencyKey,
    confirmOpen, confirmItem, deleteReportMsg, confirmBlocked,
    loading, refetching, error, submitLoading, confirmLoading,

    // Handlers
    setPage, setPageSize, setSort, setFilters, setSearchQ,
    handleNewClick, handleEditClick, handleDrawerClose, handleSubmit,
    handleDeleteClick, handleConfirmDelete, setConfirmOpen,
    setDeleteReportMsg, setConfirmBlocked,
  };
}

/* =================================================================== Filter  */

export function FilterBar({ filters, setFilters, searchQ, setSearchQ, filterSchema, onClear }) {
  return (
    <div className="flex flex-wrap gap-2 items-center">
      <input
        type="text"
        placeholder="Search..."
        value={searchQ}
        onChange={(e) => setSearchQ(e.target.value)}
        className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px]"
      />

      {filterSchema.map((f) => (
        <select
          key={f.key}
          value={filters[f.key] || ''}
          onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value || undefined })}
          className="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px]"
        >
          <option value="">{f.label}</option>
          {(f.options || []).map((o) => (
            <option key={o} value={o}>{o}</option>
          ))}
        </select>
      ))}

      {(searchQ || Object.values(filters).some(Boolean)) && (
        <Button variant="ghost" onClick={onClear} className="text-[12px]">
          Clear filters
        </Button>
      )}
    </div>
  );
}

/* =================================================================== Row Actions  */

export function RowActions({ row, rowIdKey, canUpdate, canDelete, onEdit, onDelete }) {
  if (!canUpdate && !canDelete) return null;

  return (
    <div className="flex gap-1">
      {canUpdate && (
        <button
          onClick={() => onEdit(row)}
          className="text-[13px] text-[var(--series-1)] hover:text-[var(--series-1)]/80"
          aria-label={`Edit ${row[rowIdKey]}`}
        >
          ✎
        </button>
      )}
      {canDelete && (
        <button
          onClick={() => onDelete(row)}
          className="text-[13px] text-[var(--status-critical)] hover:text-[var(--status-critical)]/80"
          aria-label={`Delete ${row[rowIdKey]}`}
        >
          ✕
        </button>
      )}
    </div>
  );
}

/* ================================================================= OrderForm  */

export function OrderForm({ item, onSubmit, loading, error, scope }) {
  const [formData, setFormData] = useState(item || {
    customer_id: '',
    order_date: new Date().toISOString().slice(0, 10),
    ship_date: new Date().toISOString().slice(0, 10),
    ship_mode: 'Second Class',
    region: scope?.regions?.[0] || 'East',
    items: [],
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const updateItem = (i, field, value) => {
    const items = [...formData.items];
    items[i] = { ...items[i], [field]: value };
    setFormData({ ...formData, items });
  };

  const removeItem = (i) => {
    setFormData({ ...formData, items: formData.items.filter((_, idx) => idx !== i) });
  };

  const addItem = () => {
    setFormData({
      ...formData,
      items: [...formData.items, { product_id: '', quantity: 1, discount: 0 }],
    });
  };

  const lineTotal = formData.items.reduce((sum, li) => sum + (li.sales || 0), 0);

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField
        label="Customer"
        value={formData.customer_id}
        onChange={(e) => setFormData({ ...formData, customer_id: e.target.value })}
        placeholder="CU-1000"
      />

      <TextField
        label="Order Date"
        type="date"
        value={formData.order_date}
        onChange={(e) => setFormData({ ...formData, order_date: e.target.value })}
      />

      <TextField
        label="Ship Date"
        type="date"
        value={formData.ship_date}
        onChange={(e) => setFormData({ ...formData, ship_date: e.target.value })}
      />

      <Select
        label="Ship Mode"
        value={formData.ship_mode}
        onChange={(e) => setFormData({ ...formData, ship_mode: e.target.value })}
        options={['Standard Class', 'Second Class', 'First Class', 'Same Day']}
      />

      <Select
        label="Region"
        value={formData.region}
        onChange={(e) => setFormData({ ...formData, region: e.target.value })}
        options={scope?.regions || []}
        disabled={scope?.regions?.length === 1}
      />

      <div className="border-t border-[var(--border-hairline)] pt-4">
        <h3 className="text-[13px] font-medium text-[var(--text-primary)] mb-3">LINE ITEMS</h3>
        <LineItemRepeater
          items={formData.items}
          onUpdate={updateItem}
          onRemove={removeItem}
        />
        <Button
          type="button"
          variant="ghost"
          onClick={addItem}
          className="text-[12px] mt-2"
        >
          + Add line
        </Button>
      </div>

      <div className="text-[12px] text-[var(--text-muted)]">
        {formData.items.length} lines · {fmtCurrency(lineTotal)}
      </div>

      {error && <InlineError>{error}</InlineError>}

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="ghost" disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={loading}>
          {item ? 'Save changes' : 'Create order'}
        </Button>
      </div>
    </form>
  );
}

/* ========================================================== LineItemRepeater  */

export function LineItemRepeater({ items, onUpdate, onRemove }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2 items-end">
          <input
            type="text"
            placeholder="Product ID"
            value={item.product_id || ''}
            onChange={(e) => onUpdate(i, 'product_id', e.target.value)}
            className="h-8 px-2 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[12px] flex-1"
          />
          <input
            type="number"
            placeholder="Qty"
            value={item.quantity || 1}
            onChange={(e) => onUpdate(i, 'quantity', Number(e.target.value))}
            className="h-8 px-2 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[12px] w-16"
          />
          <input
            type="number"
            placeholder="Disc"
            step="0.01"
            value={item.discount || 0}
            onChange={(e) => onUpdate(i, 'discount', Number(e.target.value))}
            className="h-8 px-2 rounded-[var(--radius-sm)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[12px] w-16"
          />
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="h-8 w-8 rounded-[var(--radius-sm)] text-[var(--status-critical)] hover:bg-[var(--surface-sunken)]"
            aria-label="Remove line"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

/* ================================================================ ProductForm  */

export function ProductForm({ item, onSubmit, loading, error, existingValues }) {
  const [formData, setFormData] = useState(item || {
    product_id: '',
    name: '',
    category: '',
    sub_category: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  const categories = existingValues?.categories || [];
  const subCategories = existingValues?.subCategories || [];

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField
        label="Product ID"
        value={formData.product_id}
        onChange={(e) => setFormData({ ...formData, product_id: e.target.value })}
        disabled={!!item}
        placeholder="PR-2000"
      />

      <TextField
        label="Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        placeholder="Bush Somerset Collection Bookcase"
      />

      <Field label="Category" hint={item ? 'Category cannot be changed — create a new product instead' : ''}>
        {({ id, describedBy }) => (
          <input
            id={id}
            type="text"
            list={!item ? 'categories' : undefined}
            value={formData.category}
            onChange={(e) => setFormData({ ...formData, category: e.target.value })}
            disabled={!!item}
            placeholder="Furniture"
            aria-describedby={describedBy}
            className="h-9 w-full px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px] disabled:opacity-60"
          />
        )}
      </Field>

      <Field label="Sub-category">
        {({ id }) => (
          <input
            id={id}
            type="text"
            list="subcategories"
            value={formData.sub_category}
            onChange={(e) => setFormData({ ...formData, sub_category: e.target.value })}
            placeholder="Bookcases"
            className="h-9 w-full px-3 rounded-[var(--radius-md)] bg-[var(--surface-card)] border border-[var(--border-hairline)] text-[13px]"
          />
        )}
      </Field>

      <datalist id="categories">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>
      <datalist id="subcategories">
        {subCategories.map((s) => <option key={s} value={s} />)}
      </datalist>

      {error && <InlineError>{error}</InlineError>}

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="ghost" disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={loading}>
          {item ? 'Save changes' : 'Create product'}
        </Button>
      </div>
    </form>
  );
}

/* ================================================================ CustomerForm  */

export function CustomerForm({ item, onSubmit, loading, error, scope }) {
  const [formData, setFormData] = useState(item || {
    customer_id: '',
    name: '',
    segment: 'Consumer',
    city: '',
    state: '',
    region: scope?.regions?.[0] || 'East',
    postal_code: '',
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <TextField
        label="Customer ID"
        value={formData.customer_id}
        onChange={(e) => setFormData({ ...formData, customer_id: e.target.value })}
        disabled={!!item}
        placeholder="CU-1000"
      />

      <TextField
        label="Name"
        value={formData.name}
        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
        placeholder="Claire Gute"
      />

      <Select
        label="Segment"
        value={formData.segment}
        onChange={(e) => setFormData({ ...formData, segment: e.target.value })}
        options={['Consumer', 'Corporate', 'Home Office']}
      />

      <TextField
        label="City"
        value={formData.city}
        onChange={(e) => setFormData({ ...formData, city: e.target.value })}
        placeholder="Los Angeles"
      />

      <TextField
        label="State"
        value={formData.state}
        onChange={(e) => setFormData({ ...formData, state: e.target.value })}
        placeholder="California"
      />

      <Select
        label="Region"
        value={formData.region}
        onChange={(e) => setFormData({ ...formData, region: e.target.value })}
        options={scope?.regions || []}
        disabled={scope?.regions?.length === 1}
        hint={item ? 'Region cannot be changed — create a new customer instead' : ''}
      />

      <TextField
        label="Postal Code"
        value={formData.postal_code}
        onChange={(e) => setFormData({ ...formData, postal_code: e.target.value })}
        placeholder="90210"
      />

      {error && <InlineError>{error}</InlineError>}

      <div className="flex gap-2 pt-2">
        <Button type="button" variant="ghost" disabled={loading}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={loading}>
          {item ? 'Save changes' : 'Create customer'}
        </Button>
      </div>
    </form>
  );
}

/* ============================================================ CustomerOrdersList  */

export function CustomerOrdersList({ customerId }) {
  const { data } = useApi('/orders', { q: customerId, pageSize: 5 });
  const orders = data?.rows || [];

  if (orders.length === 0) {
    return <p className="text-[12px] text-[var(--text-muted)]">No orders</p>;
  }

  return (
    <div className="text-[12px]">
      <p className="font-medium text-[var(--text-secondary)] mb-2">Recent orders</p>
      <ul className="space-y-1">
        {orders.map((o) => (
          <li key={o.order_id}>
            <a
              href={`/app/orders?id=${o.order_id}`}
              className="text-[var(--series-1)] hover:underline"
            >
              {o.order_id}
            </a>
            <span className="text-[var(--text-muted)]"> · {o.order_date}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
