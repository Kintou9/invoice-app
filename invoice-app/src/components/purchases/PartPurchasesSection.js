import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import api from '../../services/api';
import { Plus, Trash2, ExternalLink, Truck } from 'lucide-react';
import './PartPurchasesSection.css';

const STATUS_LABELS = {
  ordered: 'Ordered',
  shipped: 'Shipped',
  delivered: 'Delivered',
  returned: 'Returned',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
};

const EMPTY_FORM = {
  product_url: '',
  part_description: '',
  part_number: '',
  supplier_name: '',
  unit_cost: '',
  shipping_cost: '0',
  tax: '0',
  quantity: '1',
  tracking_url: '',
  order_number: '',
  tracking_number: '',
  status: 'ordered',
  purchase_date: '',
};

// invoices: the claim's own invoices (from ClaimDetailPage), so "add to
// invoice" picks from a real dropdown instead of a free-typed id.
export default function PartPurchasesSection({ claimId, invoices }) {
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [billingId, setBillingId] = useState(null); // purchase id currently showing the bill-to-invoice form

  const load = () => {
    setLoading(true);
    api.get(`/purchases?claim_id=${claimId}`)
      .then((res) => setPurchases(res.data))
      .catch(() => toast.error('Failed to load purchases'))
      .finally(() => setLoading(false));
  };

  useEffect(load, [claimId]);

  const handleDelete = async (id) => {
    try {
      await api.delete(`/purchases/${id}`);
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Delete failed');
    }
  };

  const totalCost = purchases.reduce((sum, p) => sum + Number(p.total_cost || 0), 0);
  const totalBilled = purchases.reduce((sum, p) => sum + Number(p.billed_amount || 0), 0);
  const billableInvoices = invoices?.filter((inv) => inv.status !== 'approved') || [];

  return (
    <div className="purchases-section">
      <div className="purchases-actions">
        <button className="btn btn-secondary" onClick={() => setShowAddForm(true)}>
          <Plus size={14} /> Add Purchase
        </button>
      </div>

      {loading ? (
        <p className="empty-parts">Loading purchases...</p>
      ) : purchases.length === 0 ? (
        <p className="empty-parts">No parts purchased yet for this claim.</p>
      ) : (
        <>
          <div className="purchases-list">
            {purchases.map((p) => (
              <div key={p.id} className="purchase-card">
                <div className="purchase-main">
                  <div className="purchase-info">
                    <span className="purchase-name">{p.part_description}</span>
                    {p.part_number && <span className="part-num">P/N: {p.part_number}</span>}
                    <span className="part-qty">Qty: {p.quantity}</span>
                    {p.supplier_name && <span className="purchase-supplier">{p.supplier_name}</span>}
                    <span className={`status-badge status-${p.status}`}>{STATUS_LABELS[p.status] || p.status}</span>
                  </div>
                  {!p.invoice_line_item_id && (
                    <button className="btn-icon-danger" onClick={() => handleDelete(p.id)} title="Remove purchase">
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>

                <div className="purchase-costs">
                  <span>Cost: <strong>${Number(p.total_cost).toFixed(2)}</strong></span>
                  {p.invoice_line_item_id ? (
                    <span className="purchase-billed">
                      ✓ Billed ${Number(p.billed_amount).toFixed(2)}
                      {' '}(profit ${(Number(p.billed_amount) - Number(p.total_cost)).toFixed(2)})
                    </span>
                  ) : (
                    billableInvoices.length > 0 && (
                      <button className="add-link-btn" onClick={() => setBillingId(p.id)}>
                        Add to invoice
                      </button>
                    )
                  )}
                </div>

                <div className="purchase-links">
                  {p.product_url && (
                    <a href={p.product_url} target="_blank" rel="noreferrer" className="purchase-link">
                      <ExternalLink size={12} /> Product
                    </a>
                  )}
                  {p.tracking_url && (
                    <a href={p.tracking_url} target="_blank" rel="noreferrer" className="purchase-link">
                      <Truck size={12} /> Track
                    </a>
                  )}
                </div>

                {billingId === p.id && (
                  <AddToInvoiceForm
                    purchase={p}
                    invoices={billableInvoices}
                    onCancel={() => setBillingId(null)}
                    onSaved={() => {
                      setBillingId(null);
                      load();
                    }}
                  />
                )}
              </div>
            ))}
          </div>

          <div className="purchases-totals">
            <div><span>Total Parts Cost</span><strong>${totalCost.toFixed(2)}</strong></div>
            {totalBilled > 0 && (
              <>
                <div><span>Billed to Customer</span><strong>${totalBilled.toFixed(2)}</strong></div>
                <div><span>Parts Margin</span><strong>${(totalBilled - totalCost).toFixed(2)}</strong></div>
              </>
            )}
          </div>
        </>
      )}

      {showAddForm && (
        <AddPurchaseModal
          claimId={claimId}
          onClose={() => setShowAddForm(false)}
          onSaved={() => {
            setShowAddForm(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function AddToInvoiceForm({ purchase, invoices, onCancel, onSaved }) {
  const [invoiceId, setInvoiceId] = useState(invoices[0]?.id || '');
  const [unitPrice, setUnitPrice] = useState('');
  const [saving, setSaving] = useState(false);

  const totalPrice = unitPrice ? Number(unitPrice) * purchase.quantity : null;
  const profit = totalPrice !== null ? totalPrice - Number(purchase.total_cost) : null;
  const marginPct = profit !== null && totalPrice > 0 ? ((profit / totalPrice) * 100).toFixed(1) : null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!invoiceId) { toast.error('Select an invoice'); return; }
    setSaving(true);
    try {
      await api.post(`/purchases/${purchase.id}/add-to-invoice`, {
        invoice_id: invoiceId,
        unit_price: Number(unitPrice),
      });
      toast.success('Added to invoice');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add to invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="add-invoice-form" onSubmit={handleSubmit}>
      <div className="form-row">
        <div className="form-group">
          <label>Invoice</label>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            {invoices.map((inv) => (
              <option key={inv.id} value={inv.id}>
                Invoice {new Date(inv.created_at).toLocaleDateString()} ({inv.status})
              </option>
            ))}
          </select>
        </div>
        <div className="form-group" style={{ maxWidth: 140 }}>
          <label>Price per unit</label>
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder={`x${purchase.quantity}`}
          />
        </div>
      </div>
      {profit !== null && (
        <p className="margin-preview">
          Customer total ${totalPrice.toFixed(2)} — profit ${profit.toFixed(2)} ({marginPct}% margin)
        </p>
      )}
      <div className="add-link-btns">
        <button type="button" className="btn btn-sm btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
          {saving ? 'Adding...' : 'Confirm'}
        </button>
      </div>
    </form>
  );
}

function AddPurchaseModal({ claimId, onClose, onSaved }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.post('/purchases', {
        claim_id: claimId,
        part_description: form.part_description,
        part_number: form.part_number || undefined,
        supplier_name: form.supplier_name || undefined,
        unit_cost: Number(form.unit_cost),
        shipping_cost: Number(form.shipping_cost) || 0,
        tax: Number(form.tax) || 0,
        quantity: Number(form.quantity) || 1,
        product_url: form.product_url || undefined,
        tracking_url: form.tracking_url || undefined,
        order_number: form.order_number || undefined,
        tracking_number: form.tracking_number || undefined,
        status: form.status,
        purchase_date: form.purchase_date || undefined,
      });
      toast.success('Purchase added');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add purchase');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="purchase-modal-overlay" onClick={onClose}>
      <form className="purchase-modal" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <h3>Add Part Purchase</h3>

        <div className="form-group">
          <label>Product URL</label>
          <input
            type="url"
            placeholder="https://www.amazon.com/..."
            value={form.product_url}
            onChange={(e) => update('product_url', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Part Description *</label>
          <input required value={form.part_description} onChange={(e) => update('part_description', e.target.value)} placeholder="e.g. Compressor relay" />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Part Number</label>
            <input value={form.part_number} onChange={(e) => update('part_number', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Supplier</label>
            <input placeholder="Auto-detected from URL if blank" value={form.supplier_name} onChange={(e) => update('supplier_name', e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Unit Cost *</label>
            <input required type="number" step="0.01" min="0" value={form.unit_cost} onChange={(e) => update('unit_cost', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Shipping</label>
            <input type="number" step="0.01" min="0" value={form.shipping_cost} onChange={(e) => update('shipping_cost', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Tax</label>
            <input type="number" step="0.01" min="0" value={form.tax} onChange={(e) => update('tax', e.target.value)} />
          </div>
          <div className="form-group" style={{ maxWidth: 80 }}>
            <label>Qty</label>
            <input type="number" min="1" value={form.quantity} onChange={(e) => update('quantity', e.target.value)} />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Order #</label>
            <input value={form.order_number} onChange={(e) => update('order_number', e.target.value)} />
          </div>
          <div className="form-group">
            <label>Tracking #</label>
            <input value={form.tracking_number} onChange={(e) => update('tracking_number', e.target.value)} />
          </div>
        </div>

        <div className="form-group">
          <label>Tracking URL</label>
          <input type="url" value={form.tracking_url} onChange={(e) => update('tracking_url', e.target.value)} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Status</label>
            <select value={form.status} onChange={(e) => update('status', e.target.value)}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Purchase Date</label>
            <input type="date" value={form.purchase_date} onChange={(e) => update('purchase_date', e.target.value)} />
          </div>
        </div>

        <div className="add-link-btns">
          <button type="button" className="btn btn-sm btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-sm btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Add Purchase'}
          </button>
        </div>
      </form>
    </div>
  );
}
