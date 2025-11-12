import React, { useState, useRef } from 'react';
import { View, Text, Button, Image, StyleSheet, Alert } from 'react-native';
import { Camera } from 'react-native-camera';
import axios from 'axios';

export function ReceiptScanScreen({ navigation }: { navigation: unknown }) {
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const cameraRef = useRef<Camera>(null);

  const takePicture = async () => {
    if (!cameraRef.current) return;

    try {
      const options = { quality: 0.8, base64: true };
      const data = await cameraRef.current.takePictureAsync(options);
      setImageUri(data.uri);
      
      // Upload to API for OCR processing
      setProcessing(true);
      const formData = new FormData();
      formData.append('file', {
        uri: data.uri,
        type: 'image/jpeg',
        name: 'receipt.jpg',
      });

      // In production, use actual API endpoint
      // const response = await axios.post('/api/documents/upload', formData);
      // Alert.alert('Success', 'Receipt processed successfully');
      
      setProcessing(false);
    } catch (error) {
      Alert.alert('Error', 'Failed to process receipt');
      setProcessing(false);
    }
  };

  return (
    <View style={styles.container}>
      <Camera
        ref={cameraRef}
        style={styles.camera}
        type={Camera.Constants.Type.back}
      >
        <View style={styles.overlay}>
          <View style={styles.instructions}>
            <Text style={styles.instructionText}>
              Position receipt within frame
            </Text>
          </View>
          <Button
            title={processing ? 'Processing...' : 'Capture Receipt'}
            onPress={takePicture}
            disabled={processing}
          />
        </View>
      </Camera>
      {imageUri && (
        <View style={styles.preview}>
          <Image source={{ uri: imageUri }} style={styles.previewImage} />
          <Text style={styles.previewText}>Receipt captured</Text>
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
  overlay: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingBottom: 50,
  },
  instructions: {
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    borderRadius: 5,
    marginBottom: 20,
  },
  instructionText: {
    color: 'white',
    fontSize: 16,
  },
  preview: {
    position: 'absolute',
    bottom: 100,
    left: 20,
    right: 20,
    backgroundColor: 'white',
    padding: 10,
    borderRadius: 10,
  },
  previewImage: {
    width: '100%',
    height: 200,
    borderRadius: 5,
  },
  previewText: {
    marginTop: 10,
    textAlign: 'center',
  },
});
