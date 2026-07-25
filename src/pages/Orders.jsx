import { useSearchParams } from 'react-router-dom';
import {
  Button, Card, Drawer, ConfirmDialog, DataTable, Pagination,
  EmptyState, ErrorState, RefetchOverlay, PageHeader, fmtCurrency,
} from '../components/ui';
import {
  useCrudPage, FilterBar, RowActions, OrderForm,
} from '../components/crud';
import { useAuth } from '../lib/auth';

export default function Orders() {
  const { perms } = useAuth();
  const [searchParams] = useSearchParams();

  const canRead = perms.can('orders', 'read');
  const canCreate = perms.can('orders', 'create');
  const canUpdate = perms.can('orders', 'update');
  const canDelete = perms.can('orders', 'delete');

  const {
    rows, total, page, pageSize, sort, filters, scope,
    searchQ, drawerOpen, drawerItem, submitError, idempotencyKey,
    confirmOpen, confirmItem, deleteReportMsg, confirmBlocked,
    loading, refetching, error, submitLoading, confirmLoading,
    setPage, setPageSize, setSort, setFilters, setSearchQ,
    handleNewClick, handleEditClick, handleDrawerClose, handleSubmit,
    handleDeleteClick, handleConfirmDelete, setConfirmOpen,
  } = useCrudPage('orders', {
    filterSchema: [
      { key: 'region', label: 'Region', options: scope?.regions || [] },
      { key: 'category', label: 'Category', options: scope?.categories || [] },
    ],
    perms: { canRead, canCreate, canUpdate, canDelete },
  });

  if (!canRead) {
    return <ErrorState title="You do not have access to orders" detail="Ask an administrator to grant you orders.read." />;
  }

  if (error && !loading) {
    return <ErrorState title="Could not load orders" detail={error.message} onRetry={() => window.location.reload()} />;
  }

  const scopeChip = scope?.regions?.length === 1
    ? scope.regions[0]
    : scope?.regions?.length ? `${scope.regions.join(', ')}`
    : 'All regions';

  let emptyState = null;
  if (!loading && rows.length === 0) {
    if (searchQ || Object.values(filters).some(Boolean)) {
      emptyState = (
        <EmptyState
          title="No orders match these filters"
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
    } else if (scope?.regions?.length === 0 && scope?.categories?.length === 0) {
      emptyState = <EmptyState title="No orders yet" body={canCreate ? "Create your first order to get started." : undefined} />;
    } else {
      emptyState = (
        <EmptyState
          title={`No orders in your assigned region (${scope?.regions?.[0] || 'unscoped'})`}
        />
      );
    }
  }

  const columns = [
    { key: 'order_id', label: 'Order ID', sortable: true },
    { key: 'order_date', label: 'Date', sortable: true },
    { key: 'customer_name', label: 'Customer', sortable: false },
    { key: 'region', label: 'Region', sortable: true, hideBelow: 'max-xl:hidden' },
    { key: 'lines', label: 'Lines', sortable: false, numeric: true, hideBelow: 'max-md:hidden' },
    { key: 'sales', label: 'Sales', sortable: true, numeric: true, render: (r) => fmtCurrency(r.sales) },
  ];

  const rowKey = (r) => r.order_id;
  const actions = (row) => (
    <RowActions
      row={row}
      rowIdKey="order_id"
      canUpdate={canUpdate}
      canDelete={canDelete}
      onEdit={() => handleEditClick(row)}
      onDelete={() => handleDeleteClick(row)}
    />
  );

  const confirmTitle = confirmItem
    ? `Delete order ${confirmItem.order_id}`
    : 'Delete order';

  const confirmBody = confirmItem && deleteReportMsg
    ? deleteReportMsg
    : confirmItem
    ? `Delete order ${confirmItem.order_id} and its ${confirmItem.lines} line items? This cannot be undone.`
    : 'This cannot be undone.';

  return (
    <div>
      <PageHeader
        title="Orders"
        count={total.toLocaleString()}
        scope={scopeChip}
      >
        {canCreate && (
          <Button variant="primary" onClick={handleNewClick}>
            + New order
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
            { key: 'category', label: 'Category', options: scope?.categories || [] },
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
        title={drawerItem ? `Order ${drawerItem.order_id}` : 'New order'}
        subtitle={drawerItem ? drawerItem.order_date : undefined}
        onClose={handleDrawerClose}
      >
        <OrderForm
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
