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
  // ── Burglary / Intrusion ──────────────────────────────────────
  'BA': { code: '130', qualifier: 1, category: 'burglary', description: 'Burglary alarm' },
  'BR': { code: '130', qualifier: 3, category: 'burglary', description: 'Burglary alarm restore' },
  'BB': { code: '570', qualifier: 1, category: 'bypass', description: 'Zone bypass' },
  'BU': { code: '570', qualifier: 3, category: 'bypass', description: 'Zone unbypass' },
  'BT': { code: '370', qualifier: 1, category: 'trouble', description: 'Burglary trouble' },
  'BJ': { code: '370', qualifier: 3, category: 'trouble', description: 'Burglary trouble restore' },
  'BS': { code: '377', qualifier: 1, category: 'trouble', description: 'Accelerometer malfunction' },

  // ── Fire ───────────────────────────────────────────────────────
  'FA': { code: '110', qualifier: 1, category: 'fire', description: 'Fire alarm' },
  'FH': { code: '111', qualifier: 3, category: 'fire', description: 'Fire alarm restore' },
  'FR': { code: '110', qualifier: 3, category: 'fire', description: 'Fire alarm restore' },
  'FT': { code: '389', qualifier: 1, category: 'trouble', description: 'Fire sensor hardware failure' },
  'FJ': { code: '389', qualifier: 3, category: 'trouble', description: 'Fire sensor hardware restore' },
  'FS': { code: '393', qualifier: 1, category: 'trouble', description: 'Smoke chamber dirty' },
  'FX': { code: '393', qualifier: 3, category: 'trouble', description: 'Smoke chamber OK' },
  'KA': { code: '158', qualifier: 1, category: 'fire', description: 'High temperature alarm' },
  'KH': { code: '158', qualifier: 3, category: 'fire', description: 'Temperature restored' },

  // ── Water ──────────────────────────────────────────────────────
  'WA': { code: '154', qualifier: 1, category: 'water', description: 'Water leak detected' },
  'WH': { code: '154', qualifier: 3, category: 'water', description: 'Water leak restore' },
  'WR': { code: '154', qualifier: 3, category: 'water', description: 'Water leak restore' },

  // ── Tamper ─────────────────────────────────────────────────────
  'TA': { code: '145', qualifier: 1, category: 'tamper', description: 'Lid open / tamper' },
  'TR': { code: '145', qualifier: 3, category: 'tamper', description: 'Lid closed / tamper restore' },
  'SM': { code: '144', qualifier: 1, category: 'tamper', description: 'Device moved' },

  // ── Panic ──────────────────────────────────────────────────────
  'PA': { code: '120', qualifier: 1, category: 'panic', description: 'Panic alarm' },
  'PH': { code: '120', qualifier: 3, category: 'panic', description: 'Panic alarm restore' },

  // ── Medical ────────────────────────────────────────────────────
  'MA': { code: '100', qualifier: 1, category: 'medical', description: 'Medical alarm' },
  'MR': { code: '100', qualifier: 3, category: 'medical', description: 'Medical alarm restore' },

  // ── Gas / CO (Ajax uses GA for both gas and CO from FireProtect Plus) ─
  'GA': { code: '151', qualifier: 1, category: 'gas', description: 'Gas / CO alarm' },
  'GH': { code: '151', qualifier: 3, category: 'gas', description: 'Gas / CO alarm restore' },

  // ── Arming / Disarming (by user via app) ──────────────────────
  'CL': { code: '400', qualifier: 1, category: 'arming', description: 'Armed' },
  'OP': { code: '400', qualifier: 3, category: 'arming', description: 'Disarmed' },
  'NL': { code: '441', qualifier: 1, category: 'arming', description: 'Night mode armed' },
  'NP': { code: '441', qualifier: 3, category: 'arming', description: 'Night mode deactivated' },
  'NO': { code: '441', qualifier: 3, category: 'arming', description: 'Night mode disarmed (auto)' },

  // ── Group arming ──────────────────────────────────────────────
  'CG': { code: '402', qualifier: 1, category: 'arming', description: 'Group armed' },
  'OG': { code: '402', qualifier: 3, category: 'arming', description: 'Group disarmed' },

  // ── Auto arming (scenarios) ───────────────────────────────────
  'CA': { code: '403', qualifier: 1, category: 'arming', description: 'Armed automatically' },
  'OA': { code: '403', qualifier: 3, category: 'arming', description: 'Disarmed automatically' },
  'OB': { code: '403', qualifier: 3, category: 'arming', description: 'Group disarmed automatically' },
  'CB': { code: '403', qualifier: 1, category: 'arming', description: 'Group armed automatically' },
  'NC': { code: '403', qualifier: 1, category: 'arming', description: 'Night mode armed automatically' },

  // ── Armed with malfunctions ───────────────────────────────────
  'AF': { code: '401', qualifier: 1, category: 'arming', description: 'Armed with malfunctions' },
  'CF': { code: '409', qualifier: 1, category: 'arming', description: 'Armed with malfunctions (device)' },
  'NB': { code: '441', qualifier: 1, category: 'arming', description: 'Night mode armed with malfunctions' },
  'NF': { code: '441', qualifier: 1, category: 'arming', description: 'Night mode armed with malfunctions (device)' },

  // ── Unsuccessful arming ───────────────────────────────────────
  'CC': { code: '455', qualifier: 1, category: 'arming', description: 'Unsuccessful arming attempt' },
  'NE': { code: '455', qualifier: 1, category: 'arming', description: 'Unsuccessful night mode attempt' },
  'CD': { code: '455', qualifier: 1, category: 'arming', description: 'Unsuccessful group arming attempt' },

  // ── Duress (coerced disarm) ───────────────────────────────────
  'HA': { code: '423', qualifier: 1, category: 'duress', description: 'Disarmed under duress' },
  'ND': { code: '423', qualifier: 1, category: 'duress', description: 'Night mode deactivated under duress' },

  // ── Keypad / Auth ─────────────────────────────────────────────
  'JA': { code: '461', qualifier: 1, category: 'trouble', description: 'Password brute-force attempt' },

  // ── Power / Battery ───────────────────────────────────────────
  'AT': { code: '301', qualifier: 1, category: 'trouble', description: 'AC power loss' },
  'AR': { code: '301', qualifier: 3, category: 'trouble', description: 'AC power restore' },
  'YT': { code: '302', qualifier: 1, category: 'trouble', description: 'Low battery' },
  'YR': { code: '302', qualifier: 3, category: 'trouble', description: 'Battery charged' },
  'LB': { code: '302', qualifier: 1, category: 'trouble', description: 'Low battery' },
  'LR': { code: '302', qualifier: 3, category: 'trouble', description: 'Low battery restore' },
  'YM': { code: '311', qualifier: 1, category: 'trouble', description: 'Battery missing' },
  'YA': { code: '311', qualifier: 3, category: 'trouble', description: 'Battery connected' },
  'YP': { code: '337', qualifier: 1, category: 'trouble', description: 'External power failure' },
  'YQ': { code: '337', qualifier: 3, category: 'trouble', description: 'External power restored' },

  // ── Communication / Connection ────────────────────────────────
  'YC': { code: '350', qualifier: 1, category: 'communication', description: 'Hub offline' },
  'YK': { code: '350', qualifier: 3, category: 'communication', description: 'Hub online' },
  'YS': { code: '354', qualifier: 1, category: 'communication', description: 'CMS connection lost' },
  'XL': { code: '381', qualifier: 1, category: 'communication', description: 'Device connection lost' },
  'XC': { code: '381', qualifier: 3, category: 'communication', description: 'Device connection restored' },
  'PF': { code: '391', qualifier: 1, category: 'communication', description: 'Photo channel connection lost' },
  'PO': { code: '391', qualifier: 3, category: 'communication', description: 'Photo channel connection restored' },

  // ── Sensor / Device Trouble ───────────────────────────────────
  'XT': { code: '384', qualifier: 1, category: 'trouble', description: 'Sensor low battery' },
  'XR': { code: '384', qualifier: 3, category: 'trouble', description: 'Sensor battery charged' },
  'XQ': { code: '344', qualifier: 1, category: 'trouble', description: 'RF interference high' },
  'XH': { code: '344', qualifier: 3, category: 'trouble', description: 'RF interference OK' },

  // ── System Lifecycle ──────────────────────────────────────────
  'ZZ': { code: '308', qualifier: 1, category: 'system', description: 'System turned off' },
  'ZY': { code: '305', qualifier: 1, category: 'system', description: 'System switched on' },
  'XI': { code: '306', qualifier: 1, category: 'system', description: 'Factory reset' },
  'YG': { code: '627', qualifier: 6, category: 'system', description: 'Settings changed' },
  'RB': { code: '627', qualifier: 6, category: 'system', description: 'Firmware updating' },
  'RS': { code: '627', qualifier: 6, category: 'system', description: 'Firmware updated' },

  // ── Test / Supervision ────────────────────────────────────────
  'RP': { code: '602', qualifier: 6, category: 'test', description: 'Automatic test' },
  'RX': { code: '601', qualifier: 6, category: 'test', description: 'Manual test' },
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
  '308': { category: 'system', description: 'System shutdown' },
  '309': { category: 'trouble', description: 'Battery test failure' },
  '311': { category: 'trouble', description: 'Battery missing' },
  '312': { category: 'trouble', description: 'Power supply overcurrent' },
  '337': { category: 'trouble', description: 'External power failure' },
  '344': { category: 'trouble', description: 'RF interference' },

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
  '377': { category: 'trouble', description: 'Accelerometer malfunction' },
  '380': { category: 'trouble', description: 'Sensor trouble' },
  '381': { category: 'communication', description: 'Loss of supervision' },
  '382': { category: 'trouble', description: 'Sensor low sensitivity' },
  '383': { category: 'trouble', description: 'Sensor high sensitivity' },
  '384': { category: 'trouble', description: 'Sensor low battery' },
  '389': { category: 'trouble', description: 'Fire sensor hardware failure' },
  '391': { category: 'communication', description: 'Photo channel failure' },
  '393': { category: 'trouble', description: 'Smoke chamber dirty' },

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
  '423': { category: 'duress', description: 'Disarmed under duress' },
  '412': { category: 'arming', description: 'Download successful' },
  '413': { category: 'arming', description: 'Download unsuccessful' },

  // Night mode
  '441': { category: 'arming', description: 'Armed stay/night' },
  '442': { category: 'arming', description: 'Armed stay/instant' },

  '455': { category: 'arming', description: 'Unsuccessful arming attempt' },

  // Bypass
  '456': { category: 'arming', description: 'Partial arm' },
  '461': { category: 'trouble', description: 'Password brute-force attempt' },
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
// CRC-16/ARC (CRC-16-IBM)
// Polynomial 0x8005 (reflected: 0xA001), initial value 0x0000
// This is what Ajax hubs and standard SIA DC-09 implementations use.
// ============================================================

