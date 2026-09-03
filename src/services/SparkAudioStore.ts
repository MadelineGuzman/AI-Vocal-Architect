const DATABASE_NAME = 'cadenzai';
const STORE_NAME = 'spark-audio';
const DATABASE_VERSION = 1;

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(STORE_NAME)) {
      request.result.createObjectStore(STORE_NAME);
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const run = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = operation(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
};

export const SparkAudioStore = {
  put: (key: string, audio: Blob) => run('readwrite', store => store.put(audio, key)),
  get: (key: string) => run<Blob | undefined>('readonly', store => store.get(key)),
  remove: (key: string) => run('readwrite', store => store.delete(key)),
};
