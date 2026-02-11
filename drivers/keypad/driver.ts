'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class KeypadDriver extends AjaxSensorDriver {
  deviceCategory = 'keypad' as const;
};
