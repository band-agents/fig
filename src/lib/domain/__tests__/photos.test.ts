import { describe, expect, it } from 'vitest';
import { MAX_PHOTOS, readPhotos } from '../photos';

/** A base64 payload of roughly `bytes` bytes. The content does not matter; the size does. */
const jpeg = (bytes = 900) => `data:image/jpeg;base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`;

describe('the photograph a customer attaches to a return', () => {
  it('reads a shrunk JPEG and keeps its type and size', () => {
    const [photo] = readPhotos([jpeg(1200)], { required: true });
    expect(photo.mime).toBe('image/jpeg');
    expect(photo.size).toBeGreaterThan(1000);
    expect(photo.bytes.startsWith('data:')).toBe(false);
  });

  it('takes a bare string or an object with a dataUrl, because both clients send one', () => {
    expect(readPhotos([jpeg()], { required: true })).toHaveLength(1);
    expect(readPhotos([{ dataUrl: jpeg() }], { required: true })).toHaveLength(1);
  });

  it('insists on one when the portal says it is required', () => {
    expect(() => readPhotos([], { required: true })).toThrow(/Add a photo/);
    expect(() => readPhotos(undefined, { required: true })).toThrow(/Add a photo/);
    expect(readPhotos([], { required: false })).toEqual([]);
  });

  it('believes the data URL about the type, not a field beside it', () => {
    expect(() => readPhotos([{ dataUrl: 'data:application/zip;base64,QQ==', mime: 'image/jpeg' }], { required: true })).toThrow(
      /JPEG, PNG or WebP/
    );
  });

  it('refuses what is not a data URL at all', () => {
    for (const bad of ['https://example.com/cat.jpg', 'data:image/jpeg,notbase64', '', 42, null]) {
      expect(() => readPhotos([bad], { required: true })).toThrow();
    }
  });

  it('refuses one that is too big to be a shrunk photo', () => {
    expect(() => readPhotos([jpeg(3_000_000)], { required: true })).toThrow(/too large/);
  });

  it('caps how many can come at once', () => {
    expect(() => readPhotos(Array.from({ length: MAX_PHOTOS + 1 }, () => jpeg()), { required: true })).toThrow(
      /up to 4 photos/
    );
  });
});
