'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class RangeExtenderDriver extends AjaxSensorDriver {
  deviceCategory = 'range_extender' as const;
};
