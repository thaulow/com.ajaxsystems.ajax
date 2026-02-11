'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class TransmitterDriver extends AjaxSensorDriver {
  deviceCategory = 'transmitter' as const;
};
