'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class ButtonDriver extends AjaxSensorDriver {
  deviceCategory = 'button' as const;
};
