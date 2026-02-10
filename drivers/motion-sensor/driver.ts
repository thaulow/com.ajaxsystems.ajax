'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class MotionSensorDriver extends AjaxSensorDriver {
  deviceCategory = 'motion_sensor' as const;
};
