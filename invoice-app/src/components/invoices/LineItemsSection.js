import { useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';

const emptyRow = { description: '', quantity: 1, unit: '', unit_price: '' };
export const PAYMENT_METHOD_LABELS = { cash: 'Cash', card: 'Card', check: 'Check' };

// Always rendered, even on an invoice with no template — line items are
// shared across every template (and every legacy, pre-template invoice),
// per the one-shared-invoice-system requirement.
export default function LineItemsSection({ invoiceId, lineItems, taxRate, serviceCallFee, paymentMethod, allowServiceCallFee = false, isEditable, onUpdate }) {
  const [newRow, setNewRow] = useState(emptyRow);
  const [adding, setAdding] = useState(false);
  const [feeInput, setFeeInput] = useState(String(serviceCallFee ?? 0));
  const [savingFee, setSavingFee] = useState(false);
  const [savingMethod, setSavingMethod] = useState(false);

  // Only resync from the server when the fee actually changes upstream —
  // never mid-typing, so a background reload (e.g. from adding a line item)
  // can't clobber a value the tech hasn't tabbed away from yet.
  useEffect(() => { setFeeInput(String(serviceCallFee ?? 0)); }, [serviceCallFee]);

  const subtotal = (lineItems || []).reduce((sum, li) => sum + Number(li.total_price), 0);
  const tax = subtotal * (Number(taxRate) || 0) / 100;
  const fee = allowServiceCallFee ? (Number(serviceCallFee) || 0) : 0;
  const total = subtotal + tax + fee;

  const handleSaveFee = async () => {
    const value = Number(feeInput);
    if (Number.isNaN(value) || value < 0) {
      toast.error('Enter a valid fee amount');
      setFeeInput(String(serviceCallFee ?? 0));
      return;
    }
    if (value === fee) return;
    setSavingFee(true);
    try {
      await api.patch(`/invoices/${invoiceId}`, { service_call_fee: value });
      onUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save service call fee');
    } finally {
      setSavingFee(false);
    }
  };

  const handlePaymentMethodChange = async (e) => {
    const value = e.target.value;
    setSavingMethod(true);
    try {
      await api.patch(`/invoices/${invoiceId}`, { payment_method: value });
      onUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save payment method');
    } finally {
      setSavingMethod(false);
    }
  };

  const handleAdd = async (e) => {
    e.preventDefault();
    if (!newRow.description.trim() || !newRow.quantity || newRow.unit_price === '') {
      toast.error('Description, quantity, and unit price are required');
      return;
    }
    setAdding(true);
    try {
      await api.post('/invoice-line-items', {
        invoice_id: invoiceId, description: newRow.description,
        quantity: Number(newRow.quantity), unit_price: Number(newRow.unit_price), unit: newRow.unit || null,
      });
      setNewRow(emptyRow);
      onUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not add line item');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (id) => {
    try {
      await api.delete(`/invoice-line-items/${id}`);
      onUpdate();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not remove line item');
    }
  };

  return (
    <section className="card">
      <h2>Line Items</h2>
      {(lineItems || []).length > 0 && (
        <table className="claims-table" style={{ marginBottom: '0.75rem' }}>
          <thead>
            <tr><th>Description</th><th>Qty</th><th>Unit</th><th>Unit Price</th><th>Total</th>{isEditable && <th></th>}</tr>
          </thead>
          <tbody>
            {lineItems.map((li) => (
              <tr key={li.id}>
                <td>{li.description}</td>
                <td>{li.quantity}</td>
                <td>{li.unit || '—'}</td>
                <td>${Number(li.unit_price).toFixed(2)}</td>
                <td>${Number(li.total_price).toFixed(2)}</td>
                {isEditable && (
                  <td>
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => handleDelete(li.id)} aria-label={`Remove ${li.description}`}>
                      <Trash2 size={14} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {isEditable && (
        <form onSubmit={handleAdd} className="form-row" style={{ alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 2, minWidth: 160 }}>
            <label htmlFor="li-description">Description</label>
            <input id="li-description" value={newRow.description} onChange={(e) => setNewRow({ ...newRow, description: e.target.value })} />
          </div>
          <div className="form-group" style={{ maxWidth: 90 }}>
            <label htmlFor="li-quantity">Qty</label>
            <input id="li-quantity" type="number" min="0" step="any" value={newRow.quantity} onChange={(e) => setNewRow({ ...newRow, quantity: e.target.value })} />
          </div>
          <div className="form-group" style={{ maxWidth: 90 }}>
            <label htmlFor="li-unit">Unit</label>
            <input id="li-unit" value={newRow.unit} onChange={(e) => setNewRow({ ...newRow, unit: e.target.value })} placeholder="hrs" />
          </div>
          <div className="form-group" style={{ maxWidth: 120 }}>
            <label htmlFor="li-unit-price">Unit Price</label>
            <input id="li-unit-price" type="number" min="0" step="0.01" value={newRow.unit_price} onChange={(e) => setNewRow({ ...newRow, unit_price: e.target.value })} />
          </div>
          <button type="submit" className="btn btn-secondary" disabled={adding}>
            <Plus size={15} /> {adding ? 'Adding...' : 'Add'}
          </button>
        </form>
      )}

      <div className="template-preview-totals" style={{ marginTop: '0.75rem' }}>
        <div>Subtotal: ${subtotal.toFixed(2)}</div>
        {Number(taxRate) > 0 && <div>Tax ({taxRate}%): ${tax.toFixed(2)}</div>}
        {allowServiceCallFee && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>Service call fee:</span>
              {isEditable ? (
                <input
                  type="number" min="0" step="0.01" value={feeInput}
                  onChange={(e) => setFeeInput(e.target.value)}
                  onBlur={handleSaveFee}
                  disabled={savingFee}
                  style={{ width: 90 }}
                />
              ) : <span>${fee.toFixed(2)}</span>}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span>Paid by:</span>
              {isEditable ? (
                <select value={paymentMethod || ''} onChange={handlePaymentMethodChange} disabled={savingMethod}>
                  <option value="" disabled>Select method</option>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="check">Check</option>
                </select>
              ) : <span>{PAYMENT_METHOD_LABELS[paymentMethod] || '—'}</span>}
            </div>
          </>
        )}
        <strong>Total: ${total.toFixed(2)}</strong>
      </div>
    </section>
  );
}
