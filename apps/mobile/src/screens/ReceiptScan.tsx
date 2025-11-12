import React, { useState } from 'react';
import { View, Text, Button, Image } from 'react-native';
import { Camera } from 'react-native-camera';

export function ReceiptScanScreen() {
  const [imageUri, setImageUri] = useState<string | null>(null);

  const takePicture = async (camera: Camera) => {
    const options = { quality: 0.5, base64: true };
    const data = await camera.takePictureAsync(options);
    setImageUri(data.uri);
    
    // Upload to API for OCR processing
    // await uploadReceipt(data.uri);
  };

  return (
    <View style={{ flex: 1 }}>
      <Camera
        style={{ flex: 1 }}
        type={Camera.Constants.Type.back}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
          <Button title="Capture Receipt" onPress={() => takePicture} />
        </View>
      </Camera>
      {imageUri && <Image source={{ uri: imageUri }} style={{ width: 200, height: 200 }} />}
    </View>
  );
}
