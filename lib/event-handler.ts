'use strict';

import { AjaxCoordinator } from './ajax-coordinator';
import {
  IntegrationEvent,
  IntegrationUpdate,
  ArmingState,
  ApiAlarmEvent,
  ApiAlarmType,
} from './types';
import { lookupEventCode, buildEventDescription } from './event-codes';

// Event tag to arming state mapping (from foXaCe integration)
const EVENT_TAG_TO_STATE: Record<string, ArmingState> = {
  ARM: 'ARMED',
  DISARM: 'DISARMED',
  NIGHT_MODE_ON: 'NIGHT_MODE',
  NIGHT_MODE_OFF: 'DISARMED',
  PARTIAL_ARM: 'PARTIALLY_ARMED',
};

// Event types that indicate a triggered device
const TRIGGER_EVENT_TYPES = [
  'ALARM', 'ALARM_WARNING', 'SMART_HOME_ALARM',
];

// Deduplication window in milliseconds
const DEDUP_WINDOW_MS = 5_000;

export class AjaxEventHandler {

  private log: (...args: any[]) => void;
  private error: (...args: any[]) => void;
  private processedEvents: Map<string, number> = new Map();

  constructor(log: (...args: any[]) => void, error: (...args: any[]) => void) {
    this.log = log;
    this.error = error;
  }

  /**
   * Handle an event from SQS or SSE.
   */
  handleEvent(rawEvent: any, coordinator: AjaxCoordinator): void {
    try {
      const event = this.parseEvent(rawEvent);
      if (!event) return;

      // Deduplication
      const eventKey = event.event.eventId;
      if (this.isDuplicate(eventKey)) return;

      this.log(`Event: ${event.event.eventType} from ${event.event.sourceObjectType} "${event.event.sourceObjectName}"`);

      const eventType = event.event.eventTypeV2 || event.event.eventType;

      // Handle security state changes (arm/disarm/night)
      if (eventType === 'SECURITY') {
        this.handleSecurityEvent(event, coordinator);
      }
      // Handle device alarms
      else if (TRIGGER_EVENT_TYPES.includes(eventType)) {
        this.handleAlarmEvent(event, coordinator);
      }
      // Handle alarm recovery
      else if (eventType === 'ALARM_RECOVERED' || eventType === 'SMART_HOME_ALARM_RECOVERED') {
        this.handleAlarmRecovery(event, coordinator);
      }
      // Handle device state updates
      else if (eventType === 'SMART_HOME_ACTUATOR' || eventType === 'SMART_HOME_EVENT') {
        this.handleActuatorEvent(event, coordinator);
      }
      // Handle malfunctions
      else if (eventType === 'MALFUNCTION' || eventType === 'SMART_HOME_MALFUNCTION' || eventType === 'FUNCTION_RECOVERED') {
        this.handleMalfunctionEvent(event, coordinator);
      }
      // Handle lifecycle events
      else if (eventType === 'LIFECYCLE') {
        this.handleLifecycleEvent(event, coordinator);
      }

      // Apply device state from event code (works regardless of arming state)
      this.applyEventCodeState(event, coordinator);

      // Always emit apiAlarmEvent for flow card triggers in API mode
      const apiAlarmEvent = this.buildApiAlarmEvent(event);
      coordinator.emit('apiAlarmEvent', apiAlarmEvent);

    } catch (err) {
      this.error('Error handling event:', (err as Error).message);
    }
  }

  /**
   * Handle an update from SQS updates queue.
   */
  handleUpdate(rawUpdate: any, coordinator: AjaxCoordinator): void {
    try {
      const update = rawUpdate as IntegrationUpdate;
      if (!update.hubId || !update.id) return;

      this.log(`Update for ${update.type} ${update.id} on hub ${update.hubId}`);

      // Apply update directly to coordinator data
      if (update.type === 'HUB') {
        coordinator.updateHubState(update.hubId, update.updates as any, 'sqs');
      } else {
        coordinator.updateDeviceState(update.hubId, update.id, { model: update.updates }, 'sqs');
      }
    } catch (err) {
      this.error('Error handling update:', (err as Error).message);
    }
  }

  // ============================================================
  // Event Type Handlers
  // ============================================================

