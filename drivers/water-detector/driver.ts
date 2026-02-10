'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class WaterDetectorDriver extends AjaxSensorDriver {
  deviceCategory = 'water_detector' as const;
};
