'use strict';

import { AjaxSensorDriver } from '../../lib/sensor-driver';

module.exports = class SirenDriver extends AjaxSensorDriver {
  deviceCategory = 'siren' as const;
};