  private handleSecurityEvent(event: IntegrationEvent, coordinator: AjaxCoordinator): void {
    const hubId = event.event.hubId;
    const eventCode = event.event.eventCode || '';
    const additionalData = event.event.additionalDataV2 || [];

    // Check for arming state change in event code or additional data
    // Sort by tag length descending so "DISARM" matches before "ARM",
    // "NIGHT_MODE_OFF" before "NIGHT_MODE_ON", etc.
    const sortedTags = Object.entries(EVENT_TAG_TO_STATE).sort((a, b) => b[0].length - a[0].length);
    for (const [tag, state] of sortedTags) {
      if (eventCode.includes(tag) || event.event.sourceObjectName?.toUpperCase().includes(tag)) {
        coordinator.updateHubState(hubId, { state }, 'sqs');

        // Also check for group-specific arming
        const groupData = additionalData.find(d => d.type === 'DISPLAY_GROUPS');
        if (groupData?.displayEventGroups) {
          for (const group of groupData.displayEventGroups) {
            coordinator.updateGroupState(hubId, group.groupId, { state: state as any }, 'sqs');
          }
        }
        return;
      }
    }

    // Fallback: trigger a full refresh
    coordinator.refresh().catch(err => this.error('Refresh after security event failed:', err));
  }

  private handleAlarmEvent(event: IntegrationEvent, coordinator: AjaxCoordinator): void {
    const hubId = event.event.hubId;
    const deviceId = event.event.sourceObjectId;

    // Determine the alarm type from additional data
    const alarmInfo = event.event.additionalDataV2?.find(d => d.type === 'CUSTOM_ALARM_TYPE_INFO');
    const alarmType = alarmInfo?.customAlarmType || 'UNKNOWN';

    this.log(`Alarm: ${alarmType} on device ${event.event.sourceObjectName}`);

    // Build partial model update based on alarm type
    const modelUpdate: Record<string, any> = {};
    switch (alarmType) {
      case 'BURGLARY_ALARM':
        modelUpdate.state = 'ALARM';
        modelUpdate.motionDetected = true;
        modelUpdate.reedClosed = false;
        break;
      case 'FIRE_ALARM':
        modelUpdate.smokeAlarmDetected = true;
        break;
      case 'PANIC_ALARM':
        modelUpdate.state = 'ALARM';
        break;
      case 'LEAK':
        modelUpdate.leakDetected = true;
        break;
      case 'GLASS_BREAK_ALARM':
        modelUpdate.glassBreak = true;
        break;
      case 'HIGH_TEMPERATURE_ALARM':
      case 'LOW_TEMPERATURE_ALARM':
        modelUpdate.temperatureAlarmDetected = true;
        break;
      case 'TAMPER':
        modelUpdate.tamperState = 'OPEN';
        break;
      default:
        modelUpdate.state = 'ALARM';
    }

    coordinator.updateDeviceState(hubId, deviceId, { model: modelUpdate }, 'sqs');
  }

  private handleAlarmRecovery(event: IntegrationEvent, coordinator: AjaxCoordinator): void {
    const hubId = event.event.hubId;
    const deviceId = event.event.sourceObjectId;

    // Reset alarm states
    const modelUpdate: Record<string, any> = {
      state: 'NORMAL',
      motionDetected: false,
      smokeAlarmDetected: false,
      temperatureAlarmDetected: false,
      coAlarmDetected: false,
      highTemperatureDiffDetected: false,
      leakDetected: false,
      glassBreak: false,
    };

    coordinator.updateDeviceState(hubId, deviceId, { model: modelUpdate }, 'sqs');
  }

  private handleActuatorEvent(event: IntegrationEvent, coordinator: AjaxCoordinator): void {
    const hubId = event.event.hubId;
    const deviceId = event.event.sourceObjectId;

    // Check event code for switch state
    const eventCode = event.event.eventCode || '';
    if (eventCode.includes('ON') || eventCode.includes('SWITCH_ON')) {
      coordinator.updateDeviceState(hubId, deviceId, { model: { switchState: 'ON' } }, 'sqs');
    } else if (eventCode.includes('OFF') || eventCode.includes('SWITCH_OFF')) {
      coordinator.updateDeviceState(hubId, deviceId, { model: { switchState: 'OFF' } }, 'sqs');
    }
  }

  private handleMalfunctionEvent(event: IntegrationEvent, coordinator: AjaxCoordinator): void {
    const hubId = event.event.hubId;
    const deviceId = event.event.sourceObjectId;

    // Extract malfunction type
    const malfunctionInfo = event.event.additionalDataV2?.find(d => d.type === 'MALFUNCTION_INFO');
    if (malfunctionInfo) {
      this.log(`Malfunction: ${malfunctionInfo.malfunctionInfo} on ${event.event.sourceObjectName}`);
    }

    // Trigger a refresh for full state update
    coordinator.refresh().catch(err => this.error('Refresh after malfunction event failed:', err));
  }

