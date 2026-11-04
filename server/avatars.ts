import dns from 'node:dns/promises';
import https from 'node:https';
import ipaddr from 'ipaddr.js';
import sharp from 'sharp';

const maxBytes = 3_000_000;
export class AvatarImportError extends Error {}

export function isPublicAddress(address: string) {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.parse(address);
  return parsed.range() === 'unicast' && (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3));
}

export async function downloadAvatar(value: string): Promise<Buffer> {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new AvatarImportError('Enter a valid public HTTPS image URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) {
    throw new AvatarImportError('Use a public HTTPS image URL without credentials or a custom port.');
  }
  const controller = new AbortController();
  const timedOut = new AvatarImportError('The image download timed out. Try another URL or upload the image.');
  const timeout = setTimeout(() => controller.abort(timedOut), 10_000);
  try {
    return await Promise.race([
      new Promise<never>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(timedOut), { once: true })),
      (async () => {
        const addresses = await dns.lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true, verbatim: true });
        controller.signal.throwIfAborted();
        if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
          throw new AvatarImportError('Private and local network image URLs are not supported. Upload the image instead.');
        }
        const target = addresses[0];
        return await new Promise<Buffer>((resolve, reject) => {
          // Pin the checked address while retaining the URL hostname for TLS and Host.
          const request = https.get(url, {
            agent: false, family: target.family, signal: controller.signal,
            lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
            headers: { Accept: 'image/png,image/jpeg,image/webp', 'Accept-Encoding': 'identity' },
          }, response => {
            const fail = (message: string) => response.destroy(new AvatarImportError(message));
            response.on('error', reject);
            if (response.statusCode !== 200) {
              fail('The URL did not return an image directly. Use a direct image URL without redirects, or upload the image.');
              return;
            }
            if (!['image/png', 'image/jpeg', 'image/webp'].includes(response.headers['content-type']?.split(';')[0].trim().toLowerCase() ?? '')) {
              fail('The URL must return a PNG, JPEG or WebP image.');
              return;
            }
            if (Number(response.headers['content-length']) > maxBytes) {
              fail('Choose an image under 3 MB.'); return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              size += chunk.length;
              if (size > maxBytes) { fail('Choose an image under 3 MB.'); return; }
              chunks.push(chunk);
            });
            response.on('end', () => {
              if (!response.complete) reject(new AvatarImportError('The image download was interrupted. Try again or upload the image.'));
              else resolve(Buffer.concat(chunks));
            });
          });
          request.on('error', reject);
        });
      })(),
    ]);
  } catch (error) {
    if (error instanceof AvatarImportError) throw error;
    throw new AvatarImportError('The image could not be downloaded. Check the URL and connection, or upload the image.');
  } finally { clearTimeout(timeout); }
}

export async function normalizeAvatar(input: Buffer) {
  try {
    if (!input.length || input.length > maxBytes) throw new Error('Invalid image size');
    const image = sharp(input, { limitInputPixels: 20_000_000, animated: false });
    const info = await image.metadata();
    if (!['png', 'jpeg', 'webp'].includes(info.format ?? '')) throw new Error('Unsupported image');
    return await image.rotate().resize(160, 160, { fit: 'cover', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
  } catch {
    throw new AvatarImportError('Choose a PNG, JPEG or WebP under 3 MB and 20 megapixels.');
  }
}
