import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { toast } from 'react-toastify';
import InvoiceDetailPage from './InvoiceDetailPage';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';

// Regression coverage for the AI-suggested-parts "Add" button, which used
// to call POST /invoices/:id/parts — a route that never existed — instead
// of the canonical POST /parts (same endpoint the manual "Add Part" form
// in PartsSection already used successfully). See routes/parts.js and
// InvoiceDetailPage.js's handleAddSuggestedPart.

jest.mock('../services/api', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock('../context/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));

const baseInvoice = {
  id: 'inv-1', status: 'draft', claim_number: 'C-1', claim_title: 'Fridge repair', technician_name: 'Alex Rivera',
  customer_name: 'Jane', customer_phone: '555-0100', job_address: '123 Main St', date_of_service: null,
  type_brand: 'Whirlpool', model_number: '', serial_number: '',
  issue_description: 'Fridge not cooling', ai_generated_description: null,
  field_template_id: null, field_template_snapshot: null, field_values: {},
  line_items: [], tax_rate: 0, service_call_fee: 0, payment_method: null,
  parts: [], photos: [], manager_notes: null, pdf_blob_url: null,
};

const suggested = [{ name: 'Compressor', part_number: 'C-100', quantity: 1, notes: 'AI suggested' }];

function renderPage() {
  api.get.mockImplementation((url) => {
    if (url === '/invoices/inv-1') return Promise.resolve({ data: baseInvoice });
    if (url === '/invoice-field-templates') return Promise.resolve({ data: [] });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
  return render(
    <MemoryRouter initialEntries={['/invoices/inv-1']}>
      <Routes>
        <Route path="/invoices/:id" element={<InvoiceDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

async function renderWithSuggestion() {
  renderPage();
  await screen.findByText('Fridge repair', { exact: false });
  api.patch.mockResolvedValueOnce({ data: {} });
  api.post.mockImplementationOnce((url) =>
    url === '/invoices/inv-1/ai/parts' ? Promise.resolve({ data: { parts: suggested } }) : Promise.reject(new Error('unexpected'))
  );
  // Two "AI Suggest Parts" buttons render on this page — this one (in the
  // Parts section header) drives suggestedParts/handleAiParts; the other
  // lives inside the separate PartsSection component's own bulk-add flow.
  // data-testid disambiguates them since their accessible names are identical.
  await userEvent.click(screen.getByTestId('suggest-parts-btn'));
  // LineItemsSection's own "Add Line Item" button also renders the literal
  // text "Add" elsewhere on this page, so a role/name query alone is
  // ambiguous — data-testid pins down this exact suggested-part row's button.
  return screen.findByTestId('add-suggested-part-0');
}

beforeEach(() => {
  jest.clearAllMocks();
  useAuth.mockReturnValue({ user: { role: 'owner', membershipId: 'member-1', organizationId: 'org-1' } });
});

test('adding a suggested part calls the canonical /parts endpoint with the right payload', async () => {
  const addButton = await renderWithSuggestion();
  api.post.mockResolvedValueOnce({ data: { id: 'part-1', name: 'Compressor' } });

  await userEvent.click(addButton);

  await waitFor(() => {
    expect(api.post).toHaveBeenCalledWith('/parts', {
      invoice_id: 'inv-1',
      name: 'Compressor',
      part_number: 'C-100',
      quantity: 1,
      notes: 'AI suggested',
    });
  });
  // never the old, nonexistent nested route
  expect(api.post).not.toHaveBeenCalledWith('/invoices/inv-1/parts', expect.anything());
});

test('a successfully added part appears in the visible parts list without a page reload', async () => {
  const addButton = await renderWithSuggestion();
  api.post.mockResolvedValueOnce({ data: { id: 'part-1', name: 'Compressor' } });
  // load() refetches the invoice — return it now carrying the new part
  api.get.mockImplementation((url) =>
    url === '/invoices/inv-1'
      ? Promise.resolve({ data: { ...baseInvoice, parts: [{ id: 'part-1', name: 'Compressor', part_number: 'C-100', quantity: 1 }] } })
      : Promise.resolve({ data: [] })
  );

  await userEvent.click(addButton);

  await screen.findByText('Compressor', { selector: '.part-name' });
  expect(toast.success).toHaveBeenCalledWith('Part added');
});

test('a backend failure shows the real error message, not a generic one', async () => {
  const addButton = await renderWithSuggestion();
  api.post.mockRejectedValueOnce({ response: { data: { error: 'Cannot add parts to an invoice that is not editable' } } });

  await userEvent.click(addButton);

  await waitFor(() => {
    expect(toast.error).toHaveBeenCalledWith('Cannot add parts to an invoice that is not editable');
  });
});

test('the Add button disables while the request is in flight, so a repeated click cannot double-submit', async () => {
  const addButton = await renderWithSuggestion();
  api.post.mockClear(); // drop the earlier ai/parts suggestion call from the count below
  let resolveAdd;
  api.post.mockImplementationOnce(() => new Promise((resolve) => { resolveAdd = resolve; }));

  await userEvent.click(addButton);
  expect(addButton).toBeDisabled();

  // a second click while still pending must not fire a second /parts call
  await userEvent.click(addButton);
  expect(api.post).toHaveBeenCalledTimes(1);

  resolveAdd({ data: { id: 'part-1', name: 'Compressor' } });
  await waitFor(() => expect(addButton).not.toBeInTheDocument()); // suggestion row is removed after success
});
