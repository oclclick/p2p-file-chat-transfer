const DB_NAME = 'p2p-sender-db';
const STORE_NAME = 'file-chunks';
const DB_VERSION = 1;

export function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('IndexedDB is only available in the browser'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB database'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

export async function saveChunk(
  transferId: string,
  chunkIndex: number,
  data: ArrayBuffer
): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const key = `${transferId}_${chunkIndex}`;

    const request = store.put(data, key);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to save chunk ${chunkIndex} for transfer ${transferId}`));
    };
  });
}

export async function getChunk(
  transferId: string,
  chunkIndex: number
): Promise<ArrayBuffer> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const key = `${transferId}_${chunkIndex}`;

    const request = store.get(key);

    request.onsuccess = () => {
      if (request.result === undefined) {
        reject(new Error(`Chunk ${chunkIndex} not found for transfer ${transferId}`));
      } else {
        resolve(request.result as ArrayBuffer);
      }
    };

    request.onerror = () => {
      reject(new Error(`Failed to retrieve chunk ${chunkIndex} for transfer ${transferId}`));
    };
  });
}

export async function clearTransfer(transferId: string, chunkCount: number): Promise<void> {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    // Delete chunks sequentially
    for (let i = 0; i < chunkCount; i++) {
      store.delete(`${transferId}_${i}`);
    }

    transaction.oncomplete = () => {
      resolve();
    };

    transaction.onerror = () => {
      reject(new Error(`Failed to clear chunks for transfer ${transferId}`));
    };
  });
}

export async function assembleFile(
  transferId: string,
  fileName: string,
  fileType: string,
  chunkCount: number,
  onProgress?: (progress: number) => void
): Promise<string> {
  const chunks: ArrayBuffer[] = [];
  const batchSize = 100; // Load chunks in batches to avoid blocking and memory spikes

  for (let i = 0; i < chunkCount; i += batchSize) {
    const currentBatchLimit = Math.min(i + batchSize, chunkCount);
    const batchPromises: Promise<ArrayBuffer>[] = [];

    for (let j = i; j < currentBatchLimit; j++) {
      batchPromises.push(getChunk(transferId, j));
    }

    const batchResults = await Promise.all(batchPromises);
    chunks.push(...batchResults);

    if (onProgress) {
      onProgress(Math.min(100, Math.round((currentBatchLimit / chunkCount) * 100)));
    }
  }

  // Combine chunks into a single Blob, mapping ArrayBuffers to Uint8Arrays 
  // to ensure absolute binary integrity across Safari, Firefox, and Chrome.
  const blob = new Blob(chunks.map(c => new Uint8Array(c)), { type: fileType || 'application/octet-stream' });
  return URL.createObjectURL(blob);
}
