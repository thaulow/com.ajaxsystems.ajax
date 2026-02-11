'use strict';

// ============================================================
// Event Code Translation Table
// Built from Ajax Enterprise API PDF Appendix A
// Format: M_XX_YY where XX = device type hex, YY = event signal
// ============================================================

export interface EventCodeInfo {
  description: string;
  category: string;
  isRestore: boolean;
}

// Category values used for mapping to ApiAlarmEvent.type:
//   'burglary' | 'fire' | 'water' | 'gas' | 'tamper' | 'tamper_restore'
//   'panic' | 'arm' | 'disarm' | 'night_arm' | 'night_disarm'
//   'group_arm' | 'group_disarm' | 'armed_with_faults' | 'arming_failed'
//   'power_trouble' | 'power_restore' | 'device_lost' | 'device_restore'
//   'trouble' | 'trouble_restore' | 'system' | 'duress'

const EVENT_CODES: Record<string, EventCodeInfo> = {
  // ── 01: DoorProtect ──────────────────────────────
  'M_01_20': { description: 'open', category: 'burglary', isRestore: false },
  'M_01_21': { description: 'closed', category: 'burglary', isRestore: true },
  'M_01_22': { description: 'external contact open', category: 'burglary', isRestore: false },
  'M_01_23': { description: 'external contact closed', category: 'burglary', isRestore: true },
  'M_01_24': { description: 'alarm is detected, roller shutter', category: 'burglary', isRestore: false },
  'M_01_25': { description: 'connection lost, roller shutter', category: 'device_lost', isRestore: false },
  'M_01_26': { description: 'connection restored, roller shutter', category: 'device_restore', isRestore: true },

  // ── 02: MotionProtect ─────────────────────────────
  'M_02_20': { description: 'motion detected', category: 'burglary', isRestore: false },

  // ── 03: FireProtect ───────────────────────────────
  'M_03_20': { description: 'smoke detected', category: 'fire', isRestore: false },
  'M_03_21': { description: 'no smoke detected', category: 'fire', isRestore: true },
  'M_03_22': { description: 'temperature above the threshold value', category: 'fire', isRestore: false },
  'M_03_23': { description: 'temperature below the threshold value', category: 'fire', isRestore: true },
  'M_03_24': { description: 'hardware failure', category: 'trouble', isRestore: false },
  'M_03_25': { description: 'reset after hardware failure', category: 'trouble_restore', isRestore: true },
  'M_03_26': { description: 'smoke chamber dirty', category: 'trouble', isRestore: false },
  'M_03_27': { description: 'smoke chamber clean', category: 'trouble_restore', isRestore: true },
  'M_03_28': { description: 'low reserve battery charge', category: 'power_trouble', isRestore: false },
  'M_03_29': { description: 'reserve battery charged', category: 'power_restore', isRestore: true },
  'M_03_2A': { description: 'rapid temperature rise detected', category: 'fire', isRestore: false },
  'M_03_2B': { description: 'rapid temperature rise stopped', category: 'fire', isRestore: true },
  'M_03_2C': { description: 'faulty detector', category: 'trouble', isRestore: false },
  'M_03_2D': { description: 'smoke chamber is OK', category: 'trouble_restore', isRestore: true },

  // ── 04: GlassProtect ──────────────────────────────
  'M_04_20': { description: 'glass break detected', category: 'burglary', isRestore: false },
  'M_04_22': { description: 'external contact open', category: 'burglary', isRestore: false },
  'M_04_23': { description: 'external contact closed', category: 'burglary', isRestore: true },

  // ── 05: LeakProtect ───────────────────────────────
  'M_05_20': { description: 'water leak detected', category: 'water', isRestore: false },
  'M_05_21': { description: 'no water leak detected', category: 'water', isRestore: true },

  // ── 06: MotionProtectCurtain ──────────────────────
  'M_06_20': { description: 'motion detected', category: 'burglary', isRestore: false },
  'M_06_22': { description: 'masking detected', category: 'tamper', isRestore: false },
  'M_06_23': { description: 'masking is not detected', category: 'tamper_restore', isRestore: true },

  // ── 07: RangeExtender ─────────────────────────────
  'M_07_10': { description: 'updating firmware', category: 'system', isRestore: false },
  'M_07_11': { description: 'firmware updated successfully', category: 'system', isRestore: false },
  'M_07_20': { description: 'external power failure', category: 'power_trouble', isRestore: false },
  'M_07_21': { description: 'external power restored', category: 'power_restore', isRestore: true },

  // ── 08: CombiProtect ──────────────────────────────
  'M_08_20': { description: 'motion detected', category: 'burglary', isRestore: false },
  'M_08_21': { description: 'glass break detected', category: 'burglary', isRestore: false },

  // ── 09: FireProtectPlus ───────────────────────────
  'M_09_20': { description: 'smoke detected', category: 'fire', isRestore: false },
  'M_09_21': { description: 'no smoke detected', category: 'fire', isRestore: true },
  'M_09_22': { description: 'temperature above the threshold value', category: 'fire', isRestore: false },
  'M_09_23': { description: 'temperature below the threshold value', category: 'fire', isRestore: true },
  'M_09_24': { description: 'hardware failure', category: 'trouble', isRestore: false },
  'M_09_25': { description: 'reset after hardware failure', category: 'trouble_restore', isRestore: true },
  'M_09_26': { description: 'smoke chamber dirty', category: 'trouble', isRestore: false },
  'M_09_27': { description: 'smoke chamber clean', category: 'trouble_restore', isRestore: true },
  'M_09_28': { description: 'reserve battery low', category: 'power_trouble', isRestore: false },
  'M_09_29': { description: 'reserve battery charged', category: 'power_restore', isRestore: true },
  'M_09_2A': { description: 'rapid temperature rise detected', category: 'fire', isRestore: false },
  'M_09_2B': { description: 'rapid temperature rise stopped', category: 'fire', isRestore: true },
  'M_09_2C': { description: 'faulty detector', category: 'trouble', isRestore: false },
  'M_09_2D': { description: 'smoke chamber is OK', category: 'trouble_restore', isRestore: true },
  'M_09_30': { description: 'carbon monoxide (CO) detected', category: 'gas', isRestore: false },
  'M_09_31': { description: 'carbon monoxide (CO) level is OK', category: 'gas', isRestore: true },

  // ── 0A: Keypad ────────────────────────────────────
  'M_0A_20': { description: 'disarmed using keypad', category: 'disarm', isRestore: false },
  'M_0A_21': { description: 'armed using keypad', category: 'arm', isRestore: false },
  'M_0A_22': { description: 'night mode activated using keypad', category: 'night_arm', isRestore: false },
  'M_0A_23': { description: 'panic button pressed on keypad', category: 'panic', isRestore: false },
  'M_0A_24': { description: 'unsuccessful arming attempt using keypad', category: 'arming_failed', isRestore: false },
  'M_0A_25': { description: 'unsuccessful night mode activation attempt using keypad', category: 'arming_failed', isRestore: false },
  'M_0A_26': { description: 'armed with malfunctions using keypad', category: 'armed_with_faults', isRestore: false },
  'M_0A_27': { description: 'night mode activated with malfunctions using keypad', category: 'armed_with_faults', isRestore: false },
  'M_0A_28': { description: 'night mode deactivated using keypad', category: 'night_disarm', isRestore: false },
  'M_0A_29': { description: 'group disarmed using keypad', category: 'group_disarm', isRestore: false },
  'M_0A_2A': { description: 'group armed using keypad', category: 'group_arm', isRestore: false },
  'M_0A_2D': { description: 'group armed with malfunctions using keypad', category: 'armed_with_faults', isRestore: false },
  'M_0A_2E': { description: 'group unsuccessful arming attempt using keypad', category: 'arming_failed', isRestore: false },
  'M_0A_2F': { description: 'group disarmed using keypad', category: 'group_disarm', isRestore: false },
  'M_0A_30': { description: 'attempt to break the password on keypad', category: 'tamper', isRestore: false },
  'M_0A_31': { description: 'disarmed using keypad', category: 'disarm', isRestore: false },
  'M_0A_32': { description: 'night mode deactivated using keypad', category: 'night_disarm', isRestore: false },

  // ── 0B: SpaceControl ──────────────────────────────
  'M_0B_02': { description: 'battery charged', category: 'power_restore', isRestore: true },
  'M_0B_03': { description: 'low battery level', category: 'power_trouble', isRestore: false },
  'M_0B_20': { description: 'disarmed using remote', category: 'disarm', isRestore: false },
  'M_0B_21': { description: 'armed using remote', category: 'arm', isRestore: false },
  'M_0B_22': { description: 'night mode activated using remote', category: 'night_arm', isRestore: false },
  'M_0B_23': { description: 'panic button pressed on remote', category: 'panic', isRestore: false },
  'M_0B_24': { description: 'unsuccessful arming attempt using remote', category: 'arming_failed', isRestore: false },
  'M_0B_25': { description: 'unsuccessful night mode activation attempt using remote', category: 'arming_failed', isRestore: false },
  'M_0B_26': { description: 'armed with malfunctions using remote', category: 'armed_with_faults', isRestore: false },
  'M_0B_27': { description: 'night mode activated with malfunctions using remote', category: 'armed_with_faults', isRestore: false },
  'M_0B_28': { description: 'night mode deactivated using remote', category: 'night_disarm', isRestore: false },
  'M_0B_29': { description: 'group disarmed using remote', category: 'group_disarm', isRestore: false },
  'M_0B_2A': { description: 'group armed using remote', category: 'group_arm', isRestore: false },
  'M_0B_2D': { description: 'group armed with malfunctions using remote', category: 'armed_with_faults', isRestore: false },
  'M_0B_2E': { description: 'group unsuccessful arming attempt using remote', category: 'arming_failed', isRestore: false },

  // ── 0C: Button ────────────────────────────────────
  'M_0C_20': { description: 'panic button pressed', category: 'panic', isRestore: false },

  // ── 0D: MotionCam ─────────────────────────────────
  'M_0D_20': { description: 'motion detected', category: 'burglary', isRestore: false },

  // ── 0E: MotionProtectPlus ─────────────────────────
  'M_0E_20': { description: 'motion detected', category: 'burglary', isRestore: false },

  // ── 0F: DoorProtectPlus ───────────────────────────
  'M_0F_20': { description: 'open', category: 'burglary', isRestore: false },
  'M_0F_21': { description: 'closed', category: 'burglary', isRestore: true },
  'M_0F_22': { description: 'external contact open', category: 'burglary', isRestore: false },
  'M_0F_23': { description: 'external contact closed', category: 'burglary', isRestore: true },
  'M_0F_24': { description: 'alarm is detected, roller shutter', category: 'burglary', isRestore: false },
  'M_0F_25': { description: 'connection lost, roller shutter', category: 'device_lost', isRestore: false },
  'M_0F_26': { description: 'connection restored, roller shutter', category: 'device_restore', isRestore: true },
  'M_0F_30': { description: 'shock detected', category: 'burglary', isRestore: false },
  'M_0F_31': { description: 'tilt detected', category: 'burglary', isRestore: false },
  'M_0F_32': { description: 'accelerometer malfunction', category: 'trouble', isRestore: false },
  'M_0F_33': { description: 'accelerometer is OK', category: 'trouble_restore', isRestore: true },

  // ── 11: Transmitter ───────────────────────────────
  'M_11_20': { description: 'alarm is detected', category: 'burglary', isRestore: false },
  'M_11_21': { description: 'recovered after alarm', category: 'burglary', isRestore: true },
  'M_11_22': { description: 'alarm is detected', category: 'burglary', isRestore: false },
  'M_11_26': { description: 'was moved', category: 'tamper', isRestore: false },

  // ── 12: Relay ─────────────────────────────────────
  'M_12_20': { description: 'disabled, overheated', category: 'trouble', isRestore: false },
  'M_12_21': { description: 'temperature is OK', category: 'trouble_restore', isRestore: true },
  'M_12_22': { description: 'enabled', category: 'system', isRestore: false },
  'M_12_23': { description: 'disabled', category: 'system', isRestore: false },
  'M_12_28': { description: 'disabled, maximum voltage threshold reached', category: 'trouble', isRestore: false },
  'M_12_29': { description: 'disabled, minimum voltage threshold reached', category: 'trouble', isRestore: false },
  'M_12_2A': { description: 'voltage is OK', category: 'trouble_restore', isRestore: true },
  'M_12_2C': { description: 'relay is not responding', category: 'trouble', isRestore: false },

  // ── 13: MotionProtectOutdoor ──────────────────────
  'M_13_20': { description: 'motion detected', category: 'burglary', isRestore: false },
  'M_13_22': { description: 'masking detected', category: 'tamper', isRestore: false },
  'M_13_23': { description: 'masking is not detected', category: 'tamper_restore', isRestore: true },
  'M_13_24': { description: 'external power failure', category: 'power_trouble', isRestore: false },
  'M_13_25': { description: 'external power restored', category: 'power_restore', isRestore: true },

  // ── 14: StreetSiren ───────────────────────────────
  'M_14_20': { description: 'was moved', category: 'tamper', isRestore: false },
  'M_14_21': { description: 'external power failure', category: 'power_trouble', isRestore: false },
  'M_14_22': { description: 'external power restored', category: 'power_restore', isRestore: true },

  // ── 15: HomeSiren ─────────────────────────────────
  // (No specific codes in PDF beyond ABS common codes)

  // ── 1E: Socket ────────────────────────────────────
  'M_1E_20': { description: 'disabled, overheated', category: 'trouble', isRestore: false },
  'M_1E_21': { description: 'temperature is OK', category: 'trouble_restore', isRestore: true },
  'M_1E_22': { description: 'enabled', category: 'system', isRestore: false },
  'M_1E_23': { description: 'disabled', category: 'system', isRestore: false },
  'M_1E_24': { description: 'disabled, short circuit', category: 'trouble', isRestore: false },
  'M_1E_25': { description: 'disabled, maximum current threshold reached', category: 'trouble', isRestore: false },
  'M_1E_26': { description: 'disabled, user-defined maximum current threshold reached', category: 'trouble', isRestore: false },
  'M_1E_27': { description: 'power usage is OK', category: 'trouble_restore', isRestore: true },
  'M_1E_28': { description: 'disabled, maximum voltage threshold reached', category: 'trouble', isRestore: false },
  'M_1E_29': { description: 'disabled, minimum voltage threshold reached', category: 'trouble', isRestore: false },
  'M_1E_2A': { description: 'voltage is OK', category: 'trouble_restore', isRestore: true },
  'M_1E_2C': { description: 'socket is not responding', category: 'trouble', isRestore: false },

  // ── 1F: WallSwitch ───────────────────────────────
  'M_1F_20': { description: 'disabled, overheated', category: 'trouble', isRestore: false },
  'M_1F_21': { description: 'temperature is OK', category: 'trouble_restore', isRestore: true },
  'M_1F_22': { description: 'enabled', category: 'system', isRestore: false },
  'M_1F_23': { description: 'disabled', category: 'system', isRestore: false },
  'M_1F_24': { description: 'relay stopped functioning', category: 'trouble', isRestore: false },
  'M_1F_25': { description: 'disabled, maximum current threshold reached', category: 'trouble', isRestore: false },
  'M_1F_26': { description: 'disabled, user-defined maximum current threshold reached', category: 'trouble', isRestore: false },
  'M_1F_27': { description: 'power usage is OK', category: 'trouble_restore', isRestore: true },
  'M_1F_28': { description: 'disabled, maximum voltage threshold reached', category: 'trouble', isRestore: false },
  'M_1F_29': { description: 'disabled, minimum voltage threshold reached', category: 'trouble', isRestore: false },
  'M_1F_2A': { description: 'voltage is OK', category: 'trouble_restore', isRestore: true },
  'M_1F_2C': { description: 'wall switch is not responding', category: 'trouble', isRestore: false },

  // ── 21: Hub ───────────────────────────────────────
  'M_21_00': { description: 'external power failure', category: 'power_trouble', isRestore: false },
  'M_21_01': { description: 'external power restored', category: 'power_restore', isRestore: true },
  'M_21_02': { description: 'battery low', category: 'power_trouble', isRestore: false },
  'M_21_03': { description: 'battery charged', category: 'power_restore', isRestore: true },
  'M_21_04': { description: 'lid open', category: 'tamper', isRestore: false },
  'M_21_05': { description: 'lid closed', category: 'tamper_restore', isRestore: true },
  'M_21_06': { description: 'GSM signal level poor', category: 'trouble', isRestore: false },
  'M_21_07': { description: 'GSM signal level OK', category: 'trouble_restore', isRestore: true },
  'M_21_08': { description: 'radio-frequency interference level is high', category: 'trouble', isRestore: false },
  'M_21_09': { description: 'radio-frequency interference level is OK', category: 'trouble_restore', isRestore: true },
  'M_21_0A': { description: 'hub is offline', category: 'device_lost', isRestore: false },
  'M_21_0B': { description: 'hub is online again', category: 'device_restore', isRestore: true },
  'M_21_0C': { description: 'turned off', category: 'system', isRestore: false },
  'M_21_10': { description: 'updating firmware', category: 'system', isRestore: false },
  'M_21_11': { description: 'firmware updated', category: 'system', isRestore: false },
  'M_21_12': { description: 'malfunction', category: 'trouble', isRestore: false },
  'M_21_13': { description: 'connection to the monitoring station is lost', category: 'trouble', isRestore: false },

  // ── 22: User ──────────────────────────────────────
  'M_22_00': { description: 'disarmed by user', category: 'disarm', isRestore: false },
  'M_22_01': { description: 'armed by user', category: 'arm', isRestore: false },
  'M_22_02': { description: 'night mode activated by user', category: 'night_arm', isRestore: false },
  'M_22_03': { description: 'pressed the panic button', category: 'panic', isRestore: false },
  'M_22_07': { description: 'new user has been added', category: 'system', isRestore: false },
  'M_22_08': { description: 'user has been removed', category: 'system', isRestore: false },
  'M_22_09': { description: 'allowed access to the hub settings', category: 'system', isRestore: false },
  'M_22_0A': { description: 'allowed permanent access to the hub settings', category: 'system', isRestore: false },
  'M_22_0B': { description: 'denied access to the hub settings', category: 'system', isRestore: false },
  'M_22_0D': { description: 'PRO user has requested access to the hub settings', category: 'system', isRestore: false },
  'M_22_24': { description: 'unsuccessful arming attempt by user', category: 'arming_failed', isRestore: false },
  'M_22_25': { description: 'unsuccessful night mode activation attempt by user', category: 'arming_failed', isRestore: false },
  'M_22_26': { description: 'armed with malfunctions by user', category: 'armed_with_faults', isRestore: false },
  'M_22_27': { description: 'night mode activated with malfunctions by user', category: 'armed_with_faults', isRestore: false },
  'M_22_28': { description: 'night mode deactivated by user', category: 'night_disarm', isRestore: false },
  'M_22_29': { description: 'group disarmed by user', category: 'group_disarm', isRestore: false },
  'M_22_2A': { description: 'group armed by user', category: 'group_arm', isRestore: false },
  'M_22_2D': { description: 'group armed with malfunctions by user', category: 'armed_with_faults', isRestore: false },
  'M_22_2E': { description: 'group unsuccessful arming attempt by user', category: 'arming_failed', isRestore: false },
  'M_22_2F': { description: 'group disarmed by user', category: 'group_disarm', isRestore: false },
  'M_22_31': { description: 'disarmed by user', category: 'disarm', isRestore: false },
  'M_22_32': { description: 'night mode deactivated by user', category: 'night_disarm', isRestore: false },

  // ── 23: Group ─────────────────────────────────────
  'M_23_08': { description: 'new group has been added', category: 'system', isRestore: false },
  'M_23_09': { description: 'group has been removed', category: 'system', isRestore: false },

  // ── 24: Room ──────────────────────────────────────
  'M_24_08': { description: 'room has been added', category: 'system', isRestore: false },
  'M_24_09': { description: 'room has been removed', category: 'system', isRestore: false },

  // ── 25: Camera ────────────────────────────────────
  'M_25_08': { description: 'new camera has been added', category: 'system', isRestore: false },
  'M_25_09': { description: 'camera has been removed', category: 'system', isRestore: false },

  // ── 26: Transmitter (external) ────────────────────
  'M_26_00': { description: 'lid open', category: 'tamper', isRestore: false },
  'M_26_01': { description: 'lid closed', category: 'tamper_restore', isRestore: true },
  'M_26_20': { description: 'alarm is detected', category: 'burglary', isRestore: false },
  'M_26_21': { description: 'recovered after alarm', category: 'burglary', isRestore: true },
  'M_26_22': { description: 'alarm is detected', category: 'burglary', isRestore: false },
  'M_26_23': { description: 'external contact is shorted out', category: 'trouble', isRestore: false },
  'M_26_24': { description: 'external contact is OK', category: 'trouble_restore', isRestore: true },

  // ── ABS: Common (all devices) ─────────────────────
  'M_ABS_00': { description: 'lid open', category: 'tamper', isRestore: false },
  'M_ABS_01': { description: 'lid closed', category: 'tamper_restore', isRestore: true },
  'M_ABS_02': { description: 'battery charged', category: 'power_restore', isRestore: true },
  'M_ABS_03': { description: 'low battery', category: 'power_trouble', isRestore: false },
  'M_ABS_04': { description: 'connection lost', category: 'device_lost', isRestore: false },
  'M_ABS_05': { description: 'connection restored', category: 'device_restore', isRestore: true },
  'M_ABS_06': { description: 'synchronization failure', category: 'trouble', isRestore: false },
  'M_ABS_07': { description: 'synchronization OK', category: 'trouble_restore', isRestore: true },
  'M_ABS_08': { description: 'has been added successfully', category: 'system', isRestore: false },
  'M_ABS_09': { description: 'has been removed', category: 'system', isRestore: false },
  'M_ABS_10': { description: 'updating firmware', category: 'system', isRestore: false },
  'M_ABS_11': { description: 'firmware updated successfully', category: 'system', isRestore: false },
  'M_ABS_12': { description: 'has detected a malfunction', category: 'trouble', isRestore: false },
  'M_ABS_13': { description: 'turned off', category: 'system', isRestore: false },
};

/**
 * Look up an event code (e.g. "M_03_20") and return its info.
 */
export function lookupEventCode(code: string): EventCodeInfo | undefined {
  if (!code) return undefined;
  // Normalize: ensure uppercase
  return EVENT_CODES[code.toUpperCase()];
}

/**
 * Build a human-readable event description from an event code and context.
 * Format: "description - sourceName (roomName)" or "description - sourceName" if no room.
 */
export function buildEventDescription(
  eventCode: string | undefined,
  eventType: string,
  sourceName: string,
  roomName: string | undefined,
  hubName: string,
): string {
  const codeInfo = eventCode ? lookupEventCode(eventCode) : undefined;
  const desc = codeInfo?.description || eventType.toLowerCase().replace(/_/g, ' ');

  const parts: string[] = [desc];
  if (sourceName) {
    parts.push(`- ${sourceName}`);
    if (roomName) {
      parts.push(`(${roomName})`);
    }
  }

  return parts.join(' ');
}
