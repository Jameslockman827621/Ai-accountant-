/**
 * Push Notifications Service
 */

import { createLogger } from '@ai-accountant/shared-utils';
import messaging from '@react-native-firebase/messaging';
import notifee, { AndroidImportance } from '@notifee/react-native';

const logger = createLogger('push-notifications');

export interface NotificationPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  type?: 'document_processed' | 'filing_due' | 'payment_received' | 'error' | 'info';
}

class PushNotificationService {
  private initialized = false;
  private fcmToken: string | null = null;

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Request permissions
      const authStatus = await messaging().requestPermission();
      const enabled =
        authStatus === messaging.AuthorizationStatus.AUTHORIZED ||
        authStatus === messaging.AuthorizationStatus.PROVISIONAL;

      if (!enabled) {
        logger.warn('Push notification permission not granted');
        return;
      }

      // Get FCM token
      this.fcmToken = await messaging().getToken();
      logger.info('FCM token obtained', { token: this.fcmToken?.substring(0, 20) });

      // Setup foreground message handler
      messaging().onMessage(async remoteMessage => {
        logger.info('Foreground message received', { messageId: remoteMessage.messageId });
        await this.displayNotification({
          title: remoteMessage.notification?.title || 'Notification',
          body: remoteMessage.notification?.body || '',
          data: remoteMessage.data as Record<string, unknown>,
        });
      });

      // Setup background message handler
      messaging().setBackgroundMessageHandler(async remoteMessage => {
        logger.info('Background message received', { messageId: remoteMessage.messageId });
      });

      // Setup notification opened handler
      messaging().onNotificationOpenedApp(remoteMessage => {
        logger.info('Notification opened', { messageId: remoteMessage.messageId });
        this.handleNotificationTap(remoteMessage.data);
      });

      // Check if app was opened from notification
      const initialNotification = await messaging().getInitialNotification();
      if (initialNotification) {
        logger.info('App opened from notification', { messageId: initialNotification.messageId });
        this.handleNotificationTap(initialNotification.data);
      }

      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize push notifications', error);
    }
  }

  async displayNotification(payload: NotificationPayload): Promise<void> {
    try {
      // Create Android channel
      const channelId = await notifee.createChannel({
        id: 'default',
        name: 'Default Channel',
        importance: AndroidImportance.HIGH,
      });

      await notifee.displayNotification({
        title: payload.title,
        body: payload.body,
        android: {
          channelId,
          importance: AndroidImportance.HIGH,
          pressAction: {
            id: 'default',
          },
        },
        data: payload.data,
      });

      logger.info('Notification displayed', { title: payload.title });
    } catch (error) {
      logger.error('Failed to display notification', error);
    }
  }

  async scheduleNotification(
    payload: NotificationPayload,
    triggerDate: Date
  ): Promise<string> {
    try {
      const channelId = await notifee.createChannel({
        id: 'scheduled',
        name: 'Scheduled Notifications',
        importance: AndroidImportance.HIGH,
      });

      const notificationId = await notifee.createTriggerNotification(
        {
          title: payload.title,
          body: payload.body,
          android: {
            channelId,
            importance: AndroidImportance.HIGH,
          },
          data: payload.data,
        },
        {
          type: 1, // TIMESTAMP
          timestamp: triggerDate.getTime(),
        }
      );

      logger.info('Notification scheduled', { notificationId, triggerDate });
      return notificationId;
    } catch (error) {
      logger.error('Failed to schedule notification', error);
      throw error;
    }
  }

  async cancelNotification(notificationId: string): Promise<void> {
    try {
      await notifee.cancelNotification(notificationId);
      logger.info('Notification cancelled', { notificationId });
    } catch (error) {
      logger.error('Failed to cancel notification', error);
    }
  }

  async cancelAllNotifications(): Promise<void> {
    try {
      await notifee.cancelAllNotifications();
      logger.info('All notifications cancelled');
    } catch (error) {
      logger.error('Failed to cancel all notifications', error);
    }
  }

  getFCMToken(): string | null {
    return this.fcmToken;
  }

  private handleNotificationTap(data?: Record<string, unknown>): void {
    if (!data) {
      return;
    }

    const type = data.type as string;
    const id = data.id as string;

    // Navigate based on notification type
    switch (type) {
      case 'document_processed':
        // Navigate to document detail
        break;
      case 'filing_due':
        // Navigate to filing
        break;
      case 'payment_received':
        // Navigate to payment
        break;
      default:
        // Navigate to dashboard
        break;
    }
  }
}

export const pushNotificationService = new PushNotificationService();