  private handleLifecycleEvent(event: IntegrationEvent, coordinator: AjaxCoordinator): void {
    const hubId = event.event.hubId;
    const additionalData = event.event.additionalDataV2 || [];

    // Check for online/offline
    const connectionInfo = additionalData.find(d => d.type === 'HUB_CONNECTION_INFO');
    if (connectionInfo) {
      const online = connectionInfo.hubConnectionStatus === 'ONLINE';
      coordinator.updateHubState(hubId, { online } as any, 'sqs');
    }
  }

  // ============================================================
  // Event-code-based state updates (works regardless of arming state)
  // ============================================================

  /** Map of event codes to partial model updates for immediate device state. */
  private static readonly EVENT_CODE_STATE: Record<string, Record<string, any>> = {
    // DoorProtect
    'M_01_20': { reedClosed: false },
    'M_01_21': { reedClosed: true },
    'M_01_22': { extraContactClosed: false },
    'M_01_23': { extraContactClosed: true },
    // DoorProtect Plus
    'M_0F_20': { reedClosed: false },
    'M_0F_21': { reedClosed: true },
    'M_0F_22': { extraContactClosed: false },
    'M_0F_23': { extraContactClosed: true },
    // LeakProtect
    'M_05_20': { leakDetected: true },
    'M_05_21': { leakDetected: false },
    // GlassProtect
    'M_04_20': { glassBreak: true },
    // FireProtect
    'M_03_20': { smokeAlarmDetected: true },
    'M_03_21': { smokeAlarmDetected: false },
    'M_03_22': { temperatureAlarmDetected: true },
    'M_03_23': { temperatureAlarmDetected: false },
    'M_03_2A': { highTemperatureDiffDetected: true },
    'M_03_2B': { highTemperatureDiffDetected: false },
    // FireProtect Plus
    'M_09_20': { smokeAlarmDetected: true },
    'M_09_21': { smokeAlarmDetected: false },
    'M_09_22': { temperatureAlarmDetected: true },
    'M_09_23': { temperatureAlarmDetected: false },
    'M_09_2A': { highTemperatureDiffDetected: true },
    'M_09_2B': { highTemperatureDiffDetected: false },
    'M_09_30': { coAlarmDetected: true },
    'M_09_31': { coAlarmDetected: false },
  };

  private applyEventCodeState(event: IntegrationEvent, coordinator: AjaxCoordinator): void {
    const eventCode = (event.event.eventCode || '').toUpperCase();
    const deviceId = event.event.sourceObjectId;
    const hubId = event.event.hubId;
    if (!eventCode || !deviceId) return;

    const modelUpdate = AjaxEventHandler.EVENT_CODE_STATE[eventCode];
    if (modelUpdate) {
      coordinator.updateDeviceState(hubId, deviceId, { model: { ...modelUpdate } }, 'sse');
    }
  }

  // ============================================================
  // API Alarm Event Builder
  // ============================================================

  private buildApiAlarmEvent(event: IntegrationEvent): ApiAlarmEvent {
    const ev = event.event;
    const eventCode = ev.eventCode || '';
    const eventType = ev.eventTypeV2 || ev.eventType;
    const codeInfo = lookupEventCode(eventCode);
    const additionalData = ev.additionalDataV2 || [];

    // Resolve alarm type through priority chain
    let alarmType: ApiAlarmType = 'unknown';
    let category: string | undefined;

    // 1. Try event code table category
    if (codeInfo) {
      alarmType = this.categoryToAlarmType(codeInfo.category, codeInfo.isRestore);
      category = codeInfo.category;
    }
    // 2. Try additionalDataV2 CUSTOM_ALARM_TYPE_INFO
    else {
      const alarmInfo = additionalData.find((d: any) => d.type === 'CUSTOM_ALARM_TYPE_INFO');
      if (alarmInfo?.customAlarmType) {
        const mapped = this.customAlarmTypeToAlarmType(alarmInfo.customAlarmType);
        alarmType = mapped.type;
        category = mapped.category;
      }
      // 3. Fallback to eventType
      else {
        const mapped = this.eventTypeToAlarmType(eventType, eventCode, additionalData);
        alarmType = mapped.type;
        category = mapped.category;
      }
    }

    // Build description
    const description = buildEventDescription(
      eventCode || undefined,
      eventType,
      ev.sourceObjectName || '',
      ev.sourceRoomName || undefined,
      ev.hubName || '',
    );

    return {
      hubId: ev.hubId,
      hubName: ev.hubName || '',
      type: alarmType,
      category,
      description,
      deviceName: ev.sourceObjectName || '',
      roomName: ev.sourceRoomName || '',
      eventType,
      eventCode: eventCode || undefined,
      timestamp: ev.timestamp || Date.now(),
    };
  }

