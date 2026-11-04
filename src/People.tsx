import { useState } from 'react';
import { api } from './api';
import { personSchema, type Person } from '../shared/model';

export function PersonForm({ person, submit, action }: { person?: Person; submit: (person: Person) => boolean; action: string }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [photoSource, setPhotoSource] = useState<'upload' | 'url'>('upload');
  const [removePhoto, setRemovePhoto] = useState(false);
  return <form onSubmit={async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget);
    setError(''); setBusy(true);
    try {
      const result = personSchema.safeParse({ id: person?.id ?? (String(f.get('id')).trim() || crypto.randomUUID()),
        name: String(f.get('name')).trim(), title: String(f.get('title')).trim(),
        timezone: String(f.get('timezone')).trim() || null, avatarId: person?.avatarId ?? null, source: person?.source ?? 'Added in scenario' });
      if (!result.success) throw new Error(result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'));
      const next = result.data;
      const photo = f.get('photo');
      if (!removePhoto && photoSource === 'upload' && photo instanceof File && photo.size) {
        if (photo.size > 3_000_000) throw new Error('Choose a photo under 3 MB.');
        const bytes = new Uint8Array(await photo.arrayBuffer());
        let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte);
        next.avatarId = (await api<{ id: string }>('/avatars', 'POST', { base64: btoa(binary) })).id;
      }
      const url = String(f.get('photoUrl') ?? '').trim();
      if (!removePhoto && photoSource === 'url' && url) next.avatarId = (await api<{ id: string }>('/avatars', 'POST', { url })).id;
      if (removePhoto) next.avatarId = null;
      submit(next);
    } catch (e) { setError(e instanceof Error ? e.message : 'Person could not be saved. Check the fields.'); }
    finally { setBusy(false); }
  }}>
    {!person && <label>Person ID (optional)<input name="id" maxLength={100} pattern="[a-zA-Z0-9_-]+" /><small>Leave blank to generate a stable ID.</small></label>}
    {person && <p className="small">ID: {person.id}. IDs remain stable when names change.</p>}
    <label>Name<input name="name" required maxLength={150} defaultValue={person?.name} /></label>
    <label>Role<input name="title" maxLength={200} defaultValue={person?.title} /></label>
    <label>IANA timezone<input name="timezone" maxLength={100} placeholder="Asia/Tokyo" defaultValue={person?.timezone ?? ''} /></label>
    <fieldset className="photo-source" disabled={busy || removePhoto}>
      <legend>Photo (optional)</legend>
      <div className="photo-choices">
        <label><input type="radio" name="photoSource" value="upload" checked={photoSource === 'upload'} onChange={() => setPhotoSource('upload')} />Upload image</label>
        <label><input type="radio" name="photoSource" value="url" checked={photoSource === 'url'} onChange={() => setPhotoSource('url')} />Image URL</label>
      </div>
      {photoSource === 'upload' ? <label>Local photo<input name="photo" type="file" accept="image/png,image/jpeg,image/webp" /></label>
        : <><label>Image URL<input name="photoUrl" type="url" maxLength={2048} placeholder="https://example.com/photo.png" /></label>
          <p className="small">Use a direct public HTTPS image URL. Saving downloads it once. The image host receives a request from your computer. Redirects and private network URLs are not supported.</p></>}
    </fieldset>
    <p className="small">Initials are used by default. Photos are resized, stripped of metadata and saved locally for offline use.</p>
    {person?.avatarId && <label className="checkbox-label"><input type="checkbox" name="removePhoto" checked={removePhoto} onChange={e => setRemovePhoto(e.target.checked)} />Remove photo</label>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="primary" disabled={busy}>{busy ? 'Saving photo...' : action}</button>
  </form>;
}
