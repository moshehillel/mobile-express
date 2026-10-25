const fs = require('fs');
const path = require('path');

const TAX_RATE = 0.08125;
const MAX_QTY = 99;

class PricingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const productsPath = () => {
  const candidates = [
    path.join(__dirname, 'data/products.json'),
    path.join(__dirname, '../../../data/products.json'),
    path.join(process.cwd(), 'data/products.json'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
};

const loadProducts = () => {
  const filePath = productsPath();
  if (!filePath) throw new PricingError('Product catalog is unavailable', 500);
  const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(doc.products) ? doc.products : [];
};

const money = (cents) => (cents / 100).toFixed(2);

const quoteItems = (items, products) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new PricingError('Cart is empty');
  }

  const byId = new Map(products.map((product) => [String(product.id), product]));
  const lines = [];

  for (const item of items) {
    const id = String(item && item.id || '').trim();
    const product = byId.get(id);
    if (!product) throw new PricingError('An item in your cart is no longer available');

    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      throw new PricingError('Invalid quantity');
    }

    let unitPrice = Number(product.price);
    const variantName = item.variant ? String(item.variant) : '';
    if (variantName) {
      const variant = (Array.isArray(product.variants) ? product.variants : [])
        .find((entry) => entry && entry.name === variantName);
      if (!variant) throw new PricingError('An item option is no longer available');
      unitPrice = Number(variant.price);
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new PricingError('Invalid product price', 500);
    }

    lines.push({
      id,
      name: String(product.name || ''),
      type: String(product.type || ''),
      quantity,
      unitPrice,
      variant: variantName || null,
      plan: item.plan ? String(item.plan) : null,
      serialized: !!product.serialized,
    });
  }

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const totalCents = Math.round((subtotal + subtotal * TAX_RATE) * 100);
  const subtotalCents = Math.round(subtotal * 100);
  const taxCents = totalCents - subtotalCents;
  if (totalCents <= 0) throw new PricingError('Payment amount is invalid');

  const serializedCount = lines.reduce(
    (sum, line) => sum + (line.serialized ? line.quantity : 0),
    0
  );

  return {
    lines,
    subtotalCents,
    taxCents,
    totalCents,
    subtotal: money(subtotalCents),
    tax: money(taxCents),
    total: money(totalCents),
    serializedCount,
    details: lines.map((line) => `${line.name} (${line.type}) - Qty: ${line.quantity}`).join(', '),
  };
};

const quoteCart = (items) => quoteItems(items, loadProducts());

module.exports = { PricingError, quoteCart, quoteItems, loadProducts };
