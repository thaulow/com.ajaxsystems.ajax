'use strict';

// ============================================================
// Authentication
// ============================================================

export type AuthMode = 'user' | 'company' | 'proxy' | 'sia';
export type UserRole = 'USER' | 'PRO';

export interface LoginRequest {
  login: string;
  passwordHash: string;
  userRole: UserRole;
}

export interface LoginResponse {
  sessionToken: string;
  userId: string;
  refreshToken: string;
  sseUrl?: string; // proxy mode only
}

export interface RefreshRequest {
  userId: string;
  refreshToken: string;
}

export interface RefreshResponse {
  sessionToken: string;
  refreshToken: string;
  userId: string;
}

export interface AuthCredentials {
  mode: AuthMode;
  apiKey: string;
  // User mode
  email?: string;
  password?: string;
  userRole?: UserRole;
  // Company mode
  companyId?: string;
  companyToken?: string;
  // Proxy mode
  proxyUrl?: string;
  verifySsl?: boolean;
  // SIA mode
  siaPort?: number;
  siaAccountId?: string;
  siaEncryptionKey?: string;
}

// ============================================================
// SIA Configuration
// ============================================================

export interface SiaConfig {
  port: number;
  accountId: string;
  encryptionKey?: string;
}

export interface SessionState {
  sessionToken: string;
  refreshToken: string;
  userId: string;
  tokenCreatedAt: number;
  sseUrl?: string;
}

// ============================================================
// SQS Configuration
// ============================================================

export interface SqsConfig {
  awsAccessKeyId: string;
  awsSecretAccessKey: string;
  eventsQueueName: string;
  updatesQueueName: string;
  region?: string; // default: eu-west-1
}

// ============================================================
// Polling Configuration
// ============================================================

export interface PollingConfig {
  armedIntervalSeconds: number;   // default: 10
  disarmedIntervalSeconds: number; // default: 30
  doorSensorFastPoll: boolean;     // default: false
  doorSensorIntervalSeconds: number; // default: 5
}

// ============================================================
// Hub
// ============================================================

export type ArmingState =
  | 'DISARMED'
  | 'ARMED'
  | 'NIGHT_MODE'
  | 'ARMED_NIGHT_MODE_ON'
  | 'ARMED_NIGHT_MODE_OFF'
  | 'DISARMED_NIGHT_MODE_ON'
  | 'DISARMED_NIGHT_MODE_OFF'
  | 'PARTIALLY_ARMED'
  | 'PARTIALLY_ARMED_NIGHT_MODE_ON'
  | 'PARTIALLY_ARMED_NIGHT_MODE_OFF';

export type ArmingCommand = 'ARM' | 'DISARM' | 'NIGHT_MODE_ON' | 'NIGHT_MODE_OFF';

export type BatteryState = 'CHARGED' | 'DISCHARGED' | 'MALFUNCTION';

export type SignalLevel = 'NO_SIGNAL' | 'WEAK' | 'NORMAL' | 'STRONG';

export type HubSubtype =
  | 'HUB' | 'HUB_4G' | 'HUB_PLUS'
  | 'HUB_2' | 'HUB_2_4G' | 'HUB_2_PLUS'
  | 'HUB_HYBRID' | 'HUB_HYBRID_4G' | 'HUB_BP';

export interface AjaxHub {
  id: string;
  name: string;
  hubSubtype: HubSubtype;
  state: ArmingState;
  tampered: boolean;
  online: boolean;
  color?: string;
  externallyPowered: boolean;
  groupsEnabled: boolean;
  firmware: {
    version: string;
    newVersionAvailable: boolean;
    latestAvailableVersion?: string;
  };
  battery: {
    chargeLevelPercentage: number;
    state: BatteryState;
  };
  gsm?: {
    signalLevel: SignalLevel;
    networkStatus?: string;
  };
  wifi?: {
    signalLevel: SignalLevel;
    ssid?: string;
  };
  ethernet?: {
    enabled: boolean;
  };
  limits?: {
    rooms: number;
    groups: number;
    cameras: number;
    sensors: number;
    users: number;
  };
  warnings?: {
    hub: number;
    allDevices: number;
  };
  imageUrls?: {
    small?: string;
    medium?: string;
    big?: string;
  };
}

