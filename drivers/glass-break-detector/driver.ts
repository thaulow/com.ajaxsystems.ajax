'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class GlassBreakDetectorDriver extends AjaxSensorDriver {
  deviceCategory = 'glass_break_detector' as const;
};
