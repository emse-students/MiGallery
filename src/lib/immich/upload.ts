export interface ImmichUploadPayload {
	file: File;
	createdAt?: string;
	modifiedAt?: string;
	isFavorite?: string;
}

export function buildImmichUploadFormData(
	formData: FormData,
	{ file, createdAt, modifiedAt, isFavorite }: ImmichUploadPayload
): FormData {
	formData.append('assetData', file);

	if (createdAt) {
		formData.append('fileCreatedAt', createdAt);
	}
	if (modifiedAt) {
		formData.append('fileModifiedAt', modifiedAt);
	}
	if (isFavorite !== undefined) {
		formData.append('isFavorite', isFavorite);
	}

	return formData;
}
