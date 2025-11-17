import { db } from '@ai-accountant/database';
import { createLogger } from '@ai-accountant/shared-utils';
import { randomUUID } from 'crypto';

const logger = createLogger('calibration-service');

export type CalibrationType = 'platt' | 'isotonic' | 'temperature';

export interface CalibrationParams {
  platt?: {
    a: number; // Slope
    b: number; // Intercept
  };
  isotonic?: {
    thresholds: number[];
    values: number[];
  };
  temperature?: {
    temperature: number;
  };
}

export interface CalibrationResult {
  fieldName: string;
  originalConfidence: number;
  calibratedConfidence: number;
  reliabilityScore: number;
}

export class CalibrationService {
  /**
   * Calibrate field confidence using stored calibration parameters
   */
  async calibrateField(
    modelId: string,
    fieldName: string,
    rawConfidence: number
  ): Promise<CalibrationResult> {
    // Get calibration parameters
    const result = await db.query<{
      calibration_type: string;
      calibration_params: unknown;
      reliability_score: number;
    }>(
      `SELECT calibration_type, calibration_params, reliability_score
       FROM extraction_calibration
       WHERE model_id = $1 AND field_name = $2`,
      [modelId, fieldName]
    );

    if (result.rows.length === 0) {
      // No calibration available, return original
      return {
        fieldName,
        originalConfidence: rawConfidence,
        calibratedConfidence: rawConfidence,
        reliabilityScore: 0.5, // Default reliability
      };
    }

    const calibration = result.rows[0];
    const params = calibration.calibration_params as CalibrationParams;
    const calibrationType = calibration.calibration_type as CalibrationType;

    // Apply calibration
    let calibratedConfidence = rawConfidence;

    switch (calibrationType) {
      case 'platt':
        if (params.platt) {
          // Platt scaling: P(y=1|x) = 1 / (1 + exp(A * f(x) + B))
          // For calibration: calibrated = sigmoid(a * raw + b)
          calibratedConfidence = this.plattScaling(rawConfidence, params.platt.a, params.platt.b);
        }
        break;
      case 'isotonic':
        if (params.isotonic) {
          calibratedConfidence = this.isotonicRegression(
            rawConfidence,
            params.isotonic.thresholds,
            params.isotonic.values
          );
        }
        break;
      case 'temperature':
        if (params.temperature) {
          calibratedConfidence = this.temperatureScaling(
            rawConfidence,
            params.temperature.temperature
          );
        }
        break;
    }

    return {
      fieldName,
      originalConfidence: rawConfidence,
      calibratedConfidence,
      reliabilityScore: parseFloat(calibration.reliability_score.toString()),
    };
  }

  /**
   * Platt scaling calibration
   */
  private plattScaling(confidence: number, a: number, b: number): number {
    // Sigmoid: 1 / (1 + exp(-(a * confidence + b)))
    const z = a * confidence + b;
    return 1 / (1 + Math.exp(-z));
  }

  /**
   * Isotonic regression calibration
   */
  private isotonicRegression(
    confidence: number,
    thresholds: number[],
    values: number[]
  ): number {
    // Find the interval and interpolate
    if (confidence <= thresholds[0]) {
      return values[0];
    }
    if (confidence >= thresholds[thresholds.length - 1]) {
      return values[values.length - 1];
    }

    for (let i = 0; i < thresholds.length - 1; i++) {
      if (confidence >= thresholds[i] && confidence <= thresholds[i + 1]) {
        // Linear interpolation
        const t = (confidence - thresholds[i]) / (thresholds[i + 1] - thresholds[i]);
        return values[i] + t * (values[i + 1] - values[i]);
      }
    }

    return confidence; // Fallback
  }

  /**
   * Temperature scaling calibration
   */
  private temperatureScaling(confidence: number, temperature: number): number {
    // Softmax with temperature: exp(confidence / T) / sum(exp(confidences / T))
    // For binary: calibrated = sigmoid(confidence / T)
    return 1 / (1 + Math.exp(-confidence / temperature));
  }

  /**
   * Store calibration parameters
   */
  async storeCalibration(
    modelId: string,
    fieldName: string,
    calibrationType: CalibrationType,
    params: CalibrationParams,
    reliabilityScore: number,
    calibrationDataHash: string
  ): Promise<string> {
    const calibrationId = randomUUID();

    await db.query(
      `INSERT INTO extraction_calibration (
        id, model_id, field_name, calibration_type, calibration_params,
        reliability_score, calibration_data_hash, validated_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW(), NOW(), NOW())
      ON CONFLICT (model_id, field_name) DO UPDATE SET
        calibration_type = EXCLUDED.calibration_type,
        calibration_params = EXCLUDED.calibration_params,
        reliability_score = EXCLUDED.reliability_score,
        calibration_data_hash = EXCLUDED.calibration_data_hash,
        validated_at = NOW(),
        updated_at = NOW()`,
      [
        calibrationId,
        modelId,
        fieldName,
        calibrationType,
        JSON.stringify(params),
        reliabilityScore,
        calibrationDataHash,
      ]
    );

    logger.info('Calibration stored', { modelId, fieldName, calibrationType, reliabilityScore });

    return calibrationId;
  }

  /**
   * Compute calibration parameters from validation data
   */
  async computeCalibration(
    modelId: string,
    fieldName: string,
    validationData: Array<{ predicted: number; actual: number }>
  ): Promise<{ type: CalibrationType; params: CalibrationParams; reliabilityScore: number }> {
    // Simplified calibration computation
    // In production, would use proper Platt scaling or isotonic regression algorithms

    // Compute reliability score (correlation between predicted and actual)
    const n = validationData.length;
    const meanPred = validationData.reduce((sum, d) => sum + d.predicted, 0) / n;
    const meanActual = validationData.reduce((sum, d) => sum + d.actual, 0) / n;

    let numerator = 0;
    let denomPred = 0;
    let denomActual = 0;

    for (const d of validationData) {
      numerator += (d.predicted - meanPred) * (d.actual - meanActual);
      denomPred += Math.pow(d.predicted - meanPred, 2);
      denomActual += Math.pow(d.actual - meanActual, 2);
    }

    const correlation = numerator / Math.sqrt(denomPred * denomActual);
    const reliabilityScore = Math.max(0, Math.min(1, correlation));

    // Simple Platt scaling parameters (would be computed properly in production)
    const plattParams: CalibrationParams = {
      platt: {
        a: 1.0, // Would be computed from validation data
        b: 0.0, // Would be computed from validation data
      },
    };

    return {
      type: 'platt',
      params: plattParams,
      reliabilityScore,
    };
  }
}

export const calibrationService = new CalibrationService();
