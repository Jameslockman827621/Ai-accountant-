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
    if (!calibration) {
      return {
        fieldName,
        originalConfidence: rawConfidence,
        calibratedConfidence: rawConfidence,
        reliabilityScore: 0.5,
      };
    }

    const params = (calibration.calibration_params as CalibrationParams) ?? {};
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
          const thresholds = params.isotonic.thresholds ?? [];
          const values = params.isotonic.values ?? [];
          if (thresholds.length > 0 && values.length > 0) {
            calibratedConfidence = this.isotonicRegression(rawConfidence, thresholds, values);
          }
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
      reliabilityScore: parseFloat((calibration.reliability_score ?? 0.5).toString()),
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
  private isotonicRegression(confidence: number, thresholds: number[], values: number[]): number {
    if (thresholds.length === 0 || values.length === 0) {
      return confidence;
    }

    const upperBound = Math.min(thresholds.length, values.length) - 1;
    if (upperBound <= 0) {
      return values[0] ?? confidence;
    }

    const firstThreshold = thresholds[0] ?? confidence;
    const lastThreshold = thresholds[upperBound] ?? confidence;
    const firstValue = values[0] ?? confidence;
    const lastValue = values[upperBound] ?? confidence;

    // Find the interval and interpolate
    if (confidence <= firstThreshold) {
      return firstValue;
    }
    if (confidence >= lastThreshold) {
      return lastValue;
    }

    const getValue = (index: number): number | undefined =>
      index >= 0 && index < values.length ? values[index] : undefined;

    for (let i = 0; i < upperBound; i++) {
      const startThreshold = thresholds[i];
      const endThreshold = thresholds[i + 1];
      if (startThreshold === undefined || endThreshold === undefined) {
        continue;
      }
      if (confidence >= startThreshold && confidence <= endThreshold) {
        // Linear interpolation
        const span = endThreshold - startThreshold || 1;
        const t = (confidence - startThreshold) / span;
        const startValue = getValue(i);
        const endValue = getValue(i + 1) ?? startValue;
        if (startValue === undefined || endValue === undefined) {
          return confidence;
        }
        return startValue + t * (endValue - startValue);
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
    const safeTemperature = temperature === 0 ? 1 : temperature;
    return 1 / (1 + Math.exp(-confidence / safeTemperature));
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
    _modelId: string,
    _fieldName: string,
    validationData: Array<{ predicted: number; actual: number }>
  ): Promise<{ type: CalibrationType; params: CalibrationParams; reliabilityScore: number }> {
    // Simplified calibration computation
    // In production, would use proper Platt scaling or isotonic regression algorithms

    // Compute reliability score (correlation between predicted and actual)
    const n = validationData.length;
    if (n === 0) {
      return {
        type: 'platt',
        params: { platt: { a: 1, b: 0 } },
        reliabilityScore: 0,
      };
    }
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

    const denom = Math.sqrt(denomPred * denomActual);
    const correlation = denom === 0 ? 0 : numerator / denom;
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
