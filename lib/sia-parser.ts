'use strict';

/**
 * SIA DC-09 protocol parser.
 *
 * Parses SIA DC-09 messages (ANSI/SIA DC-09-2013) as sent by Ajax hubs
 * when configured to report to a monitoring station over IP.
 *
 * Supports:
 * - ADM-CID (Ademco Contact ID over SIA DC-09) - most common for Ajax
 * - SIA-DCS (SIA Data Communication Standard)
 * - NULL (heartbeat/supervision messages)
 *
 * Frame format:
 *   <LF><CRC><0LEN>"<MSG>"<TS><CR>
 *
 * Where:
 *   LF   = 0x0A
 *   CRC  = 4 hex chars, CRC-16/CCITT-FALSE of content between quotes
 *   0LEN = 4 hex chars, byte length of content between quotes
 *   MSG  = message payload
 *   TS   = optional timestamp _HH:MM:SS,MM-DD-YYYY
 *   CR   = 0x0D
 */

// ============================================================
// SIA Event Codes (SIA-DCS native 2-character codes)
// Mapped to equivalent CID codes for unified handling
// ============================================================

export const SIA_TO_CID: Record<string, { code: string; qualifier: number; category: string; description: string }> = {
  // Burglary
  'BA': { code: '130', qualifier: 1, category: 'burglary', description: 'Burglary alarm' },
  'BR': { code: '130', qualifier: 3, category: 'burglary', description: 'Burglary alarm restore' },
  'BB': { code: '570', qualifier: 1, category: 'bypass', description: 'Zone bypass' },
  'BU': { code: '570', qualifier: 3, category: 'bypass', description: 'Zone unbypass' },
  'BT': { code: '370', qualifier: 1, category: 'trouble', description: 'Burglary trouble' },
  'BJ': { code: '370', qualifier: 3, category: 'trouble', description: 'Burglary trouble restore' },

  // Fire
  'FA': { code: '110', qualifier: 1, category: 'fire', description: 'Fire alarm' },
  'FR': { code: '110', qualifier: 3, category: 'fire', description: 'Fire alarm restore' },
  'FT': { code: '373', qualifier: 1, category: 'trouble', description: 'Fire trouble' },
  'FJ': { code: '373', qualifier: 3, category: 'trouble', description: 'Fire trouble restore' },

  // Water
  'WA': { code: '153', qualifier: 1, category: 'water', description: 'Water alarm' },
  'WR': { code: '153', qualifier: 3, category: 'water', description: 'Water alarm restore' },
  'WT': { code: '153', qualifier: 1, category: 'trouble', description: 'Water trouble' },

  // Tamper
  'TA': { code: '137', qualifier: 1, category: 'tamper', description: 'Tamper alarm' },
  'TR': { code: '137', qualifier: 3, category: 'tamper', description: 'Tamper alarm restore' },
  'YA': { code: '144', qualifier: 1, category: 'tamper', description: 'Expansion tamper' },
  'YR': { code: '144', qualifier: 3, category: 'tamper', description: 'Expansion tamper restore' },
  'YT': { code: '145', qualifier: 1, category: 'tamper', description: 'Module tamper' },

  // Panic
  'PA': { code: '120', qualifier: 1, category: 'panic', description: 'Panic alarm' },
  'PR': { code: '120', qualifier: 3, category: 'panic', description: 'Panic alarm restore' },

  // Medical
  'MA': { code: '100', qualifier: 1, category: 'medical', description: 'Medical alarm' },
  'MR': { code: '100', qualifier: 3, category: 'medical', description: 'Medical alarm restore' },

  // Gas / CO
  'GA': { code: '151', qualifier: 1, category: 'gas', description: 'Gas alarm' },
  'GR': { code: '151', qualifier: 3, category: 'gas', description: 'Gas alarm restore' },
  'CA': { code: '162', qualifier: 1, category: 'co', description: 'CO detected' },
  'CF': { code: '162', qualifier: 3, category: 'co', description: 'CO restore' },

  // Arming / Disarming
  'CL': { code: '401', qualifier: 1, category: 'arming', description: 'Armed' },
  'OP': { code: '401', qualifier: 3, category: 'arming', description: 'Disarmed' },
  'NL': { code: '441', qualifier: 1, category: 'arming', description: 'Night mode armed' },
  'NO': { code: '441', qualifier: 3, category: 'arming', description: 'Night mode disarmed' },
  'CG': { code: '456', qualifier: 1, category: 'arming', description: 'Partial arm' },
  'OG': { code: '456', qualifier: 3, category: 'arming', description: 'Partial disarm' },

  // Trouble / System
  'AT': { code: '301', qualifier: 1, category: 'trouble', description: 'AC power loss' },
  'AR': { code: '301', qualifier: 3, category: 'trouble', description: 'AC power restore' },
  'LB': { code: '302', qualifier: 1, category: 'trouble', description: 'Low battery' },
  'LR': { code: '302', qualifier: 3, category: 'trouble', description: 'Low battery restore' },
  'YC': { code: '354', qualifier: 1, category: 'communication', description: 'Communication failure' },
  'YK': { code: '354', qualifier: 3, category: 'communication', description: 'Communication restore' },
  'XT': { code: '380', qualifier: 1, category: 'trouble', description: 'Sensor trouble' },
  'XR': { code: '380', qualifier: 3, category: 'trouble', description: 'Sensor trouble restore' },
  'XE': { code: '381', qualifier: 1, category: 'trouble', description: 'Sensor missing' },
  'XI': { code: '381', qualifier: 3, category: 'trouble', description: 'Sensor missing restore' },

  // Test / Supervision
  'RP': { code: '602', qualifier: 6, category: 'test', description: 'Automatic test' },
  'RX': { code: '601', qualifier: 6, category: 'test', description: 'Manual test' },
  'RS': { code: '305', qualifier: 6, category: 'test', description: 'System reset' },
};

