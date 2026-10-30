import { fileUrl } from '@shared/files';
import type { ImageRef } from '@/model/element';
import { currentBoardId } from '@/state/boardStore';
import { blobToDataUrl, prepareImage } from './images';
import { sha256Hex, uploadFile } from './uploads';

/**
 * On an account board the image is named by its hash and stored in R2 — it goes on
 * the board at once, with a blurred placeholder, and the upload carries on behind
 * it. The signed-out local board has no server, so the bytes stay in the document.
 */
export async function storeImage(blob: Blob): Promise<ImageRef> {
  const prepared = await prepareImage(blob);
  const { naturalWidth, naturalHeight, placeholder } = prepared;
  const boardId = currentBoardId();

  if (!boardId) {
    return { src: await blobToDataUrl(prepared.blob), naturalWidth, naturalHeight };
  }

  const fileId = await sha256Hex(prepared.blob);
  void uploadFile(fileId, boardId, prepared.blob);
  return { src: fileUrl(fileId), fileId, naturalWidth, naturalHeight, placeholder };
}
