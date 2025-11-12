import React, { useState } from 'react';
import { View, Text, StyleSheet, Button, Image } from 'react-native';
import { Camera } from 'react-native-camera';
import { useAuth } from '../hooks/useAuth';

export function ReceiptScanScreen() {
  const { token } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);

  const takePicture = async (camera: Camera) => {
    if (camera) {
      const options = { quality: 0.5, base64: true };
      const data = await camera.takePictureAsync(options);
      setImageUri(data.uri);
      setScanning(false);

      // Upload to backend
      uploadReceipt(data.uri);
    }
  };

  const uploadReceipt = async (uri: string) => {
    const formData = new FormData();
    formData.append('file', {
      uri,
      type: 'image/jpeg',
      name: 'receipt.jpg',
    } as any);

    try {
      const response = await fetch('/api/documents/upload', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      if (response.ok) {
        console.log('Receipt uploaded successfully');
      }
    } catch (error) {
      console.error('Failed to upload receipt', error);
    }
  };

  return (
    <View style={styles.container}>
      {scanning ? (
        <Camera
          style={styles.camera}
          type={Camera.Constants.Type.back}
          onBarCodeRead={() => {}}
        >
          <View style={styles.cameraOverlay}>
            <Button title="Take Picture" onPress={() => takePicture} />
            <Button title="Cancel" onPress={() => setScanning(false)} />
          </View>
        </Camera>
      ) : (
        <View>
          {imageUri && <Image source={{ uri: imageUri }} style={styles.image} />}
          <Button title="Scan Receipt" onPress={() => setScanning(true)} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: {
    flex: 1,
  },
  cameraOverlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    padding: 20,
  },
  image: {
    width: '100%',
    height: 300,
    resizeMode: 'contain',
  },
});
