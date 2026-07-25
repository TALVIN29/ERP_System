#!/usr/bin/env node
/**
 * Normalize Superstore.csv from Kaggle into 4 CSVs for Supabase import.
 * Handles quoted fields with commas inside.
 *
 * Usage: node scripts/prepare_superstore.mjs [--self-check]
 * Output: data/out/{customers,products,orders,order_items}.csv
 */

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const selfCheck = args.includes('--self-check');

/**
 * Parse CSV text, handling quoted fields with commas.
 * Simple hand-rolled parser: track quote state line-by-line and field-by-field.
 */
function parseCSV(text) {
  const lines = text.split('\n');
  return lines.map(line => {
    const fields = [];
    let field = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];

      if (char === '"') {
        // Quote: either start/end quote, or escaped quote
        if (inQuotes && nextChar === '"') {
          // Escaped quote inside quoted field: "" -> "
          field += '"';
          i++; // Skip the next quote
        } else {
          // Toggle quote state
          inQuotes = !inQuotes;
        }
      } else if (char === ',' && !inQuotes) {
        // Unquoted comma: field separator
        fields.push(field);
        field = '';
      } else {
        // Regular character
        field += char;
      }
    }
    fields.push(field);
    return fields;
  });
}

/**
 * Self-check: verify parser handles quoted commas correctly.
 * Run a small inline CSV sample.
 */
function runSelfCheck() {
  const sample = `"Order ID","Order Date","Ship Date","Ship Mode","Customer Name"
"CA-2017-152156","2017-11-11","2017-11-20","Second Class","Smith, John"
"US-2017-100006","2017-01-30","2017-02-05","Standard Class","CU-145233"`;

  const rows = parseCSV(sample);

  // Expect 3 rows (header + 2 data)
  if (rows.length !== 3) {
    console.error(`FAIL: Expected 3 rows, got ${rows.length}`);
    process.exit(1);
  }

  // Check header
  const header = rows[0];
  if (header.length !== 5) {
    console.error(`FAIL: Expected 5 fields in header, got ${header.length}`);
    process.exit(1);
  }

  // Check that Order Date field is parsed (no trailing quote)
  const orderDate = rows[1][1];
  if (orderDate !== '2017-11-11') {
    console.error(`FAIL: Expected orderDate '2017-11-11', got '${orderDate}'`);
    process.exit(1);
  }

  // Check that a quoted comma stays inside one field instead of splitting it
  const customerName = rows[1][4];
  if (customerName !== 'Smith, John') {
    console.error(`FAIL: Expected customerName 'Smith, John', got '${customerName}'`);
    process.exit(1);
  }

  console.log('✓ CSV parser self-check passed');
  process.exit(0);
}

if (selfCheck) {
  runSelfCheck();
}

// Main: read, parse, normalize, write

const inputPath = path.join(process.cwd(), 'data', 'Superstore.csv');
const outputDir = path.join(process.cwd(), 'data', 'out');

// Read input CSV first -- creating the output dir before this check left a
// stray data/out/ behind on every failed run.
if (!fs.existsSync(inputPath)) {
  console.error(`Error: ${inputPath} not found`);
  process.exit(1);
}

// Create output directory if it doesn't exist
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const csvText = fs.readFileSync(inputPath, 'utf-8');
const rows = parseCSV(csvText);

if (rows.length < 2) {
  console.error('Error: CSV is empty or contains only header');
  process.exit(1);
}

// Parse header
const header = rows[0];
const headerMap = {};
header.forEach((col, idx) => {
  headerMap[col.trim()] = idx;
});

// Extract required columns
const required = [
  'Order ID', 'Order Date', 'Ship Date', 'Ship Mode', 'Customer ID',
  'Customer Name', 'Segment', 'Country', 'City', 'State', 'Postal Code',
  'Region', 'Product ID', 'Category', 'Sub-Category', 'Product Name',
  'Sales', 'Quantity', 'Discount', 'Profit'
];

for (const col of required) {
  if (!(col in headerMap)) {
    console.error(`Error: Missing column: ${col}`);
    process.exit(1);
  }
}

// Normalize: build deduplicated collections
const customers = new Map();
const products = new Map();
const orders = [];
const orderItems = [];

for (let i = 1; i < rows.length; i++) {
  const row = rows[i];
  if (row.length !== header.length) {
    // Skip malformed rows
    continue;
  }

  const get = (col) => row[headerMap[col]].trim();

  const customerId = get('Customer ID');
  const customName = get('Customer Name');
  const segment = get('Segment');
  const country = get('Country');
  const city = get('City');
  const state = get('State');
  const postalCode = get('Postal Code');
  const region = get('Region');

  const productId = get('Product ID');
  const category = get('Category');
  const subCategory = get('Sub-Category');
  const productName = get('Product Name');

  const orderId = get('Order ID');
  const orderDate = get('Order Date');
  const shipDate = get('Ship Date');
  const shipMode = get('Ship Mode');
  const sales = parseFloat(get('Sales')) || 0;
  const quantity = parseInt(get('Quantity'), 10) || 0;
  const discount = parseFloat(get('Discount')) || 0;
  const profit = parseFloat(get('Profit')) || 0;

  // Deduplicate customers
  if (!customers.has(customerId)) {
    customers.set(customerId, {
      customer_id: customerId,
      name: customName,
      segment,
      country,
      city,
      state,
      postal_code: postalCode,
      region,
    });
  }

  // Deduplicate products
  if (!products.has(productId)) {
    products.set(productId, {
      product_id: productId,
      category,
      sub_category: subCategory,
      name: productName,
    });
  }

  // Deduplicate orders (group by order_id, take first occurrence for metadata)
  const existingOrder = orders.find((o) => o.order_id === orderId);
  if (!existingOrder) {
    orders.push({
      order_id: orderId,
      customer_id: customerId,
      order_date: orderDate,
      ship_date: shipDate,
      ship_mode: shipMode,
      region,
    });
  }

  // Order items (one per row, denormalized with region and category)
  orderItems.push({
    id: `${orderId}-${orderItems.filter((oi) => oi.order_id === orderId).length}`,
    order_id: orderId,
    product_id: productId,
    sales: sales.toFixed(2),
    quantity,
    discount: discount.toFixed(2),
    profit: profit.toFixed(2),
    region,
    category,
  });
}

// Write CSVs
function writeCSV(filename, data, headers) {
  const lines = [headers.join(',')];
  for (const record of data) {
    const values = headers.map((h) => {
      const v = record[h];
      // Quote if contains comma or quote
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (s.includes(',') || s.includes('"')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    lines.push(values.join(','));
  }
  fs.writeFileSync(path.join(outputDir, filename), lines.join('\n'));
}

writeCSV('customers.csv', Array.from(customers.values()), [
  'customer_id', 'name', 'segment', 'country', 'city', 'state', 'postal_code', 'region',
]);

writeCSV('products.csv', Array.from(products.values()), [
  'product_id', 'category', 'sub_category', 'name',
]);

writeCSV('orders.csv', orders, [
  'order_id', 'customer_id', 'order_date', 'ship_date', 'ship_mode', 'region',
]);

writeCSV('order_items.csv', orderItems, [
  'id', 'order_id', 'product_id', 'sales', 'quantity', 'discount', 'profit', 'region', 'category',
]);

console.log(`✓ Normalization complete:`);
console.log(`  customers: ${customers.size} rows → data/out/customers.csv`);
console.log(`  products: ${products.size} rows → data/out/products.csv`);
console.log(`  orders: ${orders.length} rows → data/out/orders.csv`);
console.log(`  order_items: ${orderItems.length} rows → data/out/order_items.csv`);
