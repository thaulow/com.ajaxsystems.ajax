'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class SmokeDetectorDriver extends AjaxSensorDriver {
  deviceCategory = 'smoke_detector' as const;
};
