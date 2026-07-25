import { useState, useMemo } from 'react';
import {
  Button, Card, Drawer, ConfirmDialog, DataTable, Pagination,
  EmptyState, ErrorState, RefetchOverlay, PageHeader, fmtCurrency,
} from '../components/ui';
import {
  useCrudPage, FilterBar, RowActions, ProductForm,
} from '../components/crud';
import { useAuth } from '../lib/auth';

export default function Products() {
  const { perms } = useAuth();

  const canRead = perms.can('products', 'read');
  const canCreate = perms.can('products', 'create');
  const canUpdate = perms.can('products', 'update');
  const canDelete = perms.can('products', 'delete');

  const {
    rows, total, page, pageSize, sort, filters, scope,
    searchQ, drawerOpen, drawerItem, submitError, idempotencyKey,
    confirmOpen, confirmItem, deleteReportMsg, confirmBlocked,
    loading, refetching, error, submitLoading, confirmLoading,
    setPage, setPageSize, setSort, setFilters, setSearchQ,
    handleNewClick, handleEditClick, handleDrawerClose, handleSubmit,
    handleDeleteClick, handleConfirmDelete, setConfirmOpen,
  } = useCrudPage('products', {
    filterSchema: [
      { key: 'category', label: 'Category', options: scope?.categories || [] },
      { key: 'sub_category', label: 'Sub-category', options: [] },
    ],
    perms: { canRead, canCreate, canUpdate, canDelete },
  });

  if (!canRead) {
    return <ErrorState title="You do not have access to products" detail="Ask an administrator to grant you products.read." />;
  }

  if (error && !loading) {
    return <ErrorState title="Could not load products" detail={error.message} onRetry={() => window.location.reload()} />;
  }

  const scopeChip = scope?.categories?.length
    ? scope.categories.join(', ')
    : 'All categories';

  // Extract distinct sub-categories from loaded rows
  const distinctSubCategories = useMemo(() => {
    const set = new Set();
    rows.forEach((p) => {
      if (p.sub_category) set.add(p.sub_category);
    });
    return [...set].sort();
  }, [rows]);

  let emptyState = null;
  if (!loading && rows.length === 0) {
    if (searchQ || Object.values(filters).some(Boolean)) {
      emptyState = (
        <EmptyState
          title="No products match these filters"
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
    } else if (scope?.categories?.length === 0) {
      emptyState = <EmptyState title="No products yet" body={canCreate ? "Create your first product to get started." : undefined} />;
    } else {
      emptyState = (
        <EmptyState
          title={`No products in your assigned categories (${scope?.categories?.join(', ') || 'unscoped'})`}
        />
      );
    }
  }

  const columns = [
    { key: 'product_id', label: 'Product ID', sortable: true },
    { key: 'name', label: 'Name', sortable: true },
    { key: 'category', label: 'Category', sortable: true, hideBelow: 'max-xl:hidden' },
    { key: 'sub_category', label: 'Sub-category', sortable: false, hideBelow: 'max-md:hidden' },
    { key: 'order_lines', label: 'Order lines', sortable: false, numeric: true, hideBelow: 'max-md:hidden' },
    { key: 'total_sales', label: 'Total sales', sortable: true, numeric: true, render: (r) => fmtCurrency(r.total_sales) },
  ];

  const rowKey = (r) => r.product_id;
  const actions = (row) => (
    <RowActions
      row={row}
      rowIdKey="product_id"
      canUpdate={canUpdate}
      canDelete={canDelete}
      onEdit={() => handleEditClick(row)}
      onDelete={() => handleDeleteClick(row)}
    />
  );

  const confirmTitle = confirmItem
    ? `Delete product ${confirmItem.product_id}`
    : 'Delete product';

  const confirmBody = confirmItem && deleteReportMsg
    ? deleteReportMsg
    : confirmItem
    ? `Delete ${confirmItem.name}? This cannot be undone.`
    : 'This cannot be undone.';

  return (
    <div>
      <PageHeader
        title="Products"
        count={total.toLocaleString()}
        scope={scopeChip}
      >
        {canCreate && (
          <Button variant="primary" onClick={handleNewClick}>
            + New product
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
            { key: 'category', label: 'Category', options: scope?.categories || [] },
            { key: 'sub_category', label: 'Sub-category', options: distinctSubCategories },
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
        title={drawerItem ? `Product ${drawerItem.product_id}` : 'New product'}
        subtitle={drawerItem ? drawerItem.name : undefined}
        onClose={handleDrawerClose}
      >
        <ProductForm
          item={drawerItem}
          onSubmit={handleSubmit}
          loading={submitLoading}
          error={submitError}
          existingValues={{
            categories: scope?.categories || [],
            subCategories: distinctSubCategories,
          }}
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