function crc16arc(data: Buffer): number {
  let crc = 0;
  for (let i = 0; i < data.length; i++) {
    let temp = data[i];
    for (let j = 0; j < 8; j++) {
      temp ^= crc & 1;
      crc >>= 1;
      if (temp & 1) {
        crc ^= 0xA001;
      }
      temp >>= 1;
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

  // SIA DC-09 wire format:
  //   <LF><CRC><LEN>"<*PROTO>"<SEQ><RECV><LINE>#<ACCT>[<DATA>]<TS><CR>
  //
  // Quotes ONLY surround the protocol name (e.g. "*SIA-DCS").
  // All other fields (sequence, receiver, line, account, data) follow
  // AFTER the closing quote. The old firstQuote/lastQuote approach
  // captured only the protocol name and lost everything else.

  const firstQuote = str.indexOf('"');
  if (firstQuote === -1) return null;
  const secondQuote = str.indexOf('"', firstQuote + 1);
  if (secondQuote === -1) return null;

  // Protocol name between the two quotes (may have * prefix for unencrypted)
  const protocolRaw = str.substring(firstQuote + 1, secondQuote);

  // Everything after the closing protocol quote (before CR, already trimmed)
  const afterProtocol = str.substring(secondQuote + 1);

  // Extract CRC from the prefix before the first quote
  // Format: <CRC 4 hex><LEN 4 hex>"...
  const prefix = str.substring(0, firstQuote);
  const cleanPrefix = prefix.replace(/^[\n\r\s]+/, '');
  let crcStr = '';
  if (cleanPrefix.length >= 4) {
    crcStr = cleanPrefix.substring(0, 4);
  }

  // CRC covers everything from the opening quote to the end (minus CR)
  const bodyForCrc = str.substring(firstQuote).replace(/\r$/, '');
  const expectedCrc = crc16arc(Buffer.from(bodyForCrc, 'ascii'));
  const receivedCrc = parseInt(crcStr, 16);
  const crcValid = !isNaN(receivedCrc) && receivedCrc === expectedCrc;

  // Extract timestamp from the end of the fields portion (if present)
  let timestamp: Date | undefined;
  let fields = afterProtocol;
  const tsMatch = fields.match(/_(\d{2}):(\d{2}):(\d{2}),(\d{2})-(\d{2})-(\d{4})$/);
  if (tsMatch) {
    const [fullTs, hh, mm, ss, MM, DD, YYYY] = tsMatch;
    timestamp = new Date(
      parseInt(YYYY), parseInt(MM) - 1, parseInt(DD),
      parseInt(hh), parseInt(mm), parseInt(ss),
    );
    fields = fields.substring(0, fields.length - fullTs.length);
  }

  // Strip * prefix (unencrypted indicator) from protocol name
  const protocol = protocolRaw.startsWith('*') ? protocolRaw.substring(1) : protocolRaw;

  // Raw content for logging: protocol + fields
  const raw = protocolRaw + '"' + fields;

  // Handle bare NULL heartbeat (no account/fields after the protocol)
  if (protocol === 'NULL' && !fields.includes('#')) {
    return {
      raw,
      sequence: '',
      receiver: '',
      linePrefix: '',
      account: '',
      protocol: 'NULL',
      timestamp,
      crcValid,
    };
  }

  // Parse fields: <SEQ><RECV><LINE>#<ACCT>[<DATA>]
  // Standard:  0001R0L0#1234[CL001]
  // Legacy:    0001"R0"L0"#1234[CL001]  (quotes between fields)
  let sequence = '';
  let receiver = '';
  let linePrefix = '';
  let account = '';
  let eventData = '';

  const fieldsMatch = fields.match(
    /^(\d{0,4})"?(R[0-9A-Fa-f]{0,6})?"?(L[0-9A-Fa-f]{0,6})?"?#([0-9A-Fa-f]{1,16})\[([^\]]*)\]?$/,
  );
  if (fieldsMatch) {
    [, sequence, receiver, linePrefix, account, eventData] = fieldsMatch;
    receiver = receiver || 'R0';
    linePrefix = linePrefix || 'L0';
  } else {
    // Loose parse for non-standard formats
    const acctMatch = fields.match(/#([0-9A-Fa-f\w]+)/);
    account = acctMatch ? acctMatch[1] : '';

    const dataMatch = fields.match(/\[([^\]]*)\]/);
    eventData = dataMatch ? dataMatch[1] : '';

    const seqMatch = fields.match(/^"?(\d+)/);
    sequence = seqMatch ? seqMatch[1] : '';

    const recvMatch = fields.match(/(R[0-9A-Fa-f]+)/);
    receiver = recvMatch ? recvMatch[1] : 'R0';

    const lpMatch = fields.match(/(L[0-9A-Fa-f]+)/);
    linePrefix = lpMatch ? lpMatch[1] : 'L0';
  }

  // Parse CID event data if ADM-CID
  let event: CidEvent | undefined;
  if (protocol === 'ADM-CID' && eventData) {
    event = parseCidEvent(eventData);
  } else if (protocol === 'SIA-DCS' && eventData) {
    // SIA-DCS can contain CID-like data or native SIA event codes
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
    raw,
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
 *
 * Format: <LF><CRC><LEN><body><CR>
 * Body:   "ACK"<seq><Rrecv><Lline>#<acct>[]
 *
 * CRC and LEN are computed over the body string.
 * No timestamp is included (matches standard CMS implementations).
 */
export function buildSiaAck(message: SiaMessage): Buffer {
  let body: string;
  if (message.sequence || message.account) {
    // Full ACK echoing back sequence, receiver, line, and account
    body = `"ACK"${message.sequence}${message.receiver}${message.linePrefix}#${message.account}[]`;
  } else {
    // Simple ACK for bare NULL messages without fields
    body = '"ACK"';
  }

  const crc = crc16arc(Buffer.from(body, 'ascii'));
  const crcHex = crc.toString(16).toUpperCase().padStart(4, '0');
  const lenHex = body.length.toString(16).toUpperCase().padStart(4, '0');

  const frame = `\n${crcHex}${lenHex}${body}\r`;
  return Buffer.from(frame, 'ascii');
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
  return code === '137' || code === '144' || code === '145' || code === '377';
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
