const sharp = require('sharp');

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp']);
const MIN_DIMENSION = 40;
const MAX_DIMENSION = 6000;
const LARGE_SIZE = 400;
const SMALL_SIZE = 96;

/**
 * Decodes and validates an uploaded avatar buffer independently of
 * whatever mimetype/filename the client claimed — sharp actually reads
 * the pixel data, so a corrupt file, an SVG, or a renamed non-image
 * genuinely fails here rather than passing a string check. Also strips
 * metadata (sharp doesn't carry EXIF/ICC forward unless withMetadata()
 * is called, which it isn't) and normalizes to two safe JPEG sizes.
 *
 * Throws a plain Error with a user-facing message on any rejection.
 */
async function processAvatar(buffer) {
  let metadata;
  try {
    metadata = await sharp(buffer).metadata();
  } catch {
    throw new Error('That file could not be read as an image.');
  }

  if (!ALLOWED_FORMATS.has(metadata.format)) {
    throw new Error('Only JPEG, PNG, or WebP images are supported.');
  }
  if (!metadata.width || !metadata.height) {
    throw new Error('That file could not be read as an image.');
  }
  if (metadata.width < MIN_DIMENSION || metadata.height < MIN_DIMENSION) {
    throw new Error('Image is too small.');
  }
  if (metadata.width > MAX_DIMENSION || metadata.height > MAX_DIMENSION) {
    throw new Error('Image is too large.');
  }

  const [large, small] = await Promise.all([
    sharp(buffer).resize(LARGE_SIZE, LARGE_SIZE, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer(),
    sharp(buffer).resize(SMALL_SIZE, SMALL_SIZE, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer(),
  ]);

  return { large, small };
}

module.exports = { processAvatar };
