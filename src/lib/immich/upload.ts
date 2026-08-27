export interface ImmichUploadPayload {
  file: File;
  createdAt?: string;
  modifiedAt?: string;
  isFavorite?: string;
}

/**
 * FIELD ORDER IS PART OF THE CONTRACT: every metadata field goes in BEFORE
 * `assetData`.
 *
 * Immich parses the multipart body as a stream, so a field that arrives after
 * the file part can reach the DTO validator too late - which it answers with
 * `400 Validation failed: fileCreatedAt expected ISO 8601 datetime string,
 * received undefined` even though the client did send it (seen on prod, and
 * only on the simple <10MB path; the proxy's chunked path already appends the
 * metadata first). Immich's own SDK appends the file last for the same reason.
 */
export function buildImmichUploadFormData(
  formData: FormData,
  { file, createdAt, modifiedAt, isFavorite }: ImmichUploadPayload
): FormData {
  if (createdAt) {
    formData.append('fileCreatedAt', createdAt);
  }
  if (modifiedAt) {
    formData.append('fileModifiedAt', modifiedAt);
  }
  if (isFavorite !== undefined) {
    formData.append('isFavorite', isFavorite);
  }

  formData.append('assetData', file);

  return formData;
}
