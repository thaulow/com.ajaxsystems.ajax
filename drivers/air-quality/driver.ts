'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class AirQualityDriver extends AjaxSensorDriver {
  deviceCategory = 'air_quality' as const;
};