// ============================================================
// Group
// ============================================================

export type GroupState = 'ARMED' | 'DISARMED' | 'PARTIALLY_ARMED';

export interface AjaxGroup {
  id: string;
  name: string;
  state: GroupState;
  nightModeEnabled: boolean;
  deviceIds?: string[];
  imageUrls?: {
    small?: string;
    medium?: string;
    big?: string;
  };
}

// ============================================================
// Room
// ============================================================

export interface AjaxRoom {
  id: string;
  name: string;
}

// ============================================================
// Device
// ============================================================

export type DeviceCategory =
  | 'motion_sensor'
  | 'contact_sensor'
  | 'smoke_detector'
  | 'water_detector'
  | 'glass_break_detector'
  | 'siren'
  | 'smart_plug'
  | 'button'
  | 'air_quality'
  | 'keypad'
  | 'range_extender'
  | 'transmitter'
  | 'unknown';

export interface AjaxDevice {
  id: string;
  deviceName: string;
  deviceType: string;
  roomId?: string;
  roomName?: string;
  groupId?: string;
  online: boolean;
  batteryChargeLevelPercentage?: number;
  signalLevel?: SignalLevel;
  temperature?: number;
  tampered: boolean;
  firmware?: {
    version: string;
    newVersionAvailable?: boolean;
  };
  model: Record<string, any>; // Device-specific state data
}

// ============================================================
// Device Type Constants
// ============================================================

export const MOTION_SENSOR_TYPES = [
  'MOTION_PROTECT', 'MOTION_PROTECT_PLUS', 'MOTION_PROTECT_OUTDOOR',
  'MOTION_PROTECT_CURTAIN', 'MOTION_CAM', 'MOTION_CAM_OUTDOOR',
  'MOTION_CAM_PLUS', 'COMBO_PROTECT', 'DUAL_CURTAIN_OUTDOOR',
  'SUPERIOR', 'MOTION_PROTECT_FIBRA', 'MOTION_PROTECT_PLUS_FIBRA',
  'MOTION_PROTECT_CURTAIN_FIBRA', 'MOTION_CAM_FIBRA',
  'COMBO_PROTECT_FIBRA', 'SUPERIOR_FIBRA',
] as const;

export const CONTACT_SENSOR_TYPES = [
  'DOOR_PROTECT', 'DOOR_PROTECT_PLUS',
  'DOOR_PROTECT_FIBRA', 'DOOR_PROTECT_PLUS_FIBRA',
] as const;

export const SMOKE_DETECTOR_TYPES = [
  'FIRE_PROTECT', 'FIRE_PROTECT_PLUS', 'FIRE_PROTECT_2',
  'FIRE_PROTECT_FIBRA', 'FIRE_PROTECT_2_FIBRA',
  'MANUAL_CALL_POINT', 'MANUAL_CALL_POINT_FIBRA',
] as const;

export const WATER_DETECTOR_TYPES = [
  'LEAK_PROTECT', 'LEAK_PROTECT_FIBRA',
] as const;

export const GLASS_BREAK_TYPES = [
  'GLASS_PROTECT', 'GLASS_PROTECT_FIBRA',
] as const;

export const SIREN_TYPES = [
  'HOME_SIREN', 'HOME_SIREN_FIBRA',
  'STREET_SIREN', 'STREET_SIREN_DOUBLE_DECK',
  'STREET_SIREN_FIBRA', 'STREET_SIREN_DOUBLE_DECK_FIBRA',
] as const;

export const SMART_PLUG_TYPES = [
  'SOCKET', 'RELAY', 'WALL_SWITCH', 'LIGHT_SWITCH',
  'SOCKET_FIBRA', 'RELAY_FIBRA', 'WALL_SWITCH_FIBRA', 'LIGHT_SWITCH_FIBRA',
] as const;