  private categoryToAlarmType(category: string, isRestore: boolean): ApiAlarmType {
    switch (category) {
      case 'burglary': return isRestore ? 'alarm_restore' : 'alarm';
      case 'fire': return isRestore ? 'alarm_restore' : 'alarm';
      case 'water': return isRestore ? 'alarm_restore' : 'alarm';
      case 'gas': return isRestore ? 'alarm_restore' : 'alarm';
      case 'tamper': return 'tamper';
      case 'tamper_restore': return 'tamper_restore';
      case 'panic': return 'panic';
      case 'duress': return 'duress';
      case 'arm': return 'arm';
      case 'disarm': return 'disarm';
      case 'night_arm': return 'night_arm';
      case 'night_disarm': return 'night_disarm';
      case 'group_arm': return 'group_arm';
      case 'group_disarm': return 'group_disarm';
      case 'armed_with_faults': return 'armed_with_faults';
      case 'arming_failed': return 'arming_failed';
      case 'power_trouble': return 'power_trouble';
      case 'power_restore': return 'power_restore';
      case 'device_lost': return 'device_lost';
      case 'device_restore': return 'device_restore';
      case 'trouble': return 'trouble';
      case 'trouble_restore': return 'trouble_restore';
      case 'system': return 'system';
      case 'test': return 'test';
      default: return 'unknown';
    }
  }

  private customAlarmTypeToAlarmType(customType: string): { type: ApiAlarmType; category?: string } {
    switch (customType) {
      case 'BURGLARY_ALARM': return { type: 'alarm', category: 'burglary' };
      case 'FIRE_ALARM': return { type: 'alarm', category: 'fire' };
      case 'PANIC_ALARM': return { type: 'panic' };
      case 'LEAK': return { type: 'alarm', category: 'water' };
      case 'GLASS_BREAK_ALARM': return { type: 'alarm', category: 'burglary' };
      case 'HIGH_TEMPERATURE_ALARM':
      case 'LOW_TEMPERATURE_ALARM': return { type: 'alarm', category: 'fire' };
      case 'CO_ALARM': return { type: 'alarm', category: 'gas' };
      case 'TAMPER': return { type: 'tamper' };
      case 'DURESS': return { type: 'duress' };
      default: return { type: 'alarm' };
    }
  }

  private eventTypeToAlarmType(
    eventType: string,
    eventCode: string,
    additionalData: Array<Record<string, any>>,
  ): { type: ApiAlarmType; category?: string } {
    switch (eventType) {
      case 'ALARM':
      case 'ALARM_WARNING':
      case 'SMART_HOME_ALARM':
        return { type: 'alarm' };

      case 'ALARM_RECOVERED':
      case 'SMART_HOME_ALARM_RECOVERED':
        return { type: 'alarm_restore' };

      case 'MALFUNCTION':
      case 'SMART_HOME_MALFUNCTION':
        return { type: 'trouble' };

      case 'FUNCTION_RECOVERED':
        return { type: 'trouble_restore' };

      case 'SECURITY': {
        // Try to resolve arm/disarm from event code tags
        const code = eventCode.toUpperCase();
        if (code.includes('NIGHT_MODE_OFF') || code.includes('NIGHT_MODE_DEACTIVAT')) return { type: 'night_disarm' };
        if (code.includes('NIGHT_MODE')) return { type: 'night_arm' };
        if (code.includes('DISARM')) return { type: 'disarm' };
        if (code.includes('ARM')) return { type: 'arm' };
        return { type: 'system' };
      }

      case 'COMMON':
      case 'SMART_HOME_ACTUATOR':
      case 'SMART_HOME_EVENT':
        return { type: 'system' };

      case 'USER':
        return { type: 'system' };

      case 'LIFECYCLE':
        return { type: 'system' };

      default:
        return { type: 'unknown' };
    }
  }

  // ============================================================
  // Helpers
  // ============================================================

  private parseEvent(raw: any): IntegrationEvent | null {
    if (!raw) return null;

    // Unwrap SNS envelope if present
    let data = raw;
    if (typeof raw === 'string') {
      try {
        data = JSON.parse(raw);
      } catch {
        return null;
      }
    }

    // SNS wrapping
    if (data.Message && typeof data.Message === 'string') {
      try {
        data = JSON.parse(data.Message);
      } catch {
        return null;
      }
    }

    // Validate required fields
    if (!data.event?.hubId || !data.event?.eventId) {
      return null;
    }

    return data as IntegrationEvent;
  }

  private isDuplicate(eventId: string): boolean {
    const now = Date.now();

    // Clean old entries
    for (const [id, timestamp] of this.processedEvents) {
      if (now - timestamp > DEDUP_WINDOW_MS) {
        this.processedEvents.delete(id);
      }
    }

    if (this.processedEvents.has(eventId)) {
      return true;
    }

    this.processedEvents.set(eventId, now);
    return false;
  }
}
