import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';

// Isolated in its own module and only ever reached via a dynamic import()
// (see UploadFormModal.js) because `import.meta.url` is a hard SyntaxError
// under CRA5's Jest/Babel transform — webpack handles it fine at build time,
// but Jest never bundles this file unless a test actually exercises the
// PDF-upload path, so it never gets parsed.
GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.js', import.meta.url).toString();

export { getDocument };
