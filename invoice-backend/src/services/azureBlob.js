const {
  BlobServiceClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters,
  BlobSASPermissions,
} = require('@azure/storage-blob');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const blobServiceClient = BlobServiceClient.fromConnectionString(config.azure.connectionString);

const getContainerClient = (containerName) =>
  blobServiceClient.getContainerClient(containerName || config.azure.containerName);

// Parse AccountName and AccountKey out of the connection string
function parseConnectionString(cs) {
  const parts = {};
  cs.split(';').forEach((seg) => {
    const eq = seg.indexOf('=');
    if (eq > -1) parts[seg.slice(0, eq)] = seg.slice(eq + 1);
  });
  return { accountName: parts.AccountName, accountKey: parts.AccountKey };
}

/**
 * Upload a buffer to Azure Blob Storage (private container).
 * Returns the internal blob URL (not publicly accessible — use generateSasUrl to serve it).
 */
async function uploadBuffer(buffer, originalName, folder = '', containerName) {
  const ext = originalName.split('.').pop();
  const blobName = `${folder}${folder ? '/' : ''}${uuidv4()}.${ext}`;
  const containerClient = getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);

  await blockBlobClient.upload(buffer, buffer.length, {
    blobHTTPHeaders: { blobContentType: getMimeType(ext) },
  });

  return blockBlobClient.url;
}

/**
 * Generate a time-limited SAS URL for a private blob.
 * expiryMinutes defaults to 60 — enough for one session.
 */
function generateSasUrl(blobUrl, expiryMinutes = 60) {
  const { accountName, accountKey } = parseConnectionString(config.azure.connectionString);
  const credential = new StorageSharedKeyCredential(accountName, accountKey);

  const url = new URL(blobUrl);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const containerName = pathParts[0];
  const blobName = pathParts.slice(1).join('/');

  const expiresOn = new Date(Date.now() + expiryMinutes * 60 * 1000);

  const sasToken = generateBlobSASQueryParameters(
    {
      containerName,
      blobName,
      permissions: BlobSASPermissions.parse('r'),
      expiresOn,
    },
    credential
  ).toString();

  return `${blobUrl}?${sasToken}`;
}

/**
 * Delete a blob by its full URL.
 */
async function deleteBlob(blobUrl, containerName) {
  const containerClient = getContainerClient(containerName);
  const blobName = new URL(blobUrl).pathname.split('/').slice(2).join('/');
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  await blockBlobClient.deleteIfExists();
}

/**
 * List all blobs in a folder prefix — returns SAS URLs so callers can download directly.
 */
async function listBlobs(prefix = '', containerName) {
  const containerClient = getContainerClient(containerName);
  const blobs = [];
  for await (const blob of containerClient.listBlobsFlat({ prefix })) {
    const rawUrl = `${containerClient.url}/${blob.name}`;
    blobs.push({
      name: blob.name,
      url: generateSasUrl(rawUrl),
      lastModified: blob.properties.lastModified,
      size: blob.properties.contentLength,
    });
  }
  return blobs;
}

function getMimeType(ext) {
  const map = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

/**
 * Download a blob by its URL and return it as a Buffer.
 */
async function downloadBuffer(blobUrl) {
  const url = new URL(blobUrl);
  const pathParts = url.pathname.split('/').filter(Boolean);
  const containerName = pathParts[0];
  const blobName = pathParts.slice(1).join('/');
  const containerClient = getContainerClient(containerName);
  const blockBlobClient = containerClient.getBlockBlobClient(blobName);
  const response = await blockBlobClient.download(0);
  const chunks = [];
  for await (const chunk of response.readableStreamBody) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { uploadBuffer, downloadBuffer, generateSasUrl, deleteBlob, listBlobs };