// ============================================================
// Contact ID Event Codes
// ============================================================

export const CID_EVENT_CODES: Record<string, { category: string; description: string }> = {
  // Medical
  '100': { category: 'medical', description: 'Medical alarm' },
  '101': { category: 'medical', description: 'Personal emergency' },

  // Fire
  '110': { category: 'fire', description: 'Fire alarm' },
  '111': { category: 'fire', description: 'Smoke detected' },
  '112': { category: 'fire', description: 'Combustion detected' },
  '113': { category: 'fire', description: 'Water flow' },
  '114': { category: 'fire', description: 'Heat detected' },
  '115': { category: 'fire', description: 'Pull station' },
  '116': { category: 'fire', description: 'Duct alarm' },
  '117': { category: 'fire', description: 'Flame detected' },
  '118': { category: 'fire', description: 'Near alarm' },

  // Panic
  '120': { category: 'panic', description: 'Panic alarm' },
  '121': { category: 'panic', description: 'Duress alarm' },
  '122': { category: 'panic', description: 'Silent alarm' },
  '123': { category: 'panic', description: 'Audible alarm' },

  // Burglary
  '130': { category: 'burglary', description: 'Burglary alarm' },
  '131': { category: 'burglary', description: 'Perimeter alarm' },
  '132': { category: 'burglary', description: 'Interior alarm' },
  '133': { category: 'burglary', description: '24 Hour burglar' },
  '134': { category: 'burglary', description: 'Entry/exit alarm' },
  '135': { category: 'burglary', description: 'Day/night alarm' },
  '136': { category: 'burglary', description: 'Outdoor alarm' },
  '137': { category: 'tamper', description: 'Tamper alarm' },
  '138': { category: 'burglary', description: 'Near alarm' },
  '139': { category: 'burglary', description: 'Intrusion verifier' },

  // General alarm
  '140': { category: 'alarm', description: 'General alarm' },
  '141': { category: 'alarm', description: 'Polling loop open' },
  '142': { category: 'alarm', description: 'Polling loop short' },
  '143': { category: 'alarm', description: 'Expansion module failure' },
  '144': { category: 'tamper', description: 'Sensor tamper' },
  '145': { category: 'tamper', description: 'Module tamper' },

  // Non-burglary
  '150': { category: 'nonburglary', description: '24 Hour non-burglary' },
  '151': { category: 'gas', description: 'Gas detected' },
  '152': { category: 'nonburglary', description: 'Refrigeration' },
  '153': { category: 'water', description: 'Water leak' },
  '154': { category: 'water', description: 'Water leak' },
  '155': { category: 'nonburglary', description: 'Foil break' },
  '156': { category: 'nonburglary', description: 'Day trouble' },
  '157': { category: 'gas', description: 'Low gas level' },
  '158': { category: 'nonburglary', description: 'High temperature' },
  '159': { category: 'nonburglary', description: 'Low temperature' },

  // CO
  '162': { category: 'co', description: 'CO detected' },

  // Trouble
  '300': { category: 'trouble', description: 'System trouble' },
  '301': { category: 'trouble', description: 'AC power loss' },
  '302': { category: 'trouble', description: 'Low system battery' },
  '303': { category: 'trouble', description: 'RAM checksum bad' },
  '305': { category: 'trouble', description: 'System reset' },
  '306': { category: 'trouble', description: 'Programming changed' },
  '307': { category: 'trouble', description: 'Self-test failure' },
  '308': { category: 'trouble', description: 'System shutdown' },
  '309': { category: 'trouble', description: 'Battery test failure' },
  '311': { category: 'trouble', description: 'Battery missing' },
  '312': { category: 'trouble', description: 'Power supply overcurrent' },

  // Communication
  '350': { category: 'communication', description: 'Communication trouble' },
  '351': { category: 'communication', description: 'Telco line fault' },
  '353': { category: 'communication', description: 'Long range radio fault' },
  '354': { category: 'communication', description: 'Failure to communicate' },
  '355': { category: 'communication', description: 'Loss of radio supervision' },
  '356': { category: 'communication', description: 'Loss of central polling' },

  // Sensor trouble
  '370': { category: 'trouble', description: 'Protection loop trouble' },
  '371': { category: 'trouble', description: 'Protection loop open' },
  '372': { category: 'trouble', description: 'Protection loop short' },
  '373': { category: 'trouble', description: 'Fire loop trouble' },
  '380': { category: 'trouble', description: 'Sensor trouble' },
  '381': { category: 'trouble', description: 'Loss of supervision' },
  '382': { category: 'trouble', description: 'Sensor low sensitivity' },
  '383': { category: 'trouble', description: 'Sensor high sensitivity' },
  '384': { category: 'trouble', description: 'Date/time trouble' },

  // Open/Close (arm/disarm)
  '400': { category: 'arming', description: 'Open/Close' },
  '401': { category: 'arming', description: 'Armed by user' },
  '402': { category: 'arming', description: 'Group arm' },
  '403': { category: 'arming', description: 'Auto arm' },
  '404': { category: 'arming', description: 'Late to arm' },
  '405': { category: 'arming', description: 'Deferred arm' },
  '406': { category: 'arming', description: 'Cancel by user' },
  '407': { category: 'arming', description: 'Remote arm/disarm' },
  '408': { category: 'arming', description: 'Quick arm' },
  '409': { category: 'arming', description: 'Key switch arm' },
  '411': { category: 'arming', description: 'Callback requested' },
  '412': { category: 'arming', description: 'Download successful' },
  '413': { category: 'arming', description: 'Download unsuccessful' },

  // Night mode
  '441': { category: 'arming', description: 'Armed stay/night' },
  '442': { category: 'arming', description: 'Armed stay/instant' },

  // Bypass
  '456': { category: 'arming', description: 'Partial arm' },
  '570': { category: 'bypass', description: 'Zone bypass' },
  '571': { category: 'bypass', description: 'Fire bypass' },
  '572': { category: 'bypass', description: '24 Hour zone bypass' },
  '573': { category: 'bypass', description: 'Burg bypass' },
  '574': { category: 'bypass', description: 'Group bypass' },

  // Test/misc
  '601': { category: 'test', description: 'Manual trigger test' },
  '602': { category: 'test', description: 'Periodic test report' },
  '603': { category: 'test', description: 'Periodic test failure' },
  '604': { category: 'test', description: 'Fire test' },
  '605': { category: 'test', description: 'Status report' },
  '606': { category: 'test', description: 'Listen-in request' },
  '607': { category: 'test', description: 'Walk test mode' },
  '608': { category: 'test', description: 'Periodic test - system trouble' },
  '609': { category: 'test', description: 'Video transmitter active' },
  '616': { category: 'test', description: 'Point tested OK' },
  '621': { category: 'test', description: 'Event log reset' },
  '622': { category: 'test', description: 'Event log 50% full' },
  '623': { category: 'test', description: 'Event log 90% full' },
  '625': { category: 'test', description: 'Real-time clock changed' },
  '627': { category: 'test', description: 'Program mode entry' },
  '628': { category: 'test', description: 'Program mode exit' },
};

