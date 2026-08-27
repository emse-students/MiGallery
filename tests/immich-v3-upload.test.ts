import { describe, expect, it } from 'vitest';
import { buildImmichUploadFormData } from '../src/lib/immich/upload';

describe('Immich v3 upload helper', () => {
  it('omits legacy device fields while preserving supported metadata', async () => {
    const formData = new FormData();
    const file = new File(['hello'], 'hello.jpg', { type: 'image/jpeg' });
    const createdAt = '2026-07-06T12:00:00.000Z';
    const modifiedAt = '2026-07-06T12:05:00.000Z';

    buildImmichUploadFormData(formData, {
      file,
      createdAt,
      modifiedAt,
      isFavorite: 'false',
    });

    // Identity (`toBe(file)`) is NOT asserted: no specification says `FormData.get` returns the very
    // object that was appended, and it does not on every runtime - node hands back the same File,
    // bun an equivalent wrapper over the same bytes. What this test is actually for is that the file
    // reaches Immich unaltered, so it checks that: same kind, name, type, size and CONTENT. That is
    // a stronger claim than reference equality was making, and it holds on both runtimes.
    const assetData = formData.get('assetData');
    expect(assetData).toBeInstanceOf(File);
    const storedFile = assetData as File;
    expect(storedFile.name).toBe('hello.jpg');
    expect(storedFile.type).toBe('image/jpeg');
    expect(storedFile.size).toBe(file.size);
    expect(await storedFile.text()).toBe('hello');
    expect(formData.get('deviceId')).toBeNull();
    expect(formData.get('deviceAssetId')).toBeNull();
    expect(formData.get('fileCreatedAt')).toBe(createdAt);
    expect(formData.get('fileModifiedAt')).toBe(modifiedAt);
    expect(formData.get('isFavorite')).toBe('false');
  });
});
