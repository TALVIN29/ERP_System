import { useMemo } from 'react';
import {
  Button, Card, Drawer, ConfirmDialog, DataTable, Pagination,
  EmptyState, ErrorState, RefetchOverlay, PageHeader, fmtCurrency,
} from '../components/ui';
import {
  useCrudPage, FilterBar, RowActions, CustomerForm, CustomerOrdersList,
} from '../components/crud';
import { useAuth } from '../lib/auth';

export default function Customers() {
  const { perms } = useAuth();

  const canRead = perms.can('customers', 'read');
  const canCreate = perms.can('customers', 'create');
  const canUpdate = perms.can('customers', 'update');
  const canDelete = perms.can('customers', 'delete');

  const {
    rows, total, page, pageSize, sort, filters, scope,
    searchQ, drawerOpen, drawerItem, submitError, idempotencyKey,
    confirmOpen, confirmItem, deleteReportMsg, confirmBlocked,
    loading, refetching, error, submitLoading, confirmLoading,
    setPage, setPageSize, setSort, setFilters, setSearchQ,
    handleNewClick, handleEditClick, handleDrawerClose, handleSubmit,
    handleDeleteClick, handleConfirmDelete, setConfirmOpen,
    // See Orders.jsx: reading `scope` here is a temporal dead zone crash.
  } = useCrudPage('customers', {
    perms: { canRead, canCreate, canUpdate, canDelete },
  });

  if (!canRead) {
    return <ErrorState title="You do not have access to customers" detail="Ask an administrator to grant you customers.read." />;
  }

  if (error && !loading) {
    return <ErrorState title="Could not load customers" detail={error.message} onRetry={() => window.location.reload()} />;
  }

  const scopeChip = scope?.regions?.length === 1
    ? scope.regions[0]
    : scope?.regions?.length ? `${scope.regions.join(', ')}`
    : 'All regions';

  // Extract distinct states from loaded rows
  const distinctStates = useMemo(() => {
    const set = new Set();
    rows.forEach((c) => {
      if (c.state) set.add(c.state);
    });
    return [...set].sort();
  }, [rows]);

  let emptyState = null;
  if (!loading && rows.length === 0) {
    if (searchQ || Object.values(filters).some(Boolean)) {
      emptyState = (
        <EmptyState
          title="No customers match these filters"
          body="Try adjusting your search or filters"
          action={
            <Button
              variant="ghost"
              onClick={() => { setSearchQ(''); setFilters({}); }}
            >
              Clear filters
            </Button>
          }
        />
      );
    } else if (scope?.regions?.length === 0) {
      emptyState = <EmptyState title="No customers yet" body={canCreate ? "Create your first customer to get started." : undefined} />;
    } else {
      emptyState = (
        <EmptyState
          title={`No customers in your assigned region (${scope?.regions?.[0] || 'unscoped'})`}
        />
      );
    }
  }

  const columns = [
    { key: 'customer_id', label: 'Customer ID', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'segment', label: 'Segment', sortable: true, hideBelow: 'max-xl:hidden' },
    { key: 'city', label: 'City', sortable: false, hideBelow: 'max-md:hidden' },
    { key: 'state', label: 'State', sortable: true, hideBelow: 'max-md:hidden' },
    { key: 'region', label: 'Region', sortable: true, hideBelow: 'max-lg:hidden' },
    { key: 'order_count', label: 'Orders', sortable: false, numeric: true, hideBelow: 'max-md:hidden' },
    { key: 'total_sales', label: 'Total sales', sortable: true, numeric: true, render: (r) => fmtCurrency(r.total_sales) },
  ];

  const rowKey = (r) => r.customer_id;
  const actions = (row) => (
    <RowActions
      row={row}
      rowIdKey="customer_id"
      canUpdate={canUpdate}
      canDelete={canDelete}
      onEdit={() => handleEditClick(row)}
      onDelete={() => handleDeleteClick(row)}
    />
  );

  const confirmTitle = confirmItem
    ? `Delete customer ${confirmItem.customer_id}`
    : 'Delete customer';

  const confirmBody = confirmItem && deleteReportMsg
    ? deleteReportMsg
    : confirmItem
    ? `Delete ${confirmItem.name} and their data? This cannot be undone.`
    : 'This cannot be undone.';

  return (
    <div>
      <PageHeader
        title="Customers"
        count={total.toLocaleString()}
        scope={scopeChip}
      >
        {canCreate && (
          <Button variant="primary" onClick={handleNewClick}>
            + New customer
          </Button>
        )}
      </PageHeader>

      <Card className="p-4 mb-4">
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          searchQ={searchQ}
          setSearchQ={setSearchQ}
          filterSchema={[
            { key: 'region', label: 'Region', options: scope?.regions || [] },
            { key: 'segment', label: 'Segment', options: ['Consumer', 'Corporate', 'Home Office'] },
            { key: 'state', label: 'State', options: distinctStates },
          ]}
          onClear={() => { setSearchQ(''); setFilters({}); setPage(1); }}
        />
      </Card>

      <RefetchOverlay active={refetching}>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={rowKey}
          sort={sort}
          onSort={setSort}
          loading={loading}
          empty={emptyState}
          actions={!canUpdate && !canDelete ? null : actions}
        />
      </RefetchOverlay>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPage={setPage}
        onPageSize={setPageSize}
      />

      <Drawer
        open={drawerOpen}
        title={drawerItem ? drawerItem.name : 'New customer'}
        subtitle={drawerItem ? drawerItem.customer_id : undefined}
        onClose={handleDrawerClose}
      >
        {/* /orders only supports free-text search on order_id/customer_name (see
            mock.js applyFilters) — customer_id isn't a searchable field there,
            so the name is the identifier that actually returns this customer's orders. */}
        {drawerItem && drawerItem.customer_id && (
          <CustomerOrdersList customerId={drawerItem.name} />
        )}
        <CustomerForm
          item={drawerItem}
          onSubmit={handleSubmit}
          loading={submitLoading}
          error={submitError}
          scope={scope}
        />
      </Drawer>

      <ConfirmDialog
        open={confirmOpen}
        title={confirmTitle}
        body={confirmBody}
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onClose={() => setConfirmOpen(false)}
        blocked={confirmBlocked}
        busy={confirmLoading}
      />
    </div>
  );
}
