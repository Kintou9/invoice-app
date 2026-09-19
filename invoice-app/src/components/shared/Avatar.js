import { useState, useEffect } from 'react';
import './Avatar.css';

function initialsOf(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || '') + (parts[1]?.[0] || parts[0]?.[1] || '')).toUpperCase();
}

/**
 * The single avatar implementation for the whole app — every place a user's
 * photo appears (sidebar, Team page, job assignments, activity feed,
 * comments) renders through this component rather than a one-off initials
 * span, so a real photo shows up everywhere automatically once it exists.
 */
export default function Avatar({ src, name, size = 'sm', variant = 'soft', className = '' }) {
  const [failed, setFailed] = useState(false);

  // A new src (e.g. after replacing the photo) should get a fresh chance
  // to load rather than staying stuck on a prior failure.
  useEffect(() => { setFailed(false); }, [src]);

  const showImage = src && !failed;

  return (
    <span
      className={`avatar avatar-${size} avatar-${variant} ${className}`}
      role="img"
      aria-label={name ? `${name}'s profile photo` : 'Profile photo'}
    >
      <span className="avatar-initials" aria-hidden="true">{initialsOf(name)}</span>
      {showImage && (
        <img
          className="avatar-img"
          src={src}
          alt=""
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
