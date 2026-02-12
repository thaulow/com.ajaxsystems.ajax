'use strict';

import { createHash } from 'crypto';
import {
  SignalLevel,
  DeviceCategory,
  MOTION_SENSOR_TYPES,
  CONTACT_SENSOR_TYPES,
  SMOKE_DETECTOR_TYPES,
  WATER_DETECTOR_TYPES,
  GLASS_BREAK_TYPES,
  SIREN_TYPES,
  SMART_PLUG_TYPES,
  BUTTON_TYPES,
  AIR_QUALITY_TYPES,
  KEYPAD_TYPES,
  RANGE_EXTENDER_TYPES,
  TRANSMITTER_TYPES,
  WATERSTOP_TYPES,
  AjaxDevice,
  ArmingState,
} from './types';

/**
 * Hash a password with SHA-256 as required by the Ajax API.
 */
export function hashPassword(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

/**
 * Convert Ajax signal level to percentage (0-100).
 * Handles string enums (STRONG/NORMAL/GOOD/WEAK/NONE/NO_SIGNAL) and numeric values.
 */
export function signalLevelToPercent(level?: SignalLevel | string | number): number | null {
  if (level === undefined || level === null) return null;

  // Numeric signal level (some proxy responses return a number 0-3 or 0-100)
  if (typeof level === 'number') {
    if (level <= 3) {
      return Math.round((level / 3) * 100);
    }
    return Math.min(100, Math.max(0, level));
  }

  switch (String(level).toUpperCase()) {
    case 'STRONG': return 100;
    case 'GOOD': return 80;
    case 'NORMAL': return 66;
    case 'WEAK': return 25;
    case 'NONE':
    case 'NO_SIGNAL': return 0;
    default: return null;
  }
}

/**
 * Normalize a device type string for matching.
 * Ajax API returns types in various formats (CamelCase, UPPER_SNAKE, etc.)
 */
export function normalizeDeviceType(deviceType: string): string {
  return deviceType
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/\s+/g, '_')
    .toUpperCase();
}

/**
 * Categorize a device based on its device type string.
 */
export function categorizeDevice(deviceType: string): DeviceCategory {
  const normalized = normalizeDeviceType(deviceType);

  if ((MOTION_SENSOR_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'motion_sensor';
  if ((CONTACT_SENSOR_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'contact_sensor';
  if ((SMOKE_DETECTOR_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'smoke_detector';
  if ((WATER_DETECTOR_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'water_detector';
  if ((GLASS_BREAK_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'glass_break_detector';
  if ((SIREN_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'siren';
  if ((SMART_PLUG_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'smart_plug';
  if ((BUTTON_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'button';
  if ((AIR_QUALITY_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'air_quality';
  if ((KEYPAD_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'keypad';
  if ((RANGE_EXTENDER_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'range_extender';
  if ((TRANSMITTER_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'transmitter';
  if ((WATERSTOP_TYPES as readonly string[]).some(t => normalized.includes(t))) return 'smart_plug'; // WaterStop handled as smart plug

  return 'unknown';
}

/**
 * Parse the arming state from the Ajax API into structured data.
 */
export function parseArmingState(state: ArmingState | string): { armed: boolean; nightMode: boolean; partiallyArmed: boolean } {
  const s = (state || 'DISARMED').toUpperCase();
  const armed = s.includes('ARMED') && !s.includes('DISARMED');
  const nightMode = s.includes('NIGHT_MODE') && !s.endsWith('OFF');
  const partiallyArmed = s.includes('PARTIALLY');

  return { armed, nightMode, partiallyArmed };
}

/**
 * Map parsed arming state to Homey homealarm_state capability value.
 */
export function armingStateToHomey(state: ArmingState | string): string {
  const { armed, partiallyArmed } = parseArmingState(state);
  if (partiallyArmed) return 'partially_armed';
  if (armed) return 'armed';
  return 'disarmed';
}

/**
 * Extract motion state from a device model.
 */
export function isMotionDetected(device: AjaxDevice): boolean {
  const model = device.model || {};
  const state = (model.state || '').toUpperCase();
  return ['ACTIVE', 'ALARM', 'TRIGGERED'].includes(state) || model.motionDetected === true;
}

/**
 * Extract contact (door/window) open state.
 * Returns true when the contact is open (alarm state).
 */
export function isContactOpen(device: AjaxDevice): boolean {
  const model = device.model || {};
  return model.reedClosed === false;
}

/**
 * Extract extra contact state for DoorProtect Plus.
 */
export function isExtraContactOpen(device: AjaxDevice): boolean {
  const model = device.model || {};
  return model.extraContactClosed === false;
}

/**
 * Extract smoke alarm state.
 */
export function isSmokeDetected(device: AjaxDevice): boolean {
  const model = device.model || {};
  return model.smokeAlarmDetected === true;
}

/**
 * Extract heat alarm state.
 */
export function isHeatDetected(device: AjaxDevice): boolean {
  const model = device.model || {};
  return model.temperatureAlarmDetected === true || model.highTemperatureDiffDetected === true;
}

/**
 * Extract CO alarm state.
 */
export function isCODetected(device: AjaxDevice): boolean {
  const model = device.model || {};
  return model.coAlarmDetected === true;
}

/**
 * Extract water leak state.
 */
export function isWaterDetected(device: AjaxDevice): boolean {
  const model = device.model || {};
  return model.leakDetected === true || (model.state || '').toUpperCase() === 'LEAK';
}

/**
 * Extract glass break state.
 */
export function isGlassBreakDetected(device: AjaxDevice): boolean {
  const model = device.model || {};
  return model.glassBreak === true || (model.state || '').toUpperCase() === 'ALARM';
}

/**
 * Extract switch state for socket/relay devices.
 */
export function isSwitchOn(device: AjaxDevice): boolean {
  const model = device.model || {};
  const switchState = model.switchState ?? model.state ?? '';
  if (typeof switchState === 'boolean') return switchState;
  return String(switchState).toUpperCase() === 'ON';
}

/**
 * Extract tamper state.
 */
export function isTampered(device: AjaxDevice): boolean {
  if (device.tampered) return true;
  const model = device.model || {};
  return model.tamperState === 'OPEN' || model.tampered === true;
}

