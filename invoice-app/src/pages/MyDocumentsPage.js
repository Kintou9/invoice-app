import { useEffect, useState } from 'react';
import { Camera, Receipt, FileText } from 'lucide-react';
import api from '../services/api';
import './MyDocumentsPage.css';

const TYPE_ICON = { photo: Camera, receipt: Receipt, invoice_pdf: FileText };

export default function MyDocumentsPage() {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/documents').then((r) => setDocuments(r.data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading...</p>;

  return (
    <div className="documents-page">
      <div className="page-header">
        <h1>My Documents</h1>
      </div>
      {documents.length === 0 ? (
        <p className="empty-msg">No documents yet — job photos, receipts, and generated invoice PDFs will show up here.</p>
      ) : (
        <div className="documents-list">
          {documents.map((d) => {
            const Icon = TYPE_ICON[d.type] || FileText;
            return (
              <a key={`${d.type}-${d.id}`} href={d.sas_url} target="_blank" rel="noreferrer" className="document-row">
                <span className="document-icon"><Icon size={18} /></span>
                <span className="document-info">
                  <span className="document-label">{d.label}</span>
                  <span className="document-sub">{d.claim_number} · {d.claim_title}</span>
                </span>
                <span className="document-date">{new Date(d.doc_date).toLocaleDateString()}</span>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
