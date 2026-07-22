(function () {
"use strict";

// Durable local storage for raw Spark audio. localStorage cannot hold audio
// blobs, so recorded clips live in IndexedDB keyed by Spark id. This is the
// local-first mirror of the future cloud (R2) store: the same audioRef contract
// ({ store, key }) will point at either backend. Metadata stays portable in the
// main state; only the bytes live here.

const DB_NAME = "cadenzai";
const STORE = "spark-audio";
const VERSION = 1;

function openDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("IndexedDB is unavailable in this browser.")); return; }
    const request = window.indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Audio storage is blocked by another open Cadenzai tab. Close the other tab and try again."));
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Audio store transaction aborted."));
    });
  } finally {
    db.close();
  }
}

async function putAudio(key, blob) {
  await withStore("readwrite", store => store.put(blob, key));
  return { store: "indexeddb", key };
}

function getAudio(key) {
  return withStore("readonly", store => store.get(key));
}

async function deleteAudio(key) {
  await withStore("readwrite", store => store.delete(key));
}

window.CadenzaiAudioStore = { putAudio, getAudio, deleteAudio };
})();
