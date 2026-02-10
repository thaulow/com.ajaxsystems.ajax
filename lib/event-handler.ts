'use strict';

import { AjaxCoordinator } from './ajax-coordinator';
import {
  IntegrationEvent,
  IntegrationUpdate,
  ArmingState,
} from './types';

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

      const hubId = event.event.hubId;
      const sourceType = event.event.sourceObjectType;
      const sourceId = event.event.sourceObjectId;
      const eventType = event.event.eventTypeV2 || event.event.eventType;

      // Handle security state changes (arm/disarm/night)
      if (eventType === 'SECURITY') {
        this.handleSecurityEvent(event, coordinator);
        return;
      }

      // Handle device alarms
      if (TRIGGER_EVENT_TYPES.includes(eventType)) {
        this.handleAlarmEvent(event, coordinator);
        return;
      }

      // Handle alarm recovery
      if (eventType === 'ALARM_RECOVERED' || eventType === 'SMART_HOME_ALARM_RECOVERED') {
        this.handleAlarmRecovery(event, coordinator);
        return;
      }

      // Handle device state updates
      if (eventType === 'SMART_HOME_ACTUATOR' || eventType === 'SMART_HOME_EVENT') {
        this.handleActuatorEvent(event, coordinator);
        return;
      }

      // Handle malfunctions
      if (eventType === 'MALFUNCTION' || eventType === 'SMART_HOME_MALFUNCTION') {
        this.handleMalfunctionEvent(event, coordinator);
        return;
      }

      // Handle lifecycle events
      if (eventType === 'LIFECYCLE') {
        this.handleLifecycleEvent(event, coordinator);
        return;
      }

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
    for (const [tag, state] of Object.entries(EVENT_TAG_TO_STATE)) {
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
