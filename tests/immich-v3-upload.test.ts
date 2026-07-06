import { describe, expect, it } from 'vitest';
import { buildImmichUploadFormData } from '../src/lib/immich/upload';

describe('Immich v3 upload helper', () => {
	it('omits legacy device fields while preserving supported metadata', () => {
		const formData = new FormData();
		const file = new File(['hello'], 'hello.jpg', { type: 'image/jpeg' });
		const createdAt = '2026-07-06T12:00:00.000Z';
		const modifiedAt = '2026-07-06T12:05:00.000Z';

		buildImmichUploadFormData(formData, {
			file,
			createdAt,
			modifiedAt,
			isFavorite: 'false'
		});

		expect(formData.get('assetData')).toBe(file);
		expect(formData.get('deviceId')).toBeNull();
		expect(formData.get('deviceAssetId')).toBeNull();
		expect(formData.get('fileCreatedAt')).toBe(createdAt);
		expect(formData.get('fileModifiedAt')).toBe(modifiedAt);
		expect(formData.get('isFavorite')).toBe('false');
	});
});
