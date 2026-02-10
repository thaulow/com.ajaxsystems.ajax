'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class SmartPlugDriver extends AjaxSensorDriver {
  deviceCategory = 'smart_plug' as const;
};
