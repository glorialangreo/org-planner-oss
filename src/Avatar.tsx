import { createContext, useContext, useEffect, useState } from 'react';
import { type Person } from '../shared/model';

export const EmbeddedAvatars = createContext<Record<string, string> | null>(null);

export function Avatar({ person, base }: { person: Person; base: string }) {
  const embedded = useContext(EmbeddedAvatars);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [person.avatarId]);
  return person.avatarId && !failed
    ? <img className="avatar" alt="" draggable={false} src={embedded ? embedded[person.avatarId] : `${base}/${person.avatarId}`} onError={() => setFailed(true)} />
    : <span className="avatar initials" aria-label={failed ? 'Photo unavailable' : 'No verified photo'}>{person.name.split(' ').map(n => n[0]).slice(0, 2).join('')}</span>;
}