// ============================================================
// Types
// ============================================================

export interface SiaMessage {
  /** Raw message content between quotes */
  raw: string;
  /** Sequence number */
  sequence: string;
  /** Receiver number */
  receiver: string;
  /** Line prefix */
  linePrefix: string;
  /** Account number */
  account: string;
  /** Protocol type: ADM-CID, SIA-DCS, or NULL */
  protocol: string;
  /** Parsed CID event (if ADM-CID) */
  event?: CidEvent;
  /** Timestamp from the message (if present) */
  timestamp?: Date;
  /** Whether CRC was valid */
  crcValid: boolean;
}

export interface CidEvent {
  /** Event qualifier: 1=new event/opening, 3=restore/closing, 6=status */
  qualifier: number;
  /** 3-digit event code */
  code: string;
  /** Partition/group number */
  partition: number;
  /** Zone or user number */
  zone: number;
  /** Human-readable category */
  category: string;
  /** Human-readable description */
  description: string;
  /** Whether this is a restore (qualifier 3) */
  isRestore: boolean;
}

// ============================================================
// CRC-16/CCITT-FALSE
// ============================================================

function crc16ccitt(data: Buffer): number {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= (data[i] << 8);
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
      } else {
        crc = (crc << 1) & 0xFFFF;
      }
    }
  }
  return crc;
}