export const BUTTON_TYPES = [
  'BUTTON', 'DOUBLE_BUTTON', 'SPACE_CONTROL',
] as const;

export const AIR_QUALITY_TYPES = [
  'LIFE_QUALITY', 'LIFE_QUALITY_FIBRA',
] as const;

export const KEYPAD_TYPES = [
  'KEY_PAD', 'KEY_PAD_PLUS', 'KEY_PAD_TOUCH_SCREEN',
  'KEY_PAD_FIBRA', 'KEY_PAD_PLUS_FIBRA', 'KEY_PAD_TOUCH_SCREEN_FIBRA',
] as const;

export const RANGE_EXTENDER_TYPES = [
  'RANGE_EXTENDER', 'RANGE_EXTENDER_2',
] as const;

export const TRANSMITTER_TYPES = [
  'TRANSMITTER', 'MULTI_TRANSMITTER', 'MULTI_TRANSMITTER_FIBRA',
] as const;

export const WATERSTOP_TYPES = [
  'WATER_STOP', 'WATER_STOP_FIBRA',
] as const;

// ============================================================
// Device Commands
// ============================================================

export type DeviceCommand = 'SWITCH_ON' | 'SWITCH_OFF';

export interface DeviceCommandRequest {
  command: DeviceCommand;
  deviceType: string;
}

export interface ArmingCommandRequest {
  command: ArmingCommand;
  ignoreProblems?: boolean;
}

// ============================================================
// Event (SQS / SSE)
// ============================================================

export type EventType =
  | 'ALARM' | 'ALARM_RECOVERED' | 'MALFUNCTION' | 'FUNCTION_RECOVERED'
  | 'SECURITY' | 'COMMON' | 'USER' | 'LIFECYCLE'
  | 'SYSTEM' | 'SMART_HOME_ACTUATOR' | 'SMART_HOME_ALARM'
  | 'SMART_HOME_ALARM_RECOVERED' | 'SMART_HOME_EVENT'
  | 'SMART_HOME_MALFUNCTION' | 'ALARM_WARNING';

export interface IntegrationEvent {
  recipient: {
    id: string;
    type: string;
  };
  event: {
    eventId: string;
    hubId: string;
    hubName: string;
    eventType: EventType;
    eventTypeV2?: string;
    eventCode?: string;
    sourceObjectType: string;
    sourceObjectId: string;
    sourceObjectName: string;
    sourceRoomId?: string;
    sourceRoomName?: string;
    timestamp: number;
    additionalDataV2?: Array<Record<string, any>>;
  };
}

export interface IntegrationUpdate {
  id: string;
  userId: string;
  hubId: string;
  updates: Record<string, any>;
  type: string;
}

// ============================================================
// Coordinator Data
// ============================================================

export interface HubData {
  hub: AjaxHub;
  devices: Map<string, AjaxDevice>;
  groups: Map<string, AjaxGroup>;
  rooms: Map<string, AjaxRoom>;
}

export interface CoordinatorData {
  hubs: Map<string, HubData>;
  lastUpdate: number;
}

// ============================================================
// Event Emitter Types
// ============================================================

export interface DeviceStateChange {
  hubId: string;
  deviceId: string;
  device: AjaxDevice;
}

export interface HubStateChange {
  hubId: string;
  hub: AjaxHub;
}

export interface GroupStateChange {
  hubId: string;
  groupId: string;
  group: AjaxGroup;
}

// ============================================================
// API Error
// ============================================================

export class AjaxApiError extends Error {
  public statusCode: number;
  public response?: any;

  constructor(message: string, statusCode: number, response?: any) {
    super(message);
    this.name = 'AjaxApiError';
    this.statusCode = statusCode;
    this.response = response;
  }
}

export class AjaxAuthError extends AjaxApiError {
  constructor(message: string, statusCode: number = 401, response?: any) {
    super(message, statusCode, response);
    this.name = 'AjaxAuthError';
  }
}

export class AjaxConnectionError extends AjaxApiError {
  constructor(message: string) {
    super(message, 0);
    this.name = 'AjaxConnectionError';
  }
}
