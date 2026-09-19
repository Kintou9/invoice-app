import { useEffect, useRef, useState } from 'react';
import Cropper from 'react-easy-crop';
import { X, Minus, Plus } from 'lucide-react';
import { getCroppedImageBlob } from '../../utils/cropImage';
import './PhotoCropModal.css';

const MAX_SIZE = 5 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Shown when the user clicks the camera button or "Upload new photo" on
// their profile. Handles both picking the file and cropping it — the
// crop step always runs, so what's uploaded is always already a square,
// matching exactly what the final circular avatar will show.
export default function PhotoCropModal({ onClose, onSave, saving }) {
  const [imageSrc, setImageSrc] = useState(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState(null);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  const dialogRef = useRef(null);

  useEffect(() => { dialogRef.current?.focus(); }, []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => () => { if (imageSrc) URL.revokeObjectURL(imageSrc); }, [imageSrc]);

  const validateAndSetFile = (f) => {
    setError(null);
    if (!ALLOWED_TYPES.includes(f.type)) {
      setError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (f.size > MAX_SIZE) {
      setError('That photo is too large — the limit is 5MB.');
      return;
    }
    setImageSrc(URL.createObjectURL(f));
    setCrop({ x: 0, y: 0 });
    setZoom(1);
  };

  const handleSave = async () => {
    if (!croppedAreaPixels) return;
    try {
      const blob = await getCroppedImageBlob(imageSrc, croppedAreaPixels);
      await onSave(blob);
    } catch {
      setError('Could not process that photo. Try a different one.');
    }
  };

  return (
    <div className="dt-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose(); }}>
      <div className="photo-crop-modal" role="dialog" aria-modal="true" aria-labelledby="crop-modal-title" tabIndex={-1} ref={dialogRef}>
        <div className="dt-modal-header">
          <h3 id="crop-modal-title">Update profile photo</h3>
          <button type="button" className="dt-modal-close" onClick={onClose} disabled={saving} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {!imageSrc ? (
          <>
            <p className="photo-crop-hint">Choose a JPG, PNG, or WebP photo. Maximum 5MB.</p>
            <div
              className="dt-dropzone"
              onClick={() => fileInputRef.current.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) validateAndSetFile(f); }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current.click(); }}
            >
              Drag and drop, or click to choose a photo
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => e.target.files[0] && validateAndSetFile(e.target.files[0])}
            />
          </>
        ) : (
          <>
            <p className="photo-crop-hint">Adjust the crop area and zoom to get the best fit.</p>
            <div className="photo-crop-area">
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setCroppedAreaPixels(pixels)}
              />
            </div>

            <div className="photo-crop-zoom-row">
              <span>Zoom</span>
              <button type="button" className="photo-crop-zoom-btn" onClick={() => setZoom((z) => Math.max(1, z - 0.1))} aria-label="Zoom out">
                <Minus size={14} />
              </button>
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                aria-label="Zoom level"
              />
              <button type="button" className="photo-crop-zoom-btn" onClick={() => setZoom((z) => Math.min(3, z + 0.1))} aria-label="Zoom in">
                <Plus size={14} />
              </button>
            </div>

            <button
              type="button"
              className="photo-crop-choose-different"
              onClick={() => setImageSrc(null)}
              disabled={saving}
            >
              Choose a different photo
            </button>
          </>
        )}

        {error && <p className="dt-error">{error}</p>}

        <div className="dt-modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!imageSrc || saving}>
            {saving ? 'Saving...' : 'Save photo'}
          </button>
        </div>
      </div>
    </div>
  );
}
