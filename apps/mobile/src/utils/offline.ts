import AsyncStorage from '@react-native-async-storage/async-storage';

// Offline Mode Support
export class OfflineManager {
  async saveDocumentOffline(documentId: string, data: unknown): Promise<void> {
    await AsyncStorage.setItem(`document:${documentId}`, JSON.stringify(data));
  }

  async getOfflineDocuments(): Promise<unknown[]> {
    const keys = await AsyncStorage.getAllKeys();
    const documentKeys = keys.filter(k => k.startsWith('document:'));
    const documents = await AsyncStorage.multiGet(documentKeys);
    return documents.map(([_, value]) => value ? JSON.parse(value) : null);
  }

  async syncOfflineDocuments(): Promise<void> {
    const documents = await this.getOfflineDocuments();
    // Upload to server when online
    for (const doc of documents) {
      // await uploadDocument(doc);
    }
  }
}

export const offlineManager = new OfflineManager();