// ============================================================
// Parser
// ============================================================

/**
 * Parse a SIA DC-09 frame from raw TCP data.
 * Returns null if the data is not a valid SIA message.
 */
export function parseSiaMessage(data: Buffer): SiaMessage | null {
  const str = data.toString('ascii').trim();

  // Find the quoted content: everything between first and last quote
  const firstQuote = str.indexOf('"');
  const lastQuote = str.lastIndexOf('"');
  if (firstQuote === -1 || lastQuote === -1 || firstQuote === lastQuote) {
    return null;
  }

  const content = str.substring(firstQuote + 1, lastQuote);

  // Extract CRC (4 hex chars before the length field)
  // Format: <LF><CRC><0LEN>"<content>"<timestamp><CR>
  // The CRC and length are before the first quote
  const prefix = str.substring(0, firstQuote);
  // Remove leading LF/whitespace
  const cleanPrefix = prefix.replace(/^[\n\r\s]+/, '');

  let crcStr = '';
  let lenStr = '';
  if (cleanPrefix.length >= 8) {
    crcStr = cleanPrefix.substring(0, 4);
    lenStr = cleanPrefix.substring(4, 8);
  } else if (cleanPrefix.length >= 4) {
    // Some implementations send just CRC+LEN without leading 0
    crcStr = cleanPrefix.substring(0, 4);
    lenStr = cleanPrefix.substring(4);
  }

  // Validate CRC
  const contentBuf = Buffer.from(`"${content}"`, 'ascii');
  const expectedCrc = crc16ccitt(contentBuf);
  const receivedCrc = parseInt(crcStr, 16);
  const crcValid = !isNaN(receivedCrc) && receivedCrc === expectedCrc;

  // Extract timestamp if present (after closing quote)
  const afterQuote = str.substring(lastQuote + 1).trim();
  let timestamp: Date | undefined;
  const tsMatch = afterQuote.match(/_(\d{2}):(\d{2}):(\d{2}),(\d{2})-(\d{2})-(\d{4})/);
  if (tsMatch) {
    const [, hh, mm, ss, MM, DD, YYYY] = tsMatch;
    timestamp = new Date(
      parseInt(YYYY), parseInt(MM) - 1, parseInt(DD),
      parseInt(hh), parseInt(mm), parseInt(ss),
    );
  }

  // Strip encryption indicator (* prefix) for parsing
  // SIA DC-09 uses * before protocol name to indicate unencrypted messages
  let cleanContent = content;
  if (cleanContent.startsWith('*')) {
    cleanContent = cleanContent.substring(1);
  }

  // Parse protocol and fields (handles all protocols including NULL)
  let protocol = '';
  let sequence = '';
  let receiver = '';
  let linePrefix = '';
  let account = '';
  let eventData = '';

  // Handle bare NULL (heartbeat with no account/fields)
  if (cleanContent === 'NULL' || cleanContent === 'NULL[]') {
    return {
      raw: content,
      sequence: '',
      receiver: '',
      linePrefix: '',
      account: '',
      protocol: 'NULL',
      timestamp,
      crcValid,
    };
  }

  // Try standard SIA DC-09 format with quotes as separators
  // Handles all protocols: SIA-DCS, ADM-CID, NULL (with fields)
  const siaMatch = cleanContent.match(
    /^(SIA-DCS|ADM-CID|NULL)"(\w*)"(R\w*)"(L\w*)"#([\w]+)\[([^\]]*)\]?$/,
  );
  if (siaMatch) {
    [, protocol, sequence, receiver, linePrefix, account, eventData] = siaMatch;
  } else {
    // Try alternate formats with | separators
    const altMatch = cleanContent.match(
      /^(SIA-DCS|ADM-CID|NULL)\|?"?(\w*)"?\|?(R\w*)\|?"?(L\w*)"?\|?#([\w]+)\[([^\]]*)\]?$/,
    );
    if (altMatch) {
      [, protocol, sequence, receiver, linePrefix, account, eventData] = altMatch;
    } else {
      // Try loose parse - just extract what we can
      const looseProto = cleanContent.match(/^(SIA-DCS|ADM-CID|NULL)/);
      protocol = looseProto ? looseProto[1] : 'UNKNOWN';

      const acctMatch = cleanContent.match(/#([\w]+)/);
      account = acctMatch ? acctMatch[1] : '';

      const dataMatch = cleanContent.match(/\[([^\]]*)\]/);
      eventData = dataMatch ? dataMatch[1] : '';

      const seqMatch = cleanContent.match(/"(\d+)"/);
      sequence = seqMatch ? seqMatch[1] : '';

      const recvMatch = cleanContent.match(/(R[\w]+)/);
      receiver = recvMatch ? recvMatch[1] : 'R0';

      const lpMatch = cleanContent.match(/(L[\w]+)/);
      linePrefix = lpMatch ? lpMatch[1] : 'L0';
    }
  }

  // Parse CID event data if ADM-CID
  let event: CidEvent | undefined;
  if (protocol === 'ADM-CID' && eventData) {
    event = parseCidEvent(eventData);
  } else if (protocol === 'SIA-DCS' && eventData) {
    // SIA-DCS can contain CID-like data or native SIA event codes
    // Try CID format first, then SIA event codes
    const cidFromSia = parseCidEvent(eventData);
    if (cidFromSia) {
      event = cidFromSia;
    } else {
      const siaEvent = parseSiaEventData(eventData);
      if (siaEvent) {
        event = siaEvent;
      }
    }
  }

  return {
    raw: content,
    sequence,
    receiver,
    linePrefix,
    account,
    protocol,
    event,
    timestamp,
    crcValid,
  };
}

/**
 * Parse Contact ID event data.
 *
 * CID format within SIA: #ACCT|QCCCGG ZZZ
 * Or: QCCCGGZZZ (compact)
 * Or: Nri01/QCCCGGZZZ
 *
 * Q = qualifier (1=event, 3=restore, 6=status)
 * CCC = event code (3 digits)
 * GG = partition/group (2 digits)
 * ZZZ = zone/user (3 digits)
 */
function parseCidEvent(data: string): CidEvent | null {
  // Strip account prefix if present
  let cleaned = data.replace(/^#?\w+\|/, '');

  // Strip SIA routing prefix (Nri01/ etc.)
  cleaned = cleaned.replace(/^N\w+\//, '');

  // Try to match CID format: Q CCC GG ZZZ (with or without spaces)
  const cidMatch = cleaned.match(/([136])(\d{3})(\d{2})(\d{3})/);
  if (!cidMatch) {
    // Try with spaces
    const spacedMatch = cleaned.match(/([136])\s*(\d{3})\s*(\d{2})\s*(\d{3})/);
    if (!spacedMatch) return null;

    const [, q, code, gg, zzz] = spacedMatch;
    return buildCidEvent(parseInt(q), code, parseInt(gg), parseInt(zzz));
  }

  const [, q, code, gg, zzz] = cidMatch;
  return buildCidEvent(parseInt(q), code, parseInt(gg), parseInt(zzz));
}

/**
 * Parse SIA-DCS native event data (2-character SIA event codes).
 *
 * SIA-DCS event data formats:
 *   #ACCT|Nri01/CL001    (with account and routing)
 *   Nri01/CL001          (with routing)
 *   N/CL001              (minimal routing)
 *   CL001                (bare code + zone)
 *
 * Where CL = 2-char SIA code, 001 = zone/user number
 */
function parseSiaEventData(data: string): CidEvent | null {
  // Strip account prefix if present (e.g., #001234|)
  let cleaned = data.replace(/^#?\w*\|/, '');

  // Strip routing prefix (e.g., Nri01/, N/, Nri00/)
  cleaned = cleaned.replace(/^N[\w]*\//, '');

  // Match SIA event code: 2 uppercase alpha chars followed by optional digits
  const siaMatch = cleaned.match(/^([A-Z]{2})(\d{0,4})/);
  if (!siaMatch) return null;

  const [, siaCode, zoneStr] = siaMatch;
  const mapping = SIA_TO_CID[siaCode];
  if (!mapping) return null;

  const zone = zoneStr ? parseInt(zoneStr) : 0;

  return {
    qualifier: mapping.qualifier,
    code: mapping.code,
    partition: 0,
    zone,
    category: mapping.category,
    description: mapping.description,
    isRestore: mapping.qualifier === 3,
  };
}

function buildCidEvent(qualifier: number, code: string, partition: number, zone: number): CidEvent {
  const eventInfo = CID_EVENT_CODES[code] || { category: 'unknown', description: `Unknown (${code})` };

  return {
    qualifier,
    code,
    partition,
    zone,
    category: eventInfo.category,
    description: eventInfo.description,
    isRestore: qualifier === 3,
  };
}

// ============================================================
// ACK Builder
// ============================================================

/**
 * Build a SIA DC-09 ACK response for a received message.
 */
export function buildSiaAck(message: SiaMessage): Buffer {
  const ts = new Date();
  const timestamp = `_${pad2(ts.getHours())}:${pad2(ts.getMinutes())}:${pad2(ts.getSeconds())},${pad2(ts.getMonth() + 1)}-${pad2(ts.getDate())}-${ts.getFullYear()}`;

  let ackContent: string;
  if (message.sequence || message.account) {
    // Full ACK with all fields (works for all protocols including NULL with fields)
    ackContent = `ACK"${message.sequence}"${message.receiver}"${message.linePrefix}"#${message.account}[]`;
  } else {
    // Simple ACK for bare NULL messages without fields
    ackContent = 'ACK';
  }

  const contentWithQuotes = `"${ackContent}"`;
  const crc = crc16ccitt(Buffer.from(contentWithQuotes, 'ascii'));
  const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');
  const lenHex = contentWithQuotes.length.toString(16).toUpperCase().padStart(4, '0');

  const frame = `\n${crcHex}${lenHex}${contentWithQuotes}${timestamp}\r`;
  return Buffer.from(frame, 'ascii');
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

// ============================================================
// CID Code Helpers
// ============================================================

/**
 * Determine if a CID event code represents an arm event.
 */
export function isArmEvent(code: string): boolean {
  const armCodes = ['400', '401', '402', '403', '407', '408', '409'];
  return armCodes.includes(code);
}

/**
 * Determine if a CID event code represents a night/stay arm event.
 */
export function isNightArmEvent(code: string): boolean {
  return code === '441' || code === '442';
}

/**
 * Determine if a CID event code represents a partial arm event.
 */
export function isPartialArmEvent(code: string): boolean {
  return code === '456';
}

/**
 * Determine if a CID event code represents an alarm.
 */
export function isAlarmEvent(code: string): boolean {
  const num = parseInt(code);
  return num >= 100 && num < 200;
}

/**
 * Determine if a CID event code is a fire alarm.
 */
export function isFireAlarm(code: string): boolean {
  const num = parseInt(code);
  return num >= 110 && num < 120;
}

/**
 * Determine if a CID event code is a burglary/intrusion alarm.
 */
export function isBurglaryAlarm(code: string): boolean {
  const num = parseInt(code);
  return num >= 130 && num < 140;
}

/**
 * Determine if a CID event code is a water leak alarm.
 */
export function isWaterAlarm(code: string): boolean {
  return code === '153' || code === '154';
}

/**
 * Determine if a CID event code is a tamper alarm.
 */
export function isTamperAlarm(code: string): boolean {
  return code === '137' || code === '144' || code === '145';
}

/**
 * Determine if a CID event code is a trouble condition.
 */
export function isTroubleEvent(code: string): boolean {
  const num = parseInt(code);
  return num >= 300 && num < 400;
}

/**
 * Determine if a CID event code is a test/supervision.
 */
export function isTestEvent(code: string): boolean {
  const num = parseInt(code);
  return num >= 600 && num < 700;
}
